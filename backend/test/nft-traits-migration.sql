-- Run only in the disposable migration test database.
BEGIN;
DO $$
DECLARE
  statement text;
  trait_id bigint;
  max_id text := '115792089237316195423570985008687907853269984665640564039457584007913129639935';
BEGIN
  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, contract_address, token_standard, attribute_key, attribute_value, min_items)
    VALUES ('trait-test', 'verify', 'holder', 'nft', 1, NULL, '0x1111111111111111111111111111111111111111', 'erc721', 'Color', 'Red', 2)
    RETURNING id INTO trait_id;
  BEGIN
    INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, contract_address, token_standard, attribute_key, attribute_value, min_items)
      VALUES ('trait-test', 'verify', 'holder', 'nft', 1, NULL, '0x1111111111111111111111111111111111111111', 'erc721', 'Color', 'Red', 2);
    RAISE EXCEPTION 'Duplicate collection trait rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, contract_address, token_standard, attribute_key, attribute_value, min_items)
    VALUES
      ('trait-test', 'verify', 'holder', 'nft', 1, NULL, '0x1111111111111111111111111111111111111111', 'erc721', 'Color', 'Blue', 2),
      ('trait-test', 'verify', 'holder', 'nft', 4663, NULL, '0x1111111111111111111111111111111111111111', 'erc721', 'Color', 'Red', 2),
      ('trait-test', 'verify', 'holder', 'nft', 1, NULL, '0x1111111111111111111111111111111111111111', 'erc721', 'Color', 'ALL', 2),
      ('trait-test', 'verify', 'holder', 'nft', 1, NULL, '0x1111111111111111111111111111111111111111', 'erc721', 'ALL', 'ALL', 2);
  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, contract_address, token_standard, token_ids, attribute_key, attribute_value, min_items)
    VALUES
      ('trait-test', 'verify', 'copies', 'nft', 1, NULL, '0x1111111111111111111111111111111111111111', 'erc1155', ARRAY['1', max_id], 'Color', 'Red', 10),
      ('trait-test', 'verify', 'copies', 'nft', 1, NULL, '0x1111111111111111111111111111111111111111', 'erc1155', ARRAY['1', max_id], 'Color', 'Blue', 10);
  BEGIN
    INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, contract_address, token_standard, token_ids, attribute_key, attribute_value, min_items)
      VALUES ('trait-test', 'verify', 'copies', 'nft', 1, NULL, '0x1111111111111111111111111111111111111111', 'erc1155', ARRAY['1', max_id], 'Color', 'Red', 10);
    RAISE EXCEPTION 'Duplicate token scope trait rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  FOREACH statement IN ARRAY ARRAY[
    $q$UPDATE public.verifier_rules SET attribute_key = NULL WHERE server_id = 'trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_value = NULL WHERE server_id = 'trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = '' WHERE server_id = 'trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = ' Color ' WHERE server_id = 'trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_value = ' Red ' WHERE server_id = 'trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = repeat('a', 101) WHERE server_id = 'trait-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = 'ALL', attribute_value = 'Red' WHERE server_id = 'trait-test'$q$,
    $q$UPDATE public.verifier_rules SET chain_id = 137 WHERE server_id = 'trait-test'$q$,
    $q$UPDATE public.verifier_rules SET token_ids = NULL WHERE server_id = 'trait-test' AND token_standard = 'erc1155'$q$,
    $q$UPDATE public.verifier_rules SET min_items = 0 WHERE server_id = 'trait-test'$q$
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Invalid NFT trait fields were accepted: %', statement;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  -- Exact ERC-721 IDs retain their one-token threshold.
  UPDATE public.verifier_rules SET token_ids = ARRAY['1'], min_items = 1 WHERE id = trait_id;
  BEGIN
    UPDATE public.verifier_rules SET min_items = 2 WHERE id = trait_id;
    RAISE EXCEPTION 'Specific ERC-721 ID allowed a threshold above one';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO public.nft_token_metadata (chain_id, contract_address, token_id, attributes)
    VALUES
      (1, '0x1111111111111111111111111111111111111111', max_id, '[{"trait_type":"Color","value":"Red"}]'),
      (4663, '0x1111111111111111111111111111111111111111', max_id, '[]');
  BEGIN
    INSERT INTO public.nft_token_metadata (chain_id, contract_address, token_id, attributes)
      VALUES (1, '0x1111111111111111111111111111111111111111', max_id, '[]');
    RAISE EXCEPTION 'Duplicate metadata cache key was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.nft_token_metadata SET attributes = '{}';
    RAISE EXCEPTION 'Non-array metadata attributes were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.nft_token_metadata'::regclass)
    OR has_table_privilege('anon', 'public.nft_token_metadata', 'SELECT')
    OR has_table_privilege('authenticated', 'public.nft_token_metadata', 'INSERT')
    OR NOT has_table_privilege('service_role', 'public.nft_token_metadata', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'NFT metadata cache permissions are incorrect';
  END IF;
END;
$$;
ROLLBACK;
