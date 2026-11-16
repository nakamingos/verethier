DO $$
DECLARE a text:='0xabcabcabcabcabcabcabcabcabcabcabcabcabca'; b text:='0xdefdefdefdefdefdefdefdefdefdefdefdefdefd';
 u text:='111111111111111111'; v text:='222222222222222222';
 s1 text:='1369930881267142686'; s2 text:='919772570612539422'; s3 text:='333333333333333333'; r jsonb;
BEGIN
 IF NOT public.verifier_wallet_community_allowed(s1,u,a) OR NOT public.verifier_wallet_community_allowed(s2,u,a)
 OR NOT public.verifier_wallet_community_allowed(s2,u,b) THEN RAISE EXCEPTION 'Legacy snapshot missing'; END IF;
 IF public.verifier_wallet_community_allowed(s3,u,a) THEN RAISE EXCEPTION 'Future community inherited legacy visibility'; END IF;
 IF has_table_privilege('anon','public.verifier_wallet_communities','SELECT')
 OR has_table_privilege('authenticated','public.verifier_wallet_community_events','SELECT')
 OR has_function_privilege('service_role','public.verifier_associate_signed_wallet(text,text,text,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.verifier_member_wallet_community(text,text,text,boolean,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe grants'; END IF;
 r:=public.verifier_link_verified_wallet(u,a,'evm',NULL,'aaaaaaaa-1111-4000-8000-000000000001','discord',s1,NULL);
 IF r->>'success'<>'true' OR NOT public.verifier_wallet_community_allowed(s1,u,a)
 OR public.verifier_wallet_community_allowed(s2,u,a) OR NOT public.verifier_wallet_community_allowed(s2,u,b)
 THEN RAISE EXCEPTION 'Proof must transition one wallet only'; END IF;
 IF (SELECT source FROM public.verifier_wallet_communities WHERE user_id=u AND address=a AND server_id=s1)<>'verification'
 THEN RAISE EXCEPTION 'Proof association not recorded'; END IF;
 PERFORM public.verifier_member_wallet_community(u,b,s2,false,'aaaaaaaa-1111-4000-8000-000000000002');
 PERFORM public.verifier_member_wallet_community(u,b,s2,false,'aaaaaaaa-1111-4000-8000-000000000002');
 IF (SELECT count(*) FROM public.verifier_wallet_community_events WHERE id='aaaaaaaa-1111-4000-8000-000000000002')<>1 THEN RAISE EXCEPTION 'Sharing retry not idempotent'; END IF;
 PERFORM public.verifier_link_verified_wallet(u,b,'evm',NULL,'aaaaaaaa-1111-4000-8000-000000000003','discord',s1,NULL);
 PERFORM public.verifier_link_verified_wallet(u,b,'evm',NULL,'aaaaaaaa-1111-4000-8000-000000000004','discord',s2,NULL);
 IF public.verifier_wallet_community_allowed(s2,u,b) THEN RAISE EXCEPTION 'Proof overrode deliberate opt-out'; END IF;
 BEGIN
  PERFORM public.verifier_member_wallet_community(v,a,s1,true,'aaaaaaaa-1111-4000-8000-000000000005');
  RAISE EXCEPTION 'Other member changed sharing';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Other member changed sharing' THEN RAISE; END IF; END;
 PERFORM public.verifier_member_wallet_community(u,a,s3,true,'aaaaaaaa-1111-4000-8000-000000000006');
 IF NOT public.verifier_wallet_community_allowed(s3,u,a) THEN RAISE EXCEPTION 'Explicit sharing association failed'; END IF;
 PERFORM public.verifier_link_verified_wallet(v,a,'evm',NULL,'aaaaaaaa-1111-4000-8000-000000000007','discord',s2,NULL);
 IF public.verifier_wallet_community_allowed(s1,v,a) OR NOT public.verifier_wallet_community_allowed(s2,v,a)
 OR public.verifier_wallet_community_allowed(s1,u,a) THEN RAISE EXCEPTION 'Transfer leaked current visibility'; END IF;
 IF NOT public.verifier_wallet_community_allowed(s1,u,a,now()) THEN RAISE EXCEPTION 'Transfer lost scoped removed history'; END IF;
 IF public.verifier_wallet_community_allowed(s1,u,a,now(),s2) THEN RAISE EXCEPTION 'Foreign history leaked'; END IF;
 r:=public.verifier_member_remove_wallet(v,a,'aaaaaaaa-1111-4000-8000-000000000008');
 IF public.verifier_wallet_community_allowed(s2,v,a) OR NOT public.verifier_wallet_community_allowed(s2,v,a,now()) THEN RAISE EXCEPTION 'Removal history lifecycle incorrect'; END IF;
 PERFORM public.verifier_link_verified_wallet(v,a,'evm',NULL,'aaaaaaaa-1111-4000-8000-000000000009','portal',NULL,NULL);
 IF public.verifier_wallet_community_allowed(s2,v,a) THEN RAISE EXCEPTION 'Generic relink revived old community permission'; END IF;
 IF (SELECT count(*) FROM public.user_wallets WHERE user_id=v AND address=a)<>1 THEN RAISE EXCEPTION 'Account-wide wallet storage changed'; END IF;
END $$;
-- Compare ordinary and operator searches/audits with currently shareable records.
INSERT INTO public.verifier_privacy_servers(server_id,sharing_enabled) VALUES('1369930881267142686',true),('919772570612539422',true) ON CONFLICT(server_id) DO UPDATE SET sharing_enabled=true;
INSERT INTO public.verifier_privacy_choices(server_id,user_id,epoch,share_since,export_since,notice_version)
 SELECT s.server_id,u.id,s.epoch,'2020-01-01','2020-01-01','2026-10-27'
 FROM public.verifier_privacy_servers s CROSS JOIN (VALUES('111111111111111111'),('222222222222222222')) u(id)
 WHERE s.server_id IN ('1369930881267142686','919772570612539422')
 ON CONFLICT(server_id,user_id) DO UPDATE SET epoch=excluded.epoch,share_since=excluded.share_since,export_since=excluded.export_since;
DO $$
DECLARE r jsonb; addr text:='0xabcabcabcabcabcabcabcabcabcabcabcabcabca';
BEGIN
 IF EXISTS(SELECT 1 FROM public.verifier_privacy_wallet_matches('1369930881267142686',addr) WHERE user_id='222222222222222222') THEN RAISE EXCEPTION 'Search exposed unrelated current owner'; END IF;
 r:=public.verifier_portal_wallet_audit('1369930881267142686',ARRAY['111111111111111111','222222222222222222'],NULL,NULL,20,addr,NULL,false);
 IF (r->>'total')::int<>0 THEN RAISE EXCEPTION 'Ordinary audit crossed community boundary'; END IF;
 r:=public.verifier_portal_wallet_audit('1369930881267142686',ARRAY['111111111111111111','222222222222222222'],NULL,NULL,20,addr,NULL,true);
 IF (r->>'total')::int<>1 THEN RAISE EXCEPTION 'Operator audit lost cross-community evidence'; END IF;
 -- A normal user erasure must remove both the current sharing state and events.
 UPDATE public.verifier_member_actions SET created_at=now()-interval '2 years' WHERE user_id='111111111111111111' AND address=addr;
 PERFORM public.verifier_privacy_cleanup(900);
 IF EXISTS(SELECT 1 FROM public.verifier_wallet_communities WHERE user_id='111111111111111111' AND address=addr)
 OR EXISTS(SELECT 1 FROM public.verifier_wallet_community_events WHERE user_id='111111111111111111' AND address=addr)
 THEN RAISE EXCEPTION 'Removed association exceeded retention'; END IF;
END $$;

DO $$
DECLARE u text:='444444444444444444'; s text:='1369930881267142686'; a text;
BEGIN
 -- All proof families use the same atomic disclosure hook; case-sensitive
 -- wallet identities must stay intact in the association and member controls.
 FOREACH a IN ARRAY ARRAY['1BoatSLRHtKNngkdXEeobR76b53LETtpyT','So11111111111111111111111111111111111111112'] LOOP
  PERFORM public.verifier_link_verified_wallet(u,a,CASE WHEN left(a,1)='1' THEN 'bitcoin' ELSE 'solana' END,NULL,gen_random_uuid(),'discord',s,NULL);
  IF NOT public.verifier_wallet_community_allowed(s,u,a) THEN RAISE EXCEPTION 'Wallet-family proof missed association'; END IF;
 END LOOP;
 BEGIN
  PERFORM public.verifier_link_verified_wallet(u,'0x5555555555555555555555555555555555555555','evm',NULL,gen_random_uuid(),'discord','invalid-community',NULL);
  RAISE EXCEPTION 'Invalid association accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Invalid association accepted' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.user_wallets WHERE address='0x5555555555555555555555555555555555555555') THEN RAISE EXCEPTION 'Failed association did not roll back proof link'; END IF;
 INSERT INTO public.verifier_privacy_deletions(id,user_id,status,reviewed_at) VALUES(gen_random_uuid(),u,'processing',now()-interval '1 hour');
 PERFORM public.verifier_privacy_cleanup(900);
 IF EXISTS(SELECT 1 FROM public.verifier_wallet_communities WHERE user_id=u)
 OR EXISTS(SELECT 1 FROM public.verifier_wallet_community_events WHERE user_id=u)
 THEN RAISE EXCEPTION 'Account erasure retained wallet disclosure records'; END IF;
