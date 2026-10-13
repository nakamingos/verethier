BEGIN;
ALTER TABLE public.verifier_rules
  ADD COLUMN min_balance text,
  ADD COLUMN token_decimals smallint,
  ADD COLUMN token_symbol text;

COMMENT ON COLUMN public.verifier_rules.min_balance IS 'ERC-20 minimum in exact canonical base units; display using token_decimals';
ALTER TABLE public.verifier_rules DROP CONSTRAINT verifier_rules_asset_fields_check;
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_asset_fields_check CHECK (
  (asset_type <> 'erc20' AND min_balance IS NULL AND token_decimals IS NULL AND token_symbol IS NULL AND (
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
  )) OR (
    asset_type = 'erc20' AND chain_id IS NOT NULL AND chain_id IN (1, 4663)
    AND contract_address IS NOT NULL AND contract_address ~ '^0x[0-9a-f]{40}$'
    AND contract_address <> '0x0000000000000000000000000000000000000000'
    AND slug IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND inscription_criteria IS NULL AND ordinal_trait_snapshot IS NULL
    AND attribute_key IS NOT NULL AND attribute_key = 'ALL'
    AND attribute_value IS NOT NULL AND attribute_value = 'ALL'
    AND min_items IS NULL AND token_decimals IS NOT NULL AND token_decimals BETWEEN 0 AND 255
    AND min_balance IS NOT NULL
    AND CASE WHEN min_balance ~ '^[1-9][0-9]{0,77}$' THEN min_balance::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 ELSE false END
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100)
    AND (token_symbol IS NULL OR char_length(token_symbol) BETWEEN 1 AND 32)
  )
);
CREATE UNIQUE INDEX verifier_rules_erc20_unique ON public.verifier_rules
  (server_id, channel_id, role_id, chain_id, contract_address, min_balance) WHERE asset_type = 'erc20';
NOTIFY pgrst, 'reload schema';
COMMIT;
