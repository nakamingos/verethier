-- One collection per rule. Shared roles/minimums combine in the verification engine.
BEGIN;
LOCK TABLE public.verifier_rules IN SHARE ROW EXCLUSIVE MODE;

DO $$
DECLARE
  source public.verifier_rules%ROWTYPE;
  collections text[];
  collection text;
  clone jsonb;
BEGIN
  FOR source IN SELECT * FROM public.verifier_rules WHERE position(',' in slug) > 0 ORDER BY id LOOP
    -- Multi-collection traits were never supported. Abort rather than change any
    -- unexpected rule's meaning; the whole migration rolls back on failure.
    IF source.asset_type <> 'ethscription' OR source.inscription_criteria IS NOT NULL
      OR source.attribute_key <> 'ALL' OR source.attribute_value <> 'ALL' THEN
      RAISE EXCEPTION 'Unsupported multi-collection rule: %', source.id;
    END IF;
    SELECT array_agg(value ORDER BY value) INTO collections
      FROM (SELECT DISTINCT btrim(value) AS value FROM unnest(string_to_array(source.slug, ',')) value) parts;
    IF cardinality(collections) < 1 OR '' = ANY(collections)
      OR 'ALL' = ANY(collections) OR 'all-collections' = ANY(collections) THEN
      RAISE EXCEPTION 'Ambiguous multi-collection rule: %', source.id;
    END IF;

    -- Keep the source ID, so existing assignment references and audit history stay valid.
    -- An unexpected collision rolls back; never silently delete a referenced rule.
    UPDATE public.verifier_rules SET slug = collections[1] WHERE id = source.id;
    FOREACH collection IN ARRAY collections[2:cardinality(collections)] LOOP
      -- Reuse an equivalent existing single-collection rule if it already exists.
      IF NOT EXISTS (SELECT 1 FROM public.verifier_rules r
        WHERE r.asset_type = source.asset_type AND r.server_id = source.server_id
          AND r.channel_id = source.channel_id AND r.role_id = source.role_id
          AND r.slug = collection AND r.attribute_key = source.attribute_key
          AND r.attribute_value = source.attribute_value AND r.min_items = source.min_items
          AND r.inscription_criteria IS NULL) THEN
        clone := to_jsonb(source) || jsonb_build_object('slug', collection,
          'id', nextval(pg_get_serial_sequence('public.verifier_rules', 'id')));
        INSERT INTO public.verifier_rules SELECT (jsonb_populate_record(NULL::public.verifier_rules, clone)).*;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_single_collection
  CHECK (slug IS NULL OR position(',' in slug) = 0);
NOTIFY pgrst, 'reload schema';
COMMIT;
