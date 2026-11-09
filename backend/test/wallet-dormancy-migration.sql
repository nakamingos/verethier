DO $$
DECLARE s text:='dormancy-test-server'; u text:='dormancy-test-member'; addr text:='0xcccccccccccccccccccccccccccccccccccccccc';
 req uuid:=gen_random_uuid(); flow uuid; j uuid; worker uuid:=gen_random_uuid(); rid bigint; r jsonb; coverage jsonb; proven timestamptz; out jsonb;
BEGIN
 ASSERT NOT has_table_privilege('anon','public.verifier_wallet_dormancy','SELECT');
 ASSERT NOT has_table_privilege('authenticated','public.verifier_wallet_dormancy','SELECT');
 ASSERT has_table_privilege('service_role','public.verifier_wallet_dormancy','SELECT');
 ASSERT NOT has_table_privilege('service_role','public.verifier_wallet_dormancy','INSERT');
 ASSERT NOT has_table_privilege('service_role','public.verifier_wallet_dormancy','DELETE');
 ASSERT NOT has_function_privilege('anon','public.verifier_mark_wallet_dormant(text,text,text,text,timestamptz,jsonb,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.verifier_mark_wallet_dormant(text,text,text,text,timestamptz,jsonb,uuid,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.verifier_reactivate_signed_wallet(text,text,text,text,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.verifier_link_verified_wallet_before_dormancy(text,text,text,text,uuid,text,text,text,integer)','EXECUTE');
 ASSERT NOT has_function_privilege('service_role','public.verifier_member_link_wallet_before_dormancy(text,uuid,boolean,integer)','EXECUTE');
 out:=public.verifier_portal_mutate_rule(s,'admin',gen_random_uuid(),NULL,jsonb_build_object('server_id',s,'server_name','Test','channel_name','verify','channel_id','verify','role_id','977777777777777777','role_name','Holder','asset_type','ethscription','chain_id',1,'slug','nakamingos','min_items',5));
 rid:=(out->'after_rule'->>'id')::bigint;
 PERFORM public.verifier_link_verified_wallet(u,addr,'evm',NULL,req,'discord',s,NULL);
 SELECT last_verified_at INTO proven FROM public.user_wallets WHERE address=addr;
 SELECT jsonb_agg(to_jsonb(v)) INTO coverage FROM public.verifier_rules v WHERE server_id=s;
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,'[]');
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven-interval '1 second',coverage);
 ASSERT NOT public.verifier_mark_wallet_dormant('another-user',s,addr,'ethereum',proven,coverage);
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'bitcoin',proven,coverage);
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage||coverage),'Duplicate coverage accepted';
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,jsonb_set(coverage,'{0,min_items}','6')),'Changed definition accepted';
 -- Missing a newly added requirement is not complete coverage.
 out:=public.verifier_portal_mutate_rule(s,'admin',gen_random_uuid(),NULL,jsonb_build_object('server_id',s,'server_name','Test','channel_name','verify','channel_id','verify','role_id','977777777777777778','role_name','Other','asset_type','ethscription','chain_id',1,'slug','nakamingos','min_items',5));
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage),'Partial network coverage accepted';
 DELETE FROM public.verifier_rules WHERE id=(out->'after_rule'->>'id')::bigint;
 INSERT INTO public.verifier_privacy_deletions(id,user_id,status) VALUES(gen_random_uuid(),u,'processing');
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage),'Deletion subject marked';
 DELETE FROM public.verifier_privacy_deletions WHERE user_id=u;
 ASSERT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage);
 ASSERT EXISTS(SELECT 1 FROM public.user_wallets WHERE address=addr AND user_id=u),'Wallet deleted';
 ASSERT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr AND server_id=s AND network='ethereum');
 -- Reading holdings, changing generic proof metadata and incoming transfers do
 -- not call the fresh signature boundary and cannot wake a dormant wallet.
 UPDATE public.user_wallets SET user_name='Renamed',last_verified_at=now()+interval '1 second' WHERE address=addr;
 ASSERT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr);
 PERFORM public.verifier_link_verified_wallet(u,addr,'evm',NULL,req,'discord',s,NULL); -- idempotent replay
 ASSERT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr),'Replayed link woke wallet';
 -- A proof in another community cannot wake this one.
 PERFORM public.verifier_link_verified_wallet(u,addr,'evm',NULL,gen_random_uuid(),'discord','other-community',NULL);
 ASSERT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr AND server_id=s);
 -- A Base-only contract signature cannot wake Ethereum even after earlier EOA proof.
 PERFORM public.verifier_link_verified_wallet(u,addr,'evm',NULL,gen_random_uuid(),'discord',s,NULL,8453);
 ASSERT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr AND network='ethereum');
 PERFORM public.verifier_link_verified_wallet(u,addr,'evm',NULL,gen_random_uuid(),'discord',s,NULL,1);
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr),'Fresh proof failed to wake';
 SELECT last_verified_at INTO proven FROM public.user_wallets WHERE address=addr;
 -- A cancelled bulk job and a replaced/expired worker lease cannot mark wallets.
 j:=gen_random_uuid();
 PERFORM public.verifier_bulk_role_preview(jsonb_build_object('id',j,'server_id',s,'created_by','admin','audience','verified','mode','grant','rules_version','v1','labels','{}'::jsonb),jsonb_build_array(jsonb_build_object('id',u,'name','Member')));
 UPDATE public.verifier_bulk_role_jobs SET status='running' WHERE id=j;
 UPDATE public.verifier_bulk_role_members SET status='running',locked_by=worker,locked_until=now()+interval '15 minutes' WHERE job_id=j;
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage,j,gen_random_uuid());
 UPDATE public.verifier_bulk_role_jobs SET status='cancelled' WHERE id=j;
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage,j,worker);
 UPDATE public.verifier_bulk_role_jobs SET status='running' WHERE id=j;
 ASSERT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage,j,worker);
 -- Member portal's actual fresh proof path also reactivates, atomically.
 flow:=gen_random_uuid();
 INSERT INTO public.verifier_member_flows(user_id,id,purpose,address,wallet_type,challenge,expires_at)
 VALUES(u,flow,'wallet_link',addr,'evm','{"domain":{"chainId":1}}',now()+interval '5 minutes');
 out:=public.verifier_member_link_wallet(u,flow,false);
 ASSERT out->>'linked'='true';
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr);
 -- Smart-wallet chain scope cannot be broadened by an empty audit.
 UPDATE public.user_wallets SET evm_chain_ids=ARRAY[8453] WHERE address=addr;
 SELECT last_verified_at INTO proven FROM public.user_wallets WHERE address=addr;
 ASSERT NOT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage);
 UPDATE public.user_wallets SET evm_chain_ids=NULL WHERE address=addr;
 ASSERT public.verifier_mark_wallet_dormant(u,s,addr,'ethereum',proven,coverage);
 -- A confirmed transfer removes old-owner state, not historical proof/activity.
 PERFORM public.verifier_link_verified_wallet('dormancy-next-owner',addr,'evm',NULL,gen_random_uuid(),'discord','another-community',NULL);
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr AND user_id=u);
 SELECT last_verified_at INTO proven FROM public.user_wallets WHERE address=addr;
 ASSERT public.verifier_mark_wallet_dormant('dormancy-next-owner',s,addr,'ethereum',proven,coverage);
 DELETE FROM public.user_wallets WHERE address=addr;
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_wallet_dormancy WHERE address=addr),'Removal retained association';
END $$;
