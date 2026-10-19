BEGIN;
-- Deploy the canonical-storage application before applying this contraction.
-- Historical audit JSON retains its original shape and is translated on restore.
CREATE FUNCTION public.verifier_collectible_traits_valid(f jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT f IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f->'conditions') c
  WHERE c->>'key'='ALL' OR length(c->>'key')>100 OR length(c->>'value')>100);
$$;
REVOKE ALL ON FUNCTION public.verifier_collectible_traits_valid(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_collectible_traits_valid(jsonb) TO service_role;
DROP TRIGGER verifier_rules_00_traits ON public.verifier_rules;
DROP FUNCTION public.verifier_sync_traits();
CREATE FUNCTION public.verifier_normalize_traits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 NEW.trait_filter:=public.verifier_traits_normalize(NEW.trait_filter);
 IF NEW.trait_filter IS NOT NULL AND (NEW.asset_type='erc20' OR NEW.inscription_criteria IS NOT NULL) THEN
  RAISE EXCEPTION 'This rule type does not support traits' USING ERRCODE='22023'; END IF;
 IF NEW.asset_type IN ('nft','ordinal') AND NOT public.verifier_collectible_traits_valid(NEW.trait_filter) THEN
  RAISE EXCEPTION 'NFT and Ordinals traits require a key and 1-100 character values' USING ERRCODE='22023'; END IF;
 IF TG_OP='UPDATE' AND NEW.ordinal_trait_snapshot IS NOT DISTINCT FROM OLD.ordinal_trait_snapshot
  AND (public.verifier_traits_key(NEW.trait_filter) IS DISTINCT FROM OLD.trait_key OR NEW.slug IS DISTINCT FROM OLD.slug)
 THEN NEW.ordinal_trait_snapshot:=NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.verifier_normalize_traits() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_normalize_traits() TO service_role;
CREATE TRIGGER verifier_rules_00_traits BEFORE INSERT OR UPDATE ON public.verifier_rules FOR EACH ROW EXECUTE FUNCTION public.verifier_normalize_traits();
ALTER TABLE public.verifier_rules DROP CONSTRAINT verifier_rules_asset_fields_check;
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_asset_fields_check CHECK (
  (asset_type <> 'erc20' AND min_balance IS NULL AND token_decimals IS NULL AND token_symbol IS NULL AND (
  (asset_type = 'ethscription' AND slug IS NOT NULL AND chain_id IS NOT NULL AND inscription_criteria IS NULL
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND collection_name IS NULL)
  OR
  (asset_type = 'nft' AND inscription_criteria IS NULL AND chain_id IS NOT NULL AND chain_id IN (1, 4663) AND slug IS NULL
    AND min_items BETWEEN 1 AND 9007199254740991
    AND contract_address IS NOT NULL AND contract_address ~ '^0x[0-9a-f]{40}$'
    AND contract_address <> '0x0000000000000000000000000000000000000000'
    AND token_standard IS NOT NULL AND token_standard IN ('erc721', 'erc1155')
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100)
    AND (
      (token_standard = 'erc721' AND (token_ids IS NULL OR
        public.verifier_nft_ids_valid(token_ids) IS TRUE))
      OR
      (token_standard = 'erc1155' AND token_ids IS NOT NULL AND public.verifier_nft_ids_valid(token_ids) IS TRUE)
    ))
  OR
  (asset_type = 'ordinal' AND inscription_criteria IS NULL AND chain_id IS NULL
    AND slug IS NOT NULL AND slug <> 'all' AND slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100))
  OR
  (asset_type IN ('ethscription', 'ordinal') AND slug IS NULL
    AND trait_filter IS NULL AND inscription_criteria IS NOT NULL
    AND public.verifier_inscription_criteria_valid(inscription_criteria, asset_type, min_items) IS TRUE
    AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
    AND ((asset_type = 'ordinal' AND chain_id IS NULL) OR (asset_type = 'ethscription' AND chain_id IS NOT NULL AND chain_id = 1))
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND collection_name IS NULL AND ordinal_trait_snapshot IS NULL)
  )) OR (
    asset_type = 'erc20' AND chain_id IS NOT NULL AND chain_id IN (1, 4663)
    AND contract_address IS NOT NULL AND contract_address ~ '^0x[0-9a-f]{40}$'
    AND contract_address <> '0x0000000000000000000000000000000000000000'
    AND trait_filter IS NULL AND slug IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND inscription_criteria IS NULL AND ordinal_trait_snapshot IS NULL
    AND min_items IS NULL AND token_decimals IS NOT NULL AND token_decimals BETWEEN 0 AND 255
    AND min_balance IS NOT NULL
    AND CASE WHEN min_balance ~ '^[1-9][0-9]{0,77}$' THEN min_balance::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 ELSE false END
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100)
    AND (token_symbol IS NULL OR char_length(token_symbol) BETWEEN 1 AND 32)
  )
);
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_collectible_traits CHECK(asset_type NOT IN ('nft','ordinal') OR public.verifier_collectible_traits_valid(trait_filter));
ALTER TABLE public.verifier_rules DROP COLUMN attribute_key, DROP COLUMN attribute_value;
COMMENT ON COLUMN public.verifier_rules.trait_filter IS 'Authoritative trait conditions. Legacy keys in historical audit JSON are translated only when restored.';
NOTIFY pgrst,'reload schema';
COMMIT;
