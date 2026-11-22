DO $$ DECLARE scoped jsonb:=jsonb_build_object('kind','ids','ids',jsonb_build_array(repeat('a',64)||'i0'),'collection_slug','pizza-comrades'); bad jsonb;
BEGIN
 IF public.verifier_inscription_criteria_valid(scoped,'ordinal',5) IS DISTINCT FROM true
 OR NOT public.verifier_ordnet_compatible(jsonb_build_object('asset_type','ordinal','slug',null,'inscription_criteria',scoped))
 OR public.verifier_ordnet_compatible(jsonb_build_object('asset_type','ordinal','slug',null,'inscription_criteria',scoped-'collection_slug'))
 OR public.verifier_inscription_criteria_valid(scoped,'ethscription',1) IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Scoped ID validation/provider policy failed'; END IF;
 FOR bad IN SELECT value FROM jsonb_array_elements('[null,"","all","Pizza-Comrades","bad/slug",[],{},true,123]') LOOP
  IF public.verifier_inscription_criteria_valid(jsonb_set(scoped,'{collection_slug}',bad),'ordinal',1) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Malformed scope accepted'; END IF;
 END LOOP;
 IF public.verifier_inscription_criteria_valid(scoped || '{"ranges":[[1,1]]}','ordinal',1)
 OR public.verifier_inscription_criteria_valid(jsonb_set(scoped,'{ids}','[]'),'ordinal',1)
 OR public.verifier_inscription_criteria_valid(jsonb_set(scoped,'{ids}','["not-an-inscription"]'),'ordinal',1)
 THEN RAISE EXCEPTION 'Invalid ID selection accepted'; END IF;
END $$;
DO $$ DECLARE a jsonb; b jsonb; c jsonb; candidate jsonb; rid bigint; kind text;
BEGIN
 FOREACH kind IN ARRAY ARRAY['ids','numbers'] LOOP
  a:=public.verifier_portal_mutate_rule('id-collection-test','admin',gen_random_uuid(),NULL,jsonb_build_object(
   'server_id','id-collection-test','server_name','Test','channel_id',kind,'channel_name','verify',
   'role_id','111111111111111111','role_name','Collectors','additional_roles',jsonb_build_array(jsonb_build_object('id','222222222222222222','name','Extra')),
   'asset_type','ordinal','slug',null,'chain_id',null,'min_items',5,'rule_label','Subset',
   'inscription_criteria',CASE kind WHEN 'ids' THEN jsonb_build_object('kind','ids','ids',jsonb_build_array(repeat('a',64)||'i0'),'collection_slug','pizza-comrades')
    ELSE '{"kind":"numbers","ranges":[[1,10]],"collection_slug":"pizza-comrades"}'::jsonb END));
  rid:=(a->'after_rule'->>'id')::bigint;
  candidate:=a->'after_rule' || '{"inscription_criteria":null,"slug":"yonder","collection_name":"YONDER","rule_label":null,"ordinal_trait_snapshot":null}'::jsonb;
  b:=public.verifier_portal_mutate_rule('id-collection-test','admin',gen_random_uuid(),a->'after_rule',candidate);
  IF (b->'after_rule'->>'id')::bigint<>rid OR b->'after_rule'->'min_items'<>'5'::jsonb
   OR b->'after_rule'->'additional_roles' IS DISTINCT FROM a->'after_rule'->'additional_roles'
   OR b->'after_rule'->>'slug'<>'yonder' OR b->'after_rule'->'inscription_criteria'<>'null'::jsonb
   THEN RAISE EXCEPTION 'Conversion did not preserve identity/roles/minimum'; END IF;
  c:=public.verifier_portal_mutate_rule('id-collection-test','admin',gen_random_uuid(),b->'after_rule',b->'before_rule',(b->>'id')::uuid);
  IF c->'after_rule'->'inscription_criteria' IS DISTINCT FROM a->'after_rule'->'inscription_criteria' THEN RAISE EXCEPTION 'Undo lost selection'; END IF;
  PERFORM public.verifier_portal_mutate_rule('id-collection-test','admin',gen_random_uuid(),c->'after_rule',c->'before_rule',(c->>'id')::uuid);
  IF (SELECT slug FROM public.verifier_rules WHERE id=rid)<>'yonder' THEN RAISE EXCEPTION 'Redo lost collection'; END IF;
 END LOOP;
 IF has_function_privilege('anon','public.verifier_ordnet_compatible(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Public function access changed'; END IF;
END $$;
