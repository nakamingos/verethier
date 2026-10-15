BEGIN;
DO $$
DECLARE data jsonb; previous jsonb; accepted boolean; k integer; bad jsonb;
BEGIN
  IF has_table_privilege('anon', 'public.ordinal_collection_attributes', 'SELECT')
    OR has_table_privilege('authenticated', 'public.ordinal_collections', 'UPDATE')
    OR has_function_privilege('anon', 'public.get_ordinal_collection(text)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.replace_ordinal_collection(text,timestamptz,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.reserve_ordinal_provider_request()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Catalog or usage data is exposed to an unprivileged role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.replace_ordinal_collection(text,timestamptz,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Backend role cannot update catalogs';
  END IF;
  data := jsonb_build_array(jsonb_build_object('inscription_id', repeat('a',64)||'i1', 'values', jsonb_build_object('Category','Cosmic Oven-Lord')),
    jsonb_build_object('inscription_id', repeat('a',64)||'i2', 'values', jsonb_build_object('Category',jsonb_build_array('Pirate','Gold Bearer'))));
  accepted := public.replace_ordinal_collection('catalog-migration-test', now() - interval '1 hour', data);
  IF NOT accepted THEN RAISE EXCEPTION 'Initial catalog was not saved'; END IF;
  previous := public.get_ordinal_collection('catalog-migration-test');
  IF (previous->>'item_count')::integer <> 2 OR jsonb_array_length(previous->'items') <> 2
    OR previous::text LIKE '%"owner"%' THEN RAISE EXCEPTION 'Catalog content or ownership separation failed'; END IF;
  accepted := public.replace_ordinal_collection('catalog-migration-test', now() - interval '2 hours', data);
  IF accepted OR previous <> public.get_ordinal_collection('catalog-migration-test') THEN
    RAISE EXCEPTION 'An older scan replaced a newer catalog';
  END IF;
  FOREACH bad IN ARRAY ARRAY[
    '[]'::jsonb,
    jsonb_build_array(data->0, data->0),
    jsonb_build_array(jsonb_build_object('inscription_id','invalid','values','{}'::jsonb)),
    jsonb_build_array(jsonb_build_object('inscription_id',repeat('a',64)||'i1','values',NULL)),
    jsonb_build_array(jsonb_build_object('inscription_id',repeat('a',64)||'i1','values',jsonb_build_object('Category',42)))
  ] LOOP
    BEGIN
      PERFORM public.replace_ordinal_collection('catalog-migration-test', now(), bad);
      RAISE EXCEPTION 'Invalid catalog was accepted' USING ERRCODE = 'ZX001';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN RAISE;
      WHEN OTHERS THEN NULL;
    END;
    IF previous <> public.get_ordinal_collection('catalog-migration-test') THEN
      RAISE EXCEPTION 'A failed scan changed the existing catalog';
    END IF;
  END LOOP;
  -- The entire replacement, including removed attributes, is committed together.
  PERFORM public.replace_ordinal_collection('catalog-migration-test', now(), jsonb_build_array(data->1));
  IF (public.get_ordinal_collection('catalog-migration-test')->>'item_count')::integer <> 1
    OR (SELECT count(*) FROM public.ordinal_collection_attributes WHERE slug='catalog-migration-test') <> 1 THEN
    RAISE EXCEPTION 'Catalog replacement left old rows behind';
  END IF;
  -- Catalog reads remain complete above PostgREST's default 1,000-row limit.
  SELECT jsonb_agg(jsonb_build_object('inscription_id',repeat('b',64)||'i'||n,'values','{}'::jsonb))
    INTO data FROM generate_series(1,1200) n;
  PERFORM public.replace_ordinal_collection('large-catalog-test', now(), data);
  IF jsonb_array_length(public.get_ordinal_collection('large-catalog-test')->'items') <> 1200 THEN
    RAISE EXCEPTION 'Large catalog was truncated';
  END IF;
  DELETE FROM public.ordinal_provider_usage WHERE provider='ordiscan';
  FOR k IN 1..1000 LOOP
    IF NOT public.reserve_ordinal_provider_request() THEN RAISE EXCEPTION 'Allowance ended early'; END IF;
  END LOOP;
  IF public.reserve_ordinal_provider_request() OR (SELECT sum(requests) FROM public.ordinal_provider_usage WHERE provider='ordiscan') <> 1000 THEN
    RAISE EXCEPTION 'Ordiscan quota did not stop at 1,000 requests';
  END IF;
END;
$$;
ROLLBACK;
