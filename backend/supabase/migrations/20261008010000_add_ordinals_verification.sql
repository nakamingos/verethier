BEGIN;

ALTER TABLE public.user_wallets
  ADD COLUMN wallet_type text NOT NULL DEFAULT 'evm';
ALTER TABLE public.user_wallets DROP CONSTRAINT user_wallets_address_check;
ALTER TABLE public.user_wallets ADD CONSTRAINT user_wallets_address_check CHECK (
  (wallet_type = 'evm' AND address ~ '^0x[a-fA-F0-9]{40}$')
  OR (wallet_type = 'bitcoin' AND address ~ '^bc1p[ac-hj-np-z02-9]{58}$')
);
-- Checksum, network and Taproot script validation happen before a wallet is saved.
-- Keep the existing unique-address index and wallet claim behavior.

ALTER TABLE public.verifier_rules ALTER COLUMN chain_id DROP NOT NULL;
ALTER TABLE public.verifier_rules DROP CONSTRAINT verifier_rules_asset_fields_check;
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_asset_fields_check CHECK (
  (asset_type = 'ethscription' AND slug IS NOT NULL AND chain_id IS NOT NULL
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND collection_name IS NULL)
  OR
  (asset_type = 'nft' AND chain_id IS NOT NULL AND chain_id IN (1, 4663) AND slug IS NULL
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
  OR
  (asset_type = 'ordinal' AND chain_id IS NULL
    AND slug IS NOT NULL AND slug <> 'all' AND slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    AND attribute_key = 'ALL' AND attribute_value = 'ALL'
    AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100))
);

CREATE UNIQUE INDEX verifier_rules_ordinal_unique
  ON public.verifier_rules (server_id, channel_id, role_id, slug, min_items)
  WHERE asset_type = 'ordinal';

NOTIFY pgrst, 'reload schema';
COMMIT;