END $$;

DO $$
DECLARE u text:='555555555555555555'; a text:='0x6666666666666666666666666666666666666666';
 s1 text:='1369930881267142686'; s2 text:='919772570612539422';
BEGIN
 INSERT INTO public.user_wallets(user_id,address,wallet_type,last_verified_at) VALUES(u,a,'evm',now());
 -- Model an existing, grandfathered wallet with an explicit sharing choice
 -- made before its first new verification. That choice is an independent grant.
 INSERT INTO public.verifier_wallet_communities(user_id,address,server_id,source) VALUES(u,a,s1,'legacy'),(u,a,s2,'legacy');
 PERFORM public.verifier_member_wallet_community(u,a,s2,true,gen_random_uuid());
 PERFORM public.verifier_link_verified_wallet(u,a,'evm',NULL,gen_random_uuid(),'discord',s1,NULL);
 IF NOT public.verifier_wallet_community_allowed(s2,u,a) THEN RAISE EXCEPTION 'Reverification discarded an explicit community grant'; END IF;
 DELETE FROM public.user_wallets WHERE user_id=u AND address=a;
 UPDATE public.verifier_wallet_communities SET removed_at=now()-interval '2 years' WHERE user_id=u AND address=a;
 PERFORM public.verifier_privacy_cleanup(900);
 IF EXISTS(SELECT 1 FROM public.verifier_wallet_communities WHERE user_id=u AND address=a) THEN RAISE EXCEPTION 'Orphaned removed visibility survived retention'; END IF;
END $$;
