DO $$ DECLARE a jsonb; b jsonb; c jsonb; d jsonb; candidate jsonb; rid bigint; ids jsonb;
BEGIN
 ids:=jsonb_build_object('kind','ids','ids',jsonb_build_array(repeat('a',64)||'i0'));
 IF public.verifier_inscription_criteria_valid('{"kind":"numbers","ranges":[[10100838,10100838]]}', 'ordinal',5) IS DISTINCT FROM true
  OR public.verifier_inscription_criteria_valid('{"kind":"numbers","ranges":[[5853618,5853618]]}', 'ethscription',5) IS DISTINCT FROM true
  OR public.verifier_inscription_criteria_valid(ids,'ordinal',5) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Small contribution rejected'; END IF;
 IF public.verifier_inscription_criteria_valid('{"kind":"numbers","ranges":[[10,1]]}', 'ordinal',5)
  OR public.verifier_inscription_criteria_valid('{"kind":"numbers","ranges":[[1,1],[1,2]]}', 'ordinal',5)
  OR public.verifier_inscription_criteria_valid('{"kind":"numbers","ranges":[]}', 'ordinal',5)
  OR public.verifier_inscription_criteria_valid('{"kind":"numbers","ranges":[[-1,-1]]}', 'ethscription',5)
  OR public.verifier_inscription_criteria_valid(ids,'ordinal',0)
  OR public.verifier_inscription_criteria_valid(ids,'ordinal',9007199254740992)
  THEN RAISE EXCEPTION 'Invalid criteria accepted'; END IF;
 a:=public.verifier_portal_mutate_rule('combined-inscription-test','admin','dddddddd-0000-4000-8000-000000000001',NULL,
 '{"server_id":"combined-inscription-test","server_name":"Test","channel_id":"channel","channel_name":"verify","role_id":"111111111111111111","role_name":"McSkull","asset_type":"ordinal","slug":null,"chain_id":null,"min_items":1,"inscription_criteria":{"kind":"numbers","ranges":[[10100838,10100838]]}}');
 rid:=(a->'after_rule'->>'id')::bigint;
 b:=public.verifier_portal_mutate_rule('combined-inscription-test','admin','dddddddd-0000-4000-8000-000000000002',a->'after_rule',jsonb_set(a->'after_rule','{min_items}','5'));
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=rid AND min_items=5 AND inscription_criteria->'ranges'='[[10100838,10100838]]'::jsonb) THEN RAISE EXCEPTION 'Edit lost selection or minimum'; END IF;
 candidate:=jsonb_set((b->'after_rule')-'id','{role_id}','"222222222222222222"');
 c:=public.verifier_portal_mutate_rule('combined-inscription-test','admin','dddddddd-0000-4000-8000-000000000003',NULL,candidate);
 IF c->'after_rule'->'min_items'<>'5'::jsonb OR c->'after_rule'->>'id'=rid::text THEN RAISE EXCEPTION 'Duplicate failed'; END IF;
 d:=public.verifier_portal_mutate_rule('combined-inscription-test','admin','dddddddd-0000-4000-8000-000000000004',b->'after_rule',b->'before_rule',(b->>'id')::uuid);
 PERFORM public.verifier_portal_mutate_rule('combined-inscription-test','admin','dddddddd-0000-4000-8000-000000000005',d->'after_rule',d->'before_rule',(d->>'id')::uuid);
 IF (SELECT min_items FROM public.verifier_rules WHERE id=rid)<>5 THEN RAISE EXCEPTION 'Undo/Redo failed'; END IF;
 BEGIN
  UPDATE public.verifier_rules SET min_items=0 WHERE id=rid;
  RAISE EXCEPTION 'Invalid minimum accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.verifier_rules SET inscription_criteria='{"kind":"numbers","ranges":[[10,1]]}' WHERE id=rid;
  RAISE EXCEPTION 'Reversed range accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
