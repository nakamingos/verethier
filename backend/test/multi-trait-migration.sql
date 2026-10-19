DO $$
DECLARE r public.verifier_rules; a jsonb; b jsonb; f jsonb:='{"operator":"AND","conditions":[{"key":"Background","value":"Blue"},{"key":"Hat","value":"Crown"}]}';
BEGIN
 INSERT INTO public.verifier_rules(server_id,server_name,channel_id,channel_name,role_id,role_name,asset_type,slug,attribute_key,attribute_value,min_items)
 VALUES('901111111111111111','Test','902222222222222222','Verify','903333333333333333','Member','ethscription','comrades','Hat','Crown',1) RETURNING * INTO r;
 IF r.trait_filter IS DISTINCT FROM '{"operator":"AND","conditions":[{"key":"Hat","value":"Crown"}]}'::jsonb THEN RAISE EXCEPTION 'Legacy input lost'; END IF;
 UPDATE public.verifier_rules SET trait_filter=f WHERE id=r.id RETURNING * INTO r;
 IF r.trait_key IS DISTINCT FROM public.verifier_traits_key('{"operator":"AND","conditions":[{"key":"hat","value":"crown"},{"key":"BACKGROUND","value":"BLUE"}]}') THEN RAISE EXCEPTION 'Canonical identity mismatch'; END IF;
 BEGIN
  INSERT INTO public.verifier_rules(server_id,server_name,channel_id,channel_name,role_id,role_name,asset_type,slug,trait_filter,min_items)
  VALUES(r.server_id,r.server_name,r.channel_id,r.channel_name,r.role_id,r.role_name,r.asset_type,r.slug,'{"operator":"AND","conditions":[{"key":"hat","value":"crown"},{"key":"BACKGROUND","value":"BLUE"}]}',1);
  RAISE EXCEPTION 'Duplicate accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 IF has_function_privilege('anon','public.verifier_traits_normalize(jsonb)','EXECUTE')
   OR has_function_privilege('authenticated','public.verifier_portal_mutate_rule(text,text,uuid,jsonb,jsonb,uuid)','EXECUTE')
   OR NOT has_function_privilege('service_role','public.verifier_traits_normalize(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Unsafe permissions'; END IF;
 BEGIN
  UPDATE public.verifier_rules SET attribute_value='Cap' WHERE id=r.id;
  RAISE EXCEPTION 'Legacy edit truncated conditions';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 a:=to_jsonb(r); b:=jsonb_set(a,'{trait_filter}','{"operator":"OR","conditions":[{"key":"Hat","value":"Crown"},{"key":"Background","value":"Blue"}]}');
 a:=public.verifier_portal_mutate_rule(r.server_id,'904444444444444444','90111111-1111-4111-8111-111111111111',a,b);
 IF (SELECT trait_filter->>'operator' FROM public.verifier_rules WHERE id=r.id)<>'OR' THEN RAISE EXCEPTION 'Portal edit lost'; END IF;
 PERFORM public.verifier_portal_mutate_rule(r.server_id,'904444444444444444','90222222-2222-4222-8222-222222222222',a->'after_rule',a->'before_rule',(a->>'id')::uuid);
 IF (SELECT trait_filter FROM public.verifier_rules WHERE id=r.id) IS DISTINCT FROM f THEN RAISE EXCEPTION 'Undo lost conditions'; END IF;
 UPDATE public.verifier_rules SET trait_filter=NULL WHERE id=r.id RETURNING * INTO r;
 IF r.attribute_key<>'ALL' OR r.attribute_value<>'ALL' THEN RAISE EXCEPTION 'Clear traits left stale pair'; END IF;
 -- Old audit snapshots omit the new fields; reversing them must still recover
 -- the original single condition without changing the rule ID.
 a:=to_jsonb(r)-'trait_filter'-'trait_key';
 b:=jsonb_set(a,'{attribute_key}','"Hat"'); b:=jsonb_set(b,'{attribute_value}','"Crown"');
 a:=public.verifier_portal_mutate_rule(r.server_id,'904444444444444444','90333333-3333-4333-8333-333333333333',a,b);
 PERFORM public.verifier_portal_mutate_rule(r.server_id,'904444444444444444','90444444-4444-4444-8444-444444444444',a->'after_rule',a->'before_rule',(a->>'id')::uuid);
 IF (SELECT trait_filter FROM public.verifier_rules WHERE id=r.id) IS NOT NULL THEN RAISE EXCEPTION 'Old audit undo lost legacy semantics'; END IF;
 BEGIN
  UPDATE public.verifier_rules SET trait_filter='{"operator":"X","conditions":[]}' WHERE id=r.id;
  RAISE EXCEPTION 'Invalid filter accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 INSERT INTO public.verifier_rules(server_id,server_name,channel_id,channel_name,role_id,role_name,asset_type,slug,trait_filter,min_items,ordinal_trait_snapshot,chain_id)
 VALUES(r.server_id,r.server_name,r.channel_id,r.channel_name,r.role_id,r.role_name,'ordinal','comrades',f,1,'{"criteria_hash":"old","fetched_at":"2026-10-18T00:00:00.000Z","inscription_ids":[]}',NULL) RETURNING * INTO r;
 UPDATE public.verifier_rules SET trait_filter=jsonb_set(f,'{operator}','"OR"') WHERE id=r.id RETURNING * INTO r;
 IF r.ordinal_trait_snapshot IS NOT NULL THEN RAISE EXCEPTION 'Stale snapshot retained'; END IF;
END $$;
