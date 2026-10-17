DO $$ DECLARE a jsonb; b jsonb; c jsonb; d jsonb; candidate jsonb; rid bigint; sibling bigint; counter integer;
BEGIN
 a:=public.verifier_portal_mutate_rule('role-test','admin','bbbbbbbb-0000-4000-8000-000000000001',NULL,
 '{"server_id":"role-test","server_name":"Test","channel_id":"channel","channel_name":"verify","role_id":"old-role","role_name":"Old role","slug":"ALL","attribute_key":"ALL","attribute_value":"ALL","min_items":1,"asset_type":"ethscription","chain_id":1}'::jsonb);
 rid:=(a->'after_rule'->>'id')::bigint;
 INSERT INTO public.verifier_rules(server_id,role_id,slug,min_items) VALUES('role-test','old-role','another-collection',1) RETURNING id INTO sibling;
 INSERT INTO public.verifier_user_roles(user_id,server_id,role_id,rule_id,status) VALUES
  ('111111111111111111','role-test','old-role',rid,'active'),
  ('222222222222222222','role-test','old-role',sibling,'revoked');
 candidate:=jsonb_set(jsonb_set(a->'after_rule','{role_id}','"new-role"'),'{role_name}','"New role"');
 b:=public.verifier_portal_mutate_rule('role-test','admin','bbbbbbbb-0000-4000-8000-000000000002',a->'after_rule',candidate);
 IF b->'after_rule'->>'role_id'<>'new-role' OR b->'after_rule'->>'role_name'<>'New role' THEN RAISE EXCEPTION 'Role edit failed'; END IF;
 IF (SELECT member_ids FROM public.verifier_reconciliation_jobs WHERE action_id=(b->>'id')::uuid AND rule_id=rid)
  IS DISTINCT FROM ARRAY['111111111111111111','222222222222222222'] THEN RAISE EXCEPTION 'Combined-role audience was lost'; END IF;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=(b->>'id')::uuid AND role_id='old-role' AND member_ids IS NULL)<>1 THEN RAISE EXCEPTION 'Old role cleanup missing'; END IF;
 c:=public.verifier_portal_mutate_rule('role-test','admin','bbbbbbbb-0000-4000-8000-000000000003',b->'after_rule',jsonb_set(b->'after_rule','{role_id}','"third-role"'));
 IF (SELECT cardinality(member_ids) FROM public.verifier_reconciliation_jobs WHERE action_id=(c->>'id')::uuid AND rule_id=rid)<>2 THEN RAISE EXCEPTION 'Rapid edit stranded pending members'; END IF;
 d:=public.verifier_portal_mutate_rule('role-test','admin','bbbbbbbb-0000-4000-8000-000000000004',c->'after_rule',c->'before_rule',(c->>'id')::uuid);
 IF d->'after_rule'->>'role_id'<>'new-role' THEN RAISE EXCEPTION 'Role Undo failed'; END IF;
 IF (SELECT cardinality(member_ids) FROM public.verifier_reconciliation_jobs WHERE action_id=(d->>'id')::uuid AND rule_id=rid)<>2 THEN RAISE EXCEPTION 'Undo lost pending audience'; END IF;
 c:=public.verifier_portal_mutate_rule('role-test','admin','bbbbbbbb-0000-4000-8000-000000000005',d->'after_rule',d->'before_rule',(d->>'id')::uuid);
 IF c->'after_rule'->>'role_id'<>'third-role' THEN RAISE EXCEPTION 'Role Redo failed'; END IF;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('role-test','admin','bbbbbbbb-0000-4000-8000-000000000006',a->'after_rule',NULL);
  RAISE EXCEPTION 'Stale role edit accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 INSERT INTO public.verifier_rules(server_id,channel_id,role_id,slug,attribute_key,attribute_value,min_items) VALUES('role-test','channel','occupied-role','ALL','ALL','ALL',1);
 SELECT count(*) INTO counter FROM public.verifier_reconciliation_jobs;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('role-test','admin','bbbbbbbb-0000-4000-8000-000000000007',c->'after_rule',jsonb_set(c->'after_rule','{role_id}','"occupied-role"'));
  RAISE EXCEPTION 'Duplicate role criteria accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs)<>counter THEN RAISE EXCEPTION 'Failed edit left partial jobs'; END IF;
 IF has_table_privilege('anon','public.verifier_reconciliation_jobs','SELECT') OR has_function_privilege('authenticated','public.verifier_portal_mutate_rule(text,text,uuid,jsonb,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Role audience exposed'; END IF;
END $$;
