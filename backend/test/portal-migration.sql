DO $$ DECLARE a jsonb; b jsonb; c jsonb; d jsonb; current_row jsonb; rid bigint; worker uuid:=gen_random_uuid();
BEGIN
 a:=public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000001',NULL,
 '{"server_id":"portal-test","server_name":"Test","channel_id":"channel","channel_name":"verify","role_id":"role","role_name":"Test role","slug":"ALL","attribute_key":"ALL","attribute_value":"ALL","min_items":1,"asset_type":"ethscription","chain_id":1}'::jsonb);
 rid:=(a->'after_rule'->>'id')::bigint;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=(a->>'id')::uuid)<>1 THEN RAISE EXCEPTION 'Missing atomic job'; END IF;
 b:=public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000001',NULL,a->'after_rule');
 IF a<>b THEN RAISE EXCEPTION 'Idempotency failed'; END IF;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('other','admin','aaaaaaaa-0000-4000-8000-000000000001',NULL,a->'after_rule');
  RAISE EXCEPTION 'Cross-server replay accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cross-server replay accepted' THEN RAISE; END IF; END;
 b:=public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000002',a->'after_rule',jsonb_set(a->'after_rule','{min_items}','2'));
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000003',a->'after_rule',NULL);
  RAISE EXCEPTION 'Stale delete accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 c:=public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000004',b->'after_rule',b->'before_rule',(b->>'id')::uuid);
 IF (SELECT min_items FROM public.verifier_rules WHERE id=rid)<>1 THEN RAISE EXCEPTION 'Undo failed'; END IF;
 d:=public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000005',c->'after_rule',c->'before_rule',(c->>'id')::uuid);
 IF (SELECT min_items FROM public.verifier_rules WHERE id=rid)<>2 THEN RAISE EXCEPTION 'Redo failed'; END IF;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000006',b->'after_rule',b->'before_rule',(b->>'id')::uuid);
  RAISE EXCEPTION 'Duplicate reversal accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 SELECT to_jsonb(r) INTO current_row FROM public.verifier_rules r WHERE id=rid;
 a:=public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000007',current_row,NULL);
 b:=public.verifier_portal_mutate_rule('portal-test','admin','aaaaaaaa-0000-4000-8000-000000000008',NULL,a->'before_rule',(a->>'id')::uuid);
 IF (b->'after_rule'->>'id')::bigint<>rid THEN RAISE EXCEPTION 'Restored rule ID changed'; END IF;
 IF (SELECT count(*) FROM public.verifier_portal_claim_job(worker))<>1 THEN RAISE EXCEPTION 'Claim failed'; END IF;
 IF (SELECT count(*) FROM public.verifier_portal_claim_job(gen_random_uuid()))<>0 THEN RAISE EXCEPTION 'Parallel job in same server'; END IF;
 IF has_table_privilege('anon','public.verifier_web_sessions','SELECT') OR has_table_privilege('authenticated','public.verifier_server_settings','UPDATE')
 OR has_function_privilege('anon','public.verifier_portal_claim_job(uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.verifier_portal_mutate_rule(text,text,uuid,jsonb,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Portal data exposed'; END IF;
END $$;
