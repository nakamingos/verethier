BEGIN;

-- Permanent administrator selections, separate from expiring trait snapshots.
ALTER TABLE public.verifier_rules ADD COLUMN inscription_criteria jsonb;

CREATE FUNCTION public.verifier_inscription_criteria_valid(criteria jsonb, asset text, minimum bigint)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
DECLARE
  entry jsonb;
  identifier text;
  previous_id text;
  start_number numeric;
  end_number numeric;
  previous_end numeric;
  capacity numeric := 0;
BEGIN
  IF jsonb_typeof(criteria) IS DISTINCT FROM 'object' OR asset NOT IN ('ordinal', 'ethscription')
    OR minimum NOT BETWEEN 1 AND 9007199254740991 THEN RETURN false; END IF;
  IF criteria->>'kind' = 'ids' THEN
    IF criteria - 'kind' - 'ids' <> '{}'::jsonb OR jsonb_typeof(criteria->'ids') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(criteria->'ids') NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(criteria->'ids') LOOP
      IF jsonb_typeof(entry) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      identifier := entry #>> '{}';
      IF (asset = 'ordinal' AND identifier !~ '^[0-9a-f]{64}i(0|[1-9][0-9]*)$')
        OR (asset = 'ethscription' AND identifier !~ '^0x[0-9a-f]{64}$')
        OR (previous_id IS NOT NULL AND previous_id COLLATE "C" >= identifier COLLATE "C") THEN RETURN false; END IF;
      previous_id := identifier;
    END LOOP;
    capacity := jsonb_array_length(criteria->'ids');
  ELSIF criteria->>'kind' = 'numbers' THEN
    IF criteria - 'kind' - 'ranges' <> '{}'::jsonb OR jsonb_typeof(criteria->'ranges') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(criteria->'ranges') NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(criteria->'ranges') LOOP
      IF jsonb_typeof(entry) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
      IF jsonb_array_length(entry) <> 2 THEN RETURN false; END IF;
      IF jsonb_typeof(entry->0) IS DISTINCT FROM 'number' OR jsonb_typeof(entry->1) IS DISTINCT FROM 'number'
        OR (entry->>0) !~ '^-?(0|[1-9][0-9]*)$' OR (entry->>1) !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
      start_number := (entry->>0)::numeric;
      end_number := (entry->>1)::numeric;
      IF start_number < -9007199254740991 OR end_number > 9007199254740991 OR start_number > end_number
        OR (asset = 'ethscription' AND start_number < 0)
        OR (previous_end IS NOT NULL AND start_number <= previous_end + 1) THEN RETURN false; END IF;
      previous_end := end_number;
      capacity := capacity + end_number - start_number + 1;
    END LOOP;
  ELSE RETURN false;
  END IF;
  RETURN minimum <= capacity;
END;
$$;

CREATE FUNCTION public.verifier_inscription_criteria_key(criteria jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(criteria::text, 'UTF8')), 'hex');
$$;

ALTER TABLE public.verifier_rules DROP CONSTRAINT verifier_rules_asset_fields_check;
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_asset_fields_check CHECK (
  (asset_type = 'ethscription' AND slug IS NOT NULL AND chain_id IS NOT NULL AND inscription_criteria IS NULL
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND collection_name IS NULL)
  OR
  (asset_type = 'nft' AND inscription_criteria IS NULL AND chain_id IS NOT NULL AND chain_id IN (1, 4663) AND slug IS NULL
    AND attribute_key IS NOT NULL AND attribute_value IS NOT NULL
    AND char_length(attribute_key) BETWEEN 1 AND 100 AND attribute_key = btrim(attribute_key)
    AND char_length(attribute_value) BETWEEN 1 AND 100 AND attribute_value = btrim(attribute_value)
    AND (attribute_key <> 'ALL' OR attribute_value = 'ALL')
    AND min_items BETWEEN 1 AND 9007199254740991
    AND contract_address IS NOT NULL AND contract_address ~ '^0x[0-9a-f]{40}$'
    AND contract_address <> '0x0000000000000000000000000000000000000000'
    AND token_standard IS NOT NULL AND token_standard IN ('erc721', 'erc1155')
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100)
    AND (
      (token_standard = 'erc721' AND (token_ids IS NULL OR
        (public.verifier_nft_ids_valid(token_ids) AND cardinality(token_ids) = 1 AND min_items = 1)))
      OR
      (token_standard = 'erc1155' AND token_ids IS NOT NULL AND public.verifier_nft_ids_valid(token_ids))
    ))
  OR
  (asset_type = 'ordinal' AND inscription_criteria IS NULL AND chain_id IS NULL
    AND slug IS NOT NULL AND slug <> 'all' AND slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    AND attribute_key IS NOT NULL AND attribute_value IS NOT NULL
    AND char_length(attribute_key) BETWEEN 1 AND 100 AND attribute_key = btrim(attribute_key)
    AND char_length(attribute_value) BETWEEN 1 AND 100 AND attribute_value = btrim(attribute_value)
    AND (attribute_key <> 'ALL' OR attribute_value = 'ALL')
    AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100))
  OR
  (asset_type IN ('ethscription', 'ordinal') AND slug IS NULL
    AND inscription_criteria IS NOT NULL
    AND public.verifier_inscription_criteria_valid(inscription_criteria, asset_type, min_items) IS TRUE
    AND attribute_key IS NOT NULL AND attribute_key = 'ALL'
    AND attribute_value IS NOT NULL AND attribute_value = 'ALL'
    AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
    AND ((asset_type = 'ordinal' AND chain_id IS NULL) OR (asset_type = 'ethscription' AND chain_id IS NOT NULL AND chain_id = 1))
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND collection_name IS NULL AND ordinal_trait_snapshot IS NULL)
);

DROP INDEX public.verifier_rules_ordinal_unique;
CREATE UNIQUE INDEX verifier_rules_ordinal_unique
  ON public.verifier_rules (server_id, channel_id, role_id, slug, attribute_key, attribute_value, min_items)
  WHERE asset_type = 'ordinal' AND inscription_criteria IS NULL;
CREATE UNIQUE INDEX verifier_rules_inscription_unique
  ON public.verifier_rules (server_id, channel_id, role_id, asset_type,
    public.verifier_inscription_criteria_key(inscription_criteria), min_items)
  WHERE inscription_criteria IS NOT NULL;

NOTIFY pgrst, 'reload schema';
COMMIT;
