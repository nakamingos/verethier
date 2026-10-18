DO $$ DECLARE test_server text:='111111111111111111'; actor text:='222222222222222222';
 test_address text:='0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; block_request uuid:='cccccccc-0000-4000-8000-000000000001';
 unblock_request uuid:='cccccccc-0000-4000-8000-000000000002'; test_result jsonb; blocked_time timestamptz;
BEGIN
 INSERT INTO public.user_wallets(user_id,address) VALUES('current-owner',test_address),('current-owner','0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
 test_result:=public.verifier_portal_wallet_block(test_server,actor,test_address,true,'  Abuse investigation  ',block_request);
 IF test_result->>'blocked'<>'true' OR test_result->>'jobs'<>'1' THEN RAISE EXCEPTION 'Missing block/check'; END IF;
 IF (SELECT reason FROM public.verifier_wallet_blocks b WHERE b.server_id=test_server AND b.address=test_address)<>'Abuse investigation' THEN RAISE EXCEPTION 'Reason normalization failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs j WHERE j.action_id=(test_result->>'action_id')::uuid AND j.server_id=test_server AND j.user_id='current-owner') THEN RAISE EXCEPTION 'Wrong owner/server queued'; END IF;
 SELECT blocked_at INTO blocked_time FROM public.verifier_wallet_blocks b WHERE b.server_id=test_server AND b.address=test_address;
 PERFORM public.verifier_portal_wallet_block(test_server,actor,test_address,true,'Abuse investigation',block_request);
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=(test_result->>'action_id')::uuid)<>1 THEN RAISE EXCEPTION 'Duplicate job on retry'; END IF;
 IF (SELECT blocked_at FROM public.verifier_wallet_blocks b WHERE b.server_id=test_server AND b.address=test_address) IS DISTINCT FROM blocked_time THEN RAISE EXCEPTION 'Replay changed timestamp'; END IF;
 BEGIN
  PERFORM public.verifier_portal_wallet_block('333333333333333333',actor,test_address,true,'Abuse investigation',block_request);
  RAISE EXCEPTION 'Cross-server replay accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cross-server replay accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.verifier_portal_wallet_block(test_server,actor,test_address,false,NULL,block_request);
  RAISE EXCEPTION 'Opposite action reused receipt';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Opposite action reused receipt' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.user_wallets WHERE user_id='current-owner')<>2 THEN RAISE EXCEPTION 'Blocking removed saved links'; END IF;
 IF EXISTS(SELECT 1 FROM public.verifier_wallet_blocks b WHERE b.address='0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') THEN RAISE EXCEPTION 'Blocked an unselected wallet'; END IF;
 IF EXISTS(SELECT 1 FROM public.verifier_wallet_blocks b WHERE b.server_id<>test_server AND b.address=test_address) THEN RAISE EXCEPTION 'Block leaked into another server'; END IF;
 PERFORM public.verifier_portal_wallet_block(test_server,actor,test_address,false,NULL,unblock_request);
 IF EXISTS(SELECT 1 FROM public.verifier_wallet_blocks b WHERE b.server_id=test_server AND b.address=test_address) THEN RAISE EXCEPTION 'Unblock failed'; END IF;
 PERFORM public.verifier_portal_wallet_block(test_server,actor,test_address,true,'Abuse investigation',block_request);
 IF EXISTS(SELECT 1 FROM public.verifier_wallet_blocks b WHERE b.server_id=test_server AND b.address=test_address) THEN RAISE EXCEPTION 'Old retry reapplied a superseded restriction'; END IF;
 test_result:=public.verifier_portal_wallet_block(test_server,actor,'0xcccccccccccccccccccccccccccccccccccccccc',true,NULL,gen_random_uuid());
 IF test_result->>'jobs'<>'0' THEN RAISE EXCEPTION 'Unlinked wallet queued unrelated checks'; END IF;
 IF (SELECT count(*) FROM public.verifier_portal_actions WHERE request_id IN (block_request,unblock_request))<>2 THEN RAISE EXCEPTION 'Missing audit receipts'; END IF;
 IF has_function_privilege('anon','public.verifier_portal_wallet_block(text,text,text,boolean,text,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.verifier_portal_wallet_block(text,text,text,boolean,text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Block RPC exposed'; END IF;
END $$;
