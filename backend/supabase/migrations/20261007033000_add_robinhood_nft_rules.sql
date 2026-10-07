BEGIN;

-- Existing rules and indexes already store chain_id. Only expand the allowed NFT networks.
ALTER TABLE public.verifier_rules DROP CONSTRAINT verifier_rules_asset_fields_check;
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_asset_fields_check CHECK (
  (asset_type = 'ethscription' AND slug IS NOT NULL
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND collection_name IS NULL)
  OR
  (asset_type = 'nft' AND chain_id IN (1, 4663) AND slug IS NULL
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

NOTIFY pgrst, 'reload schema';
COMMIT;
