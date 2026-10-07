BEGIN;

ALTER TABLE public.verifier_rules
  ADD COLUMN asset_type text NOT NULL DEFAULT 'ethscription',
  ADD COLUMN chain_id integer NOT NULL DEFAULT 1,
  ADD COLUMN contract_address text,
  ADD COLUMN token_standard text,
  ADD COLUMN token_ids text[],
  ADD COLUMN collection_name text;

ALTER TABLE public.verifier_rules ALTER COLUMN slug DROP NOT NULL;

CREATE FUNCTION public.verifier_nft_ids_valid(ids text[]) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
DECLARE
  id text;
  previous_id numeric := -1;
  current_id numeric;
BEGIN
  IF array_ndims(ids) <> 1 OR cardinality(ids) NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
  FOREACH id IN ARRAY ids LOOP
    IF id IS NULL OR id !~ '^(0|[1-9][0-9]{0,77})$' THEN RETURN false; END IF;
    current_id := id::numeric;
    IF current_id <= previous_id OR current_id > 115792089237316195423570985008687907853269984665640564039457584007913129639935 THEN RETURN false; END IF;
    previous_id := current_id;
  END LOOP;
  RETURN true;
END;
$$;

-- Keep long configured ID lists below PostgreSQL's btree entry size limit.
CREATE FUNCTION public.verifier_nft_ids_key(ids text[]) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT encode(sha256(convert_to(array_to_string(ids, ','), 'UTF8')), 'hex');
$$;

ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_asset_fields_check CHECK (
  (asset_type = 'ethscription' AND slug IS NOT NULL
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND collection_name IS NULL)
  OR
  (asset_type = 'nft' AND chain_id = 1 AND slug IS NULL
    AND attribute_key = 'ALL' AND attribute_value = 'ALL' AND min_items BETWEEN 1 AND 9007199254740991
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
);

ALTER TABLE public.verifier_rules DROP CONSTRAINT verifier_rules_unique_rule;
CREATE UNIQUE INDEX verifier_rules_ethscription_unique
  ON public.verifier_rules (server_id, channel_id, role_id, slug, attribute_key, attribute_value, min_items)
  WHERE asset_type = 'ethscription';
CREATE UNIQUE INDEX verifier_rules_nft_collection_unique
  ON public.verifier_rules (server_id, channel_id, role_id, chain_id, contract_address, token_standard, min_items)
  WHERE asset_type = 'nft' AND token_ids IS NULL;
CREATE UNIQUE INDEX verifier_rules_nft_tokens_unique
  ON public.verifier_rules (server_id, channel_id, role_id, chain_id, contract_address, token_standard,
    public.verifier_nft_ids_key(token_ids), min_items)
  WHERE asset_type = 'nft' AND token_ids IS NOT NULL;
CREATE INDEX verifier_rules_server_role ON public.verifier_rules (server_id, role_id);

COMMIT;
