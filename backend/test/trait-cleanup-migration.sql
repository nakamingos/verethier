DO $$
DECLARE r public.verifier_rules; old_shape jsonb; a jsonb; f jsonb:='{"operator":"AND","conditions":[{"key":"Hat","value":"Crown"}]}';
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='verifier_rules' AND column_name IN ('attribute_key','attribute_value')) THEN RAISE EXCEPTION 'Legacy columns remain'; END IF;
 INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,trait_filter,min_items)
 VALUES('cleanup-test','verify','holder','ethscription',1,'comrades',f,1) RETURNING * INTO r;
 IF r.trait_filter IS DISTINCT FROM f THEN RAISE EXCEPTION 'Canonical insert lost'; END IF;
 -- Preserve pre-upgrade audit snapshots byte-for-byte, translating their input
 -- shape only when restoring them through the existing portal mutation RPC.
 old_shape:=(to_jsonb(r)-'trait_filter'-'trait_key')||jsonb_build_object('attribute_key','Hat','attribute_value','Crown');
 a:=public.verifier_portal_mutate_rule(r.server_id,'admin','a1111111-1111-4111-8111-111111111111',old_shape,NULL);
 PERFORM public.verifier_portal_mutate_rule(r.server_id,'admin','a2222222-2222-4222-8222-222222222222',NULL,a->'before_rule',(a->>'id')::uuid);
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=r.id AND trait_filter=f) THEN RAISE EXCEPTION 'Historical Undo lost traits'; END IF;
 IF (SELECT before_rule FROM public.verifier_portal_actions WHERE id=(a->>'id')::uuid) IS DISTINCT FROM old_shape THEN RAISE EXCEPTION 'Historical audit rewritten'; END IF;
 BEGIN
  UPDATE public.verifier_rules SET trait_filter='{"operator":"BAD","conditions":[]}' WHERE id=r.id;
  RAISE EXCEPTION 'Malformed filter accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,trait_filter,min_items)
 VALUES('cleanup-test','verify','ordinal','ordinal',NULL,'comrades',f,1) RETURNING * INTO r;
 BEGIN
  UPDATE public.verifier_rules SET trait_filter='{"operator":"AND","conditions":[{"key":"ALL","value":"Crown"}]}' WHERE id=r.id;
  RAISE EXCEPTION 'Wildcard key accepted for Ordinals';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  UPDATE public.verifier_rules SET trait_filter=jsonb_build_object('operator','AND','conditions',jsonb_build_array(jsonb_build_object('key',repeat('x',101),'value','Crown'))) WHERE id=r.id;
  RAISE EXCEPTION 'Long collectible key accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 UPDATE public.verifier_rules SET ordinal_trait_snapshot='{"criteria_hash":"old","fetched_at":"2026-10-19T00:00:00.000Z","inscription_ids":[]}' WHERE id=r.id;
 UPDATE public.verifier_rules SET trait_filter='{"operator":"AND","conditions":[{"key":"Hat","value":"Cap"}]}' WHERE id=r.id RETURNING * INTO r;
 IF r.ordinal_trait_snapshot IS NOT NULL THEN RAISE EXCEPTION 'Stale snapshot retained'; END IF;
 INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,trait_filter,min_items,inscription_criteria)
 VALUES('cleanup-test','verify','selected','ordinal',NULL,NULL,NULL,1,'{"kind":"numbers","ranges":[[1,2]]}') RETURNING * INTO r;
 BEGIN UPDATE public.verifier_rules SET trait_filter=f WHERE id=r.id; RAISE EXCEPTION 'Selected rule accepted traits';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 IF has_function_privilege('anon','public.verifier_normalize_traits()','EXECUTE') OR has_function_privilege('authenticated','public.verifier_collectible_traits_valid(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Helper permissions leaked'; END IF;
END $$;
