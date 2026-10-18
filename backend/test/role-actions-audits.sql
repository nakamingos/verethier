DO $$ DECLARE s text:='111111111111111111'; actor text:='222222222222222222';
 trigger_id text:='333333333333333333'; target_id text:='444444444444444444';
 request uuid:=gen_random_uuid(); stamp timestamptz; test_result jsonb;
BEGIN
 INSERT INTO public.verifier_user_roles(server_id,user_id,role_id,status) VALUES(s,'member',trigger_id,'active');
 PERFORM public.verifier_portal_role_action(s,actor,trigger_id,ARRAY[target_id],NULL,request);
 IF NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE user_id='member' AND server_id=s AND role_action_role_id=trigger_id) THEN RAISE EXCEPTION 'Existing holder action not queued'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE user_id='member' AND server_id=s AND role_action_role_id IS NULL) THEN RAISE EXCEPTION 'Earned-role recheck not queued'; END IF;
 SELECT updated_at INTO stamp FROM public.verifier_role_actions WHERE server_id=s AND trigger_role_id=trigger_id;
 PERFORM public.verifier_portal_role_action(s,actor,trigger_id,ARRAY[target_id],NULL,request);
 IF (SELECT count(*) FROM public.verifier_portal_actions WHERE request_id=request)<>1 THEN RAISE EXCEPTION 'Replay duplicated audit'; END IF;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE user_id='member' AND role_action_role_id=trigger_id)<>1 THEN RAISE EXCEPTION 'Replay duplicated action'; END IF;
 BEGIN
  PERFORM public.verifier_portal_role_action(s,actor,target_id,ARRAY[trigger_id],NULL,gen_random_uuid());
  RAISE EXCEPTION 'Cycle accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cycle accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.verifier_portal_role_action(s,actor,trigger_id,ARRAY[target_id],NULL,gen_random_uuid());
  RAISE EXCEPTION 'Stale write accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Stale write accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.verifier_portal_role_action('555555555555555555',actor,trigger_id,ARRAY[target_id],NULL,request);
  RAISE EXCEPTION 'Cross-server receipt accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cross-server receipt accepted' THEN RAISE; END IF; END;
 INSERT INTO public.verifier_user_roles(server_id,user_id,role_id,status) VALUES(s,'new-holder',trigger_id,'active');
 IF NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE user_id='new-holder' AND role_action_role_id=trigger_id) THEN RAISE EXCEPTION 'New Bouncer grant not queued'; END IF;
 PERFORM public.verifier_portal_role_action(s,actor,trigger_id,ARRAY[target_id,'666666666666666666'],stamp,gen_random_uuid());
 SELECT updated_at INTO stamp FROM public.verifier_role_actions WHERE server_id=s AND trigger_role_id=trigger_id;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE user_id='new-holder' AND role_action_role_id=trigger_id)<>2 THEN RAISE EXCEPTION 'Pending grant absorbed a new configuration action'; END IF;
 INSERT INTO public.verifier_user_roles(server_id,user_id,role_id,status) VALUES('555555555555555555','other',trigger_id,'active');
 IF EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE user_id='other') THEN RAISE EXCEPTION 'Action leaked to other server'; END IF;
 PERFORM public.verifier_portal_role_action(s,actor,trigger_id,NULL,stamp,gen_random_uuid());
 IF EXISTS(SELECT 1 FROM public.verifier_role_actions WHERE server_id=s) THEN RAISE EXCEPTION 'Delete failed'; END IF;
 IF has_function_privilege('anon','public.verifier_portal_role_action(text,text,text,text[],timestamptz,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.verifier_portal_wallet_audit(text,text[],text,text,integer,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Public RPC access'; END IF;
END $$;

DO $$ DECLARE s text:='111111111111111111'; a text:='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
 c text:='0xcccccccccccccccccccccccccccccccccccccccc'; test_result jsonb;
BEGIN
 INSERT INTO public.user_wallets(user_id,address) VALUES('one',a),('three',c),('two','0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
 INSERT INTO public.verifier_user_roles(server_id,user_id,role_id,status) VALUES(s,'former','333333333333333333','revoked');
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,last_proven_at,created_at) VALUES
 (gen_random_uuid(),'two','wallet_remove',a,'evm','2026-10-01','2026-10-02'),
 (gen_random_uuid(),'two','wallet_transfer_out',a,'evm','2026-10-01','2026-10-03'),
 (gen_random_uuid(),'former','wallet_remove',a,'evm','2026-10-04','2026-10-05'),
 (gen_random_uuid(),'outsider','wallet_remove',a,'evm','2026-10-06','2026-10-07'),
 (gen_random_uuid(),'two','wallet_remove',c,'evm',NULL,'2026-10-08');
 test_result:=public.verifier_portal_wallet_audit(s,ARRAY['one','two','three'],'one',NULL,20);
 IF test_result->>'total'<>'1' OR test_result->'items'->0->>'account_count'<>'3' THEN RAISE EXCEPTION 'Member scope/dedup/former history failed'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(test_result->'items'->0->'accounts') item WHERE item->>'user_id'='outsider') THEN RAISE EXCEPTION 'Cross-server identity leaked'; END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(test_result->'items'->0->'accounts') item WHERE item->>'user_id'='one' AND item->>'current'='true') THEN RAISE EXCEPTION 'Lost current link'; END IF;
 test_result:=public.verifier_portal_wallet_audit(s,ARRAY['one','two','three'],NULL,NULL,1);
 IF test_result->>'total'<>'2' OR test_result->>'next'<>a OR jsonb_array_length(test_result->'items')<>1 THEN RAISE EXCEPTION 'Audit pagination failed'; END IF;
 test_result:=public.verifier_portal_wallet_audit(s,ARRAY['one','two','three'],NULL,a,1);
 IF test_result->'items'->0->>'address'<>c OR test_result->>'next' IS NOT NULL THEN RAISE EXCEPTION 'Audit cursor failed'; END IF;
 test_result:=public.verifier_portal_wallet_audit('555555555555555555',ARRAY[]::text[],NULL,NULL,20);
 IF test_result->>'total'<>'0' THEN RAISE EXCEPTION 'Empty server audit leaked associations'; END IF;
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type)
 SELECT gen_random_uuid(),'peer-'||lpad(n::text,2,'0'),'wallet_link','0xdddddddddddddddddddddddddddddddddddddddd','evm' FROM generate_series(1,26) n;
 test_result:=public.verifier_portal_wallet_audit(s,ARRAY(SELECT 'peer-'||lpad(n::text,2,'0') FROM generate_series(1,26) n),NULL,NULL,20);
 IF jsonb_array_length(test_result->'items'->0->'accounts')<>25 OR test_result->'items'->0->>'account_next'<>'peer-25' THEN RAISE EXCEPTION 'Account pagination truncated silently'; END IF;
 test_result:=public.verifier_portal_wallet_audit(s,ARRAY(SELECT 'peer-'||lpad(n::text,2,'0') FROM generate_series(1,26) n),NULL,NULL,20,'0xdddddddddddddddddddddddddddddddddddddddd','peer-25');
 IF jsonb_array_length(test_result->'items'->0->'accounts')<>1 OR test_result->'items'->0->'accounts'->0->>'user_id'<>'peer-26' OR test_result->'items'->0->>'account_next' IS NOT NULL THEN RAISE EXCEPTION 'Account cursor failed'; END IF;
END $$;
