DO $$ DECLARE a jsonb; b jsonb; c jsonb; d jsonb; candidate jsonb; p text:='911111111111111111'; x text:='922222222222222222';
 s text:='ordnet-policy-test';
BEGIN
 IF public.verifier_ordnet_compatible('{"asset_type":"ordinal","slug":"all"}')
  OR public.verifier_ordnet_compatible('{"asset_type":"ordinal","inscription_criteria":{"kind":"ids","ids":[]}}')
  OR public.verifier_ordnet_compatible('{"asset_type":"ordinal","inscription_criteria":{"kind":"numbers","ranges":[[1,2]]}}')
  OR NOT public.verifier_ordnet_compatible('{"asset_type":"ordinal","slug":"pizza-comrades","inscription_criteria":null}')
  OR NOT public.verifier_ordnet_compatible('{"asset_type":"ethscription"}') THEN RAISE EXCEPTION 'Compatibility forms wrong'; END IF;
 a:=public.verifier_portal_mutate_rule(s,'admin','dddddddd-0000-4000-8000-000000000001',NULL,
 jsonb_build_object('server_id',s,'server_name','Test','channel_id','verify','channel_name','verify','role_id',p,'role_name','Holder',
 'slug',NULL,'min_items',1,'asset_type','ordinal','chain_id',NULL,'inscription_criteria','{"kind":"numbers","ranges":[[1,10]]}'::jsonb));
 IF EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE action_id=(a->>'id')::uuid) THEN RAISE EXCEPTION 'Unsupported selection queued'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=(a->'after_rule'->>'id')::bigint) THEN RAISE EXCEPTION 'Unsupported rule was not saved'; END IF;
 -- Explicit repairs continue to queue, even for incompatible selections.
 INSERT INTO public.verifier_reconciliation_jobs(server_id,role_id) VALUES(s,p);
 INSERT INTO public.verifier_reconciliation_jobs(server_id,user_id) VALUES(s,'explicit-member');
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE server_id=s AND action_id IS NULL AND ordinal_provider_policy IS NULL)<>2 THEN RAISE EXCEPTION 'Explicit checks restricted'; END IF;
 candidate:=jsonb_set(a->'after_rule','{inscription_criteria,collection_slug}','"pizza-comrades"');
 b:=public.verifier_portal_mutate_rule(s,'admin','dddddddd-0000-4000-8000-000000000002',a->'after_rule',candidate);
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=(b->>'id')::uuid AND ordinal_provider_policy='ordnet-only')<>1 THEN RAISE EXCEPTION 'Compatible range not queued strictly'; END IF;
 -- An unscoped alternative contributing to the same output blocks the full role's automatic check.
 candidate:=jsonb_set((a->'after_rule')-'id','{channel_id}','"another-channel"');
 c:=public.verifier_portal_mutate_rule(s,'admin','dddddddd-0000-4000-8000-000000000003',NULL,candidate);
 IF EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE action_id=(c->>'id')::uuid) THEN RAISE EXCEPTION 'Incompatible alternative queued'; END IF;
 candidate:=jsonb_set(b->'after_rule','{additional_roles}',jsonb_build_array(jsonb_build_object('id',x,'name','Additional')));
 d:=public.verifier_portal_mutate_rule(s,'admin','dddddddd-0000-4000-8000-000000000004',b->'after_rule',candidate);
 IF EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE action_id=(d->>'id')::uuid AND role_id=p) THEN RAISE EXCEPTION 'Indirect unsupported role queued'; END IF;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=(d->>'id')::uuid AND role_id=x AND ordinal_provider_policy='ordnet-only')<>1 THEN RAISE EXCEPTION 'Independent compatible output not queued'; END IF;
 -- Moving an unsupported selection onto an additional output is also blocked.
 candidate:=jsonb_set(c->'after_rule','{additional_roles}',jsonb_build_array(jsonb_build_object('id',x,'name','Additional')));
 a:=public.verifier_portal_mutate_rule(s,'admin','dddddddd-0000-4000-8000-000000000005',c->'after_rule',candidate);
 IF EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE action_id=(a->>'id')::uuid) THEN RAISE EXCEPTION 'Additional-output conflict ignored'; END IF;
 -- Removing that alternative leaves only compatible checks; cleanup is supported.
 b:=public.verifier_portal_mutate_rule(s,'admin','dddddddd-0000-4000-8000-000000000006',a->'after_rule',NULL);
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=(b->>'id')::uuid AND ordinal_provider_policy='ordnet-only')<>2 THEN RAISE EXCEPTION 'Compatible cleanup lost'; END IF;
 -- Canonical collection rules are supported, with no inventory lookup required.
 candidate:=jsonb_set(jsonb_set((c->'after_rule')-'id','{slug}','"pizza-comrades"'),'{inscription_criteria}','null');
 candidate:=jsonb_set(candidate,'{role_id}','"933333333333333333"');
 c:=public.verifier_portal_mutate_rule(s,'admin','dddddddd-0000-4000-8000-000000000007',NULL,candidate);
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=(c->>'id')::uuid AND ordinal_provider_policy='ordnet-only')<>1 THEN RAISE EXCEPTION 'Collection rule not queued'; END IF;
 -- User-scoped jobs linked to a configuration action are not ordinary rule-save jobs.
 INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,user_id) VALUES((c->>'id')::uuid,s,'restriction-member');
 IF NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE user_id='restriction-member' AND ordinal_provider_policy IS NULL) THEN RAISE EXCEPTION 'User job changed'; END IF;
 IF has_function_privilege('anon','public.verifier_ordnet_compatible(jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.verifier_rule_save_provider_policy()','EXECUTE') THEN RAISE EXCEPTION 'Policy helper exposed'; END IF;
END $$;
