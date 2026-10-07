-- Run only against a disposable database after all migrations.
BEGIN;

DO $$
DECLARE
  ids text[];
  max_id text := '115792089237316195423570985008687907853269984665640564039457584007913129639935';
BEGIN
  IF NOT public.verifier_nft_ids_valid(ARRAY['0', '500', max_id]) THEN
    RAISE EXCEPTION 'Valid uint256 IDs were rejected';
  END IF;
  IF public.verifier_nft_ids_valid(ARRAY['1', '0'])
     OR public.verifier_nft_ids_valid(ARRAY['1', '1'])
     OR public.verifier_nft_ids_valid(ARRAY['01'])
     OR public.verifier_nft_ids_valid(ARRAY[NULL]::text[])
     OR public.verifier_nft_ids_valid(ARRAY[]::text[])
     OR public.verifier_nft_ids_valid(ARRAY[(max_id::numeric + 1)::text]) THEN
    RAISE EXCEPTION 'Invalid token IDs were accepted';
  END IF;

  SELECT array_agg(id::text ORDER BY id) INTO ids FROM generate_series(0, 999) AS id;
  INSERT INTO public.verifier_rules (server_id, role_id, slug, asset_type, contract_address, token_standard, token_ids)
    VALUES ('nft-test', '1155', NULL, 'nft', '0x1111111111111111111111111111111111111111', 'erc1155', ids);
  BEGIN
    INSERT INTO public.verifier_rules (server_id, role_id, slug, asset_type, contract_address, token_standard, token_ids)
      VALUES ('nft-test', '1155', NULL, 'nft', '0x1111111111111111111111111111111111111111', 'erc1155', ids);
    RAISE EXCEPTION 'Duplicate ERC-1155 rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  INSERT INTO public.verifier_rules (server_id, role_id, slug, asset_type, contract_address, token_standard)
    VALUES ('nft-test', '721', NULL, 'nft', '0x1111111111111111111111111111111111111111', 'erc721');
  BEGIN
    INSERT INTO public.verifier_rules (server_id, role_id, slug, asset_type, contract_address, token_standard)
      VALUES ('nft-test', '721', NULL, 'nft', '0x1111111111111111111111111111111111111111', 'erc721');
    RAISE EXCEPTION 'Duplicate ERC-721 collection rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.verifier_rules (server_id, role_id, slug, asset_type, contract_address, token_standard, token_ids)
    VALUES ('nft-test', '721', NULL, 'nft', '0x1111111111111111111111111111111111111111', 'erc721', ARRAY['0']);
  INSERT INTO public.verifier_rules (server_id, role_id, slug, asset_type, contract_address, token_standard, token_ids)
    VALUES ('nft-test', '721', NULL, 'nft', '0x2222222222222222222222222222222222222222', 'erc721', ARRAY[max_id]);

  BEGIN
    UPDATE public.verifier_rules SET token_standard = NULL WHERE server_id = 'nft-test';
    RAISE EXCEPTION 'Null NFT standard was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.verifier_rules SET slug = 'legacy-slug' WHERE server_id = 'nft-test';
    RAISE EXCEPTION 'Mixed NFT/Ethscriptions criteria were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.verifier_rules SET token_ids = NULL WHERE server_id = 'nft-test' AND token_standard = 'erc1155';
    RAISE EXCEPTION 'Unbounded ERC-1155 scope was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.verifier_rules SET token_ids = ARRAY['0', '1'] WHERE server_id = 'nft-test' AND token_standard = 'erc721';
    RAISE EXCEPTION 'Multiple specific ERC-721 IDs were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.verifier_rules SET chain_id = 137 WHERE server_id = 'nft-test';
    RAISE EXCEPTION 'Unsupported NFT chain was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.verifier_rules SET min_items = 0 WHERE server_id = 'nft-test';
    RAISE EXCEPTION 'Zero NFT threshold was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
