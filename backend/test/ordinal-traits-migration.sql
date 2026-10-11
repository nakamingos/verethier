BEGIN;
DO $$
DECLARE statement text;
BEGIN
  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, attribute_key, attribute_value, min_items)
    VALUES
      ('ordinal-trait-test', 'verify', 'holder', 'ordinal', NULL, 'yonder', 'Hat', 'Pirate', 2),
      ('ordinal-trait-test', 'verify', 'holder', 'ordinal', NULL, 'yonder', 'Hat', 'Red', 2),
      ('ordinal-trait-test', 'verify', 'holder', 'ordinal', NULL, 'yonder', 'Hat', 'ALL', 2),
      ('ordinal-trait-test', 'verify', 'holder', 'ordinal', NULL, 'yonder', 'ALL', 'ALL', 2);
  BEGIN
    INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, attribute_key, attribute_value, min_items)
      VALUES ('ordinal-trait-test', 'verify', 'holder', 'ordinal', NULL, 'yonder', 'Hat', 'Pirate', 2);
    RAISE EXCEPTION 'Duplicate Ordinals trait rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.verifier_rules SET ordinal_trait_snapshot = jsonb_build_object(
    'inscription_ids', jsonb_build_array(repeat('a',64) || 'i0'),
    'criteria_hash', repeat('b',64), 'fetched_at', '2026-10-11T00:00:00.000Z')
    WHERE server_id = 'ordinal-trait-test' AND attribute_value = 'Pirate';
  IF NOT EXISTS (SELECT 1 FROM public.verifier_rules WHERE server_id = 'ordinal-trait-test'
    AND ordinal_trait_snapshot->'inscription_ids' = jsonb_build_array(repeat('a',64) || 'i0')) THEN
    RAISE EXCEPTION 'Ordinals trait snapshot was not stored';
  END IF;
  FOREACH statement IN ARRAY ARRAY[
    $q$UPDATE public.verifier_rules SET attribute_key = NULL WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_value = NULL WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = '' WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_value = '' WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = ' Hat ' WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_value = ' Pirate ' WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = repeat('a',101) WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = 'ALL', attribute_value = 'Pirate' WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET min_items = 0 WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET chain_id = 1 WHERE server_id = 'ordinal-trait-test'$q$,
    $q$UPDATE public.verifier_rules SET token_standard = 'erc721' WHERE server_id = 'ordinal-trait-test'$q$
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Invalid Ordinals trait fields were accepted: %', statement;
    EXCEPTION WHEN check_violation OR not_null_violation THEN NULL;
    END;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.verifier_rules'::regclass) THEN
    RAISE EXCEPTION 'Verifier rule RLS was disabled';
  END IF;
END;
$$;
ROLLBACK;
