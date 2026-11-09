DO $$ DECLARE a jsonb; b jsonb; c jsonb; d jsonb; e jsonb; candidate jsonb; rid bigint;
 p text:='111111111111111111'; x text:='222222222222222222'; y text:='333333333333333333';
BEGIN
 IF NOT public.verifier_additional_roles_valid(p,'[]') OR public.verifier_additional_roles_valid(p,jsonb_build_array(jsonb_build_object('id',p,'name','Duplicate')))
  OR public.verifier_additional_roles_valid(p,'[{"id":"bad","name":"Bad"}]') OR public.verifier_additional_roles_valid(p,'null') THEN RAISE EXCEPTION 'Output validation failed'; END IF;
 a:=public.verifier_portal_mutate_rule('multi-role-test','admin','cccccccc-0000-4000-8000-000000000001',NULL,
 jsonb_build_object('server_id','multi-role-test','server_name','Test','channel_id','channel','channel_name','verify','role_id',p,'role_name','Primary',
 'slug',NULL,'min_items',1,'asset_type','ordinal','chain_id',NULL,'inscription_criteria','{"kind":"numbers","ranges":[[1,10],[20,20]]}'::jsonb));
 rid:=(a->'after_rule'->>'id')::bigint;
 IF a->'after_rule'->'additional_roles'<>'[]'::jsonb THEN RAISE EXCEPTION 'Legacy output default changed'; END IF;
 INSERT INTO public.verifier_user_roles(user_id,server_id,role_id,rule_id,status) VALUES('member','multi-role-test',p,rid,'active');
 candidate:=jsonb_set(a->'after_rule','{additional_roles}',jsonb_build_array(jsonb_build_object('id',x,'name','Additional')));
 b:=public.verifier_portal_mutate_rule('multi-role-test','admin','cccccccc-0000-4000-8000-000000000002',a->'after_rule',candidate);
 IF (SELECT member_ids FROM public.verifier_reconciliation_jobs WHERE action_id=(b->>'id')::uuid AND role_id=x) IS DISTINCT FROM ARRAY['member'] THEN RAISE EXCEPTION 'Added output did not inherit fresh-check audience'; END IF;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=(b->>'id')::uuid)<>2 THEN RAISE EXCEPTION 'Output jobs missing'; END IF;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('multi-role-test','admin','cccccccc-0000-4000-8000-000000000003',a->'after_rule',NULL);
  RAISE EXCEPTION 'Stale output edit accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 -- A duplicate is independent and gets a new canonical ID, retaining every range.
 candidate:=jsonb_set((a->'after_rule')-'id','{role_id}',to_jsonb(y));
 c:=public.verifier_portal_mutate_rule('multi-role-test','admin','cccccccc-0000-4000-8000-000000000004',NULL,candidate);
 IF c->'after_rule'->>'id'=rid::text OR c->'after_rule'->'inscription_criteria'<>a->'after_rule'->'inscription_criteria' THEN RAISE EXCEPTION 'Duplicate lost its independent identity or ranges'; END IF;
 BEGIN
  candidate:=jsonb_set((a->'after_rule')-'id','{role_id}',to_jsonb(x));
  PERFORM public.verifier_portal_mutate_rule('multi-role-test','admin','cccccccc-0000-4000-8000-000000000005',NULL,candidate);
  RAISE EXCEPTION 'Overlapping additional output accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 d:=public.verifier_portal_mutate_rule('multi-role-test','admin','cccccccc-0000-4000-8000-000000000006',b->'after_rule',a->'after_rule',(b->>'id')::uuid);
 IF d->'after_rule'->'additional_roles'<>'[]'::jsonb THEN RAISE EXCEPTION 'Undo failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE action_id=(d->>'id')::uuid AND role_id=x AND rule_id IS NULL) THEN RAISE EXCEPTION 'Removed output cleanup missing'; END IF;
 e:=public.verifier_portal_mutate_rule('multi-role-test','admin','cccccccc-0000-4000-8000-000000000007',d->'after_rule',d->'before_rule',(d->>'id')::uuid);
 IF e->'after_rule'->'additional_roles'<>b->'after_rule'->'additional_roles' THEN RAISE EXCEPTION 'Redo failed'; END IF;
 IF public.verifier_portal_definition(e->'after_rule') IS DISTINCT FROM public.verifier_portal_definition(jsonb_set(e->'after_rule','{additional_roles,0,name}','"Renamed"')) THEN RAISE EXCEPTION 'Name change affected guard'; END IF;
 IF has_function_privilege('anon','public.verifier_rule_role_ids(jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.verifier_portal_mutate_rule(text,text,uuid,jsonb,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Mutation permission exposed'; END IF;
END $$;
