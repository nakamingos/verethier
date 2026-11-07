DO $$
DECLARE s text:='990000000000000001'; u text:='990000000000000002'; ch text:='990000000000000003'; role text:='990000000000000004';
 event uuid:=gen_random_uuid(); epoch uuid:=gen_random_uuid(); original_version uuid; claimed public.verifier_bouncer_log_queue; second public.verifier_bouncer_log_queue;
BEGIN
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.verifier_bouncer_log_queue'::regclass);
 ASSERT NOT has_table_privilege('anon','public.verifier_bouncer_log_queue','SELECT');
 ASSERT NOT has_table_privilege('authenticated','public.verifier_bouncer_log_queue','INSERT');
 ASSERT NOT has_function_privilege('authenticated','public.verifier_enqueue_bouncer_log(text,text,text,text,text,text,uuid,timestamptz)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.verifier_claim_bouncer_log(uuid)','EXECUTE');
 INSERT INTO public.verifier_server_settings(server_id,updated_by) VALUES(s,u);
 PERFORM public.verifier_enqueue_bouncer_log(s,u,'role_added','background',role);
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bouncer_log_queue WHERE server_id=s), 'Disabled servers must not queue';
 UPDATE public.verifier_server_settings SET log_channel_id=ch WHERE server_id=s RETURNING log_version INTO original_version;
 PERFORM public.verifier_enqueue_bouncer_log(s,u,'role_added','background',role,p_event=>event);
 PERFORM public.verifier_enqueue_bouncer_log(s,u,'role_added','background',role,p_event=>event);
 ASSERT (SELECT count(*)=1 FROM public.verifier_bouncer_log_queue WHERE server_id=s), 'Event retries must deduplicate';
 UPDATE public.verifier_server_settings SET background_checks_enabled=false WHERE server_id=s;
 ASSERT (SELECT log_version=original_version FROM public.verifier_server_settings WHERE server_id=s), 'Other settings must not discard queued events';
 PERFORM public.verifier_enqueue_bouncer_log(s,u,'wallet_added','portal');
 ASSERT (SELECT count(*)=1 FROM public.verifier_bouncer_log_queue WHERE server_id=s), 'Private wallet activity must not queue';
 INSERT INTO public.verifier_privacy_servers(server_id,sharing_enabled,epoch) VALUES(s,true,epoch);
 INSERT INTO public.verifier_privacy_choices(server_id,user_id,epoch,share_since,notice_version) VALUES(s,u,epoch,now()-interval '1 day','2026-10-27');
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,source)
 VALUES(gen_random_uuid(),u,'wallet_link','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','evm','portal');
 ASSERT EXISTS(SELECT 1 FROM public.verifier_bouncer_log_queue WHERE server_id=s AND kind='wallet_added' AND source='portal'), 'Portal additions must queue';
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,source,server_id)
 VALUES(gen_random_uuid(),u,'wallet_verify','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','evm','discord',s);
 ASSERT EXISTS(SELECT 1 FROM public.verifier_bouncer_log_queue WHERE server_id=s AND kind='verification_success'), 'Discord verification must queue';
 INSERT INTO public.verifier_blocked_verification_attempts(user_id,server_id,address,wallet_type,source,chain_id)
 VALUES(u,s,'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','evm','discord',1);
 ASSERT EXISTS(SELECT 1 FROM public.verifier_bouncer_log_queue WHERE server_id=s AND kind='verification_blocked'), 'Blocked proofs must queue';
 ASSERT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='verifier_bouncer_log_queue' AND column_name IN ('address','signature','nonce','payload','block_reason')), 'No wallet secrets in queue';
 SELECT * INTO claimed FROM public.verifier_claim_bouncer_log(gen_random_uuid());
 SELECT * INTO second FROM public.verifier_claim_bouncer_log(gen_random_uuid());
 ASSERT claimed.id IS NOT NULL AND second.id IS NOT NULL AND claimed.id<>second.id AND claimed.attempts=1, 'Leases must prevent duplicate claims';
 UPDATE public.verifier_server_settings SET log_events=ARRAY['verification_success'] WHERE server_id=s;
 ASSERT (SELECT log_version<>original_version FROM public.verifier_server_settings WHERE server_id=s), 'Configuration changes must invalidate queued messages';
 DELETE FROM public.verifier_bouncer_log_queue WHERE server_id=s;
 PERFORM public.verifier_enqueue_bouncer_log(s,u,'role_added','background',role);
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bouncer_log_queue WHERE server_id=s), 'Unchecked event must not queue';
 PERFORM public.verifier_enqueue_bouncer_log(s,u,'verification_success','discord',p_time=>now()-interval '2 days');
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bouncer_log_queue WHERE server_id=s), 'Historical events must not backfill';
 PERFORM public.verifier_enqueue_bouncer_log(s,u,'verification_success','discord');
 INSERT INTO public.verifier_privacy_deletions(id,user_id,status) VALUES(gen_random_uuid(),u,'processing');
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bouncer_log_queue WHERE user_id=u), 'Account deletion must clear queued messages';
 PERFORM public.verifier_enqueue_bouncer_log(s,u,'verification_success','discord');
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bouncer_log_queue WHERE user_id=u), 'Deleted accounts must not queue new messages';
END $$;
