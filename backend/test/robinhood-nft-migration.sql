-- Run only against a disposable database after all migrations.
BEGIN;

DO $$
DECLARE
  standard text;
  ids text[];
BEGIN
  FOREACH standard IN ARRAY ARRAY['erc721', 'erc1155'] LOOP
    ids := CASE WHEN standard = 'erc1155' THEN ARRAY['0', '1'] ELSE NULL END;
    -- The same contract address and criteria on two networks are different rules.
    INSERT INTO public.verifier_rules (server_id, channel_id, role_id, slug, asset_type, chain_id, contract_address, token_standard, token_ids, attribute_key, attribute_value, min_items)
      VALUES ('robinhood-test', 'verify', standard, NULL, 'nft', 1, '0x1111111111111111111111111111111111111111', standard, ids, 'ALL', 'ALL', 1);
    INSERT INTO public.verifier_rules (server_id, channel_id, role_id, slug, asset_type, chain_id, contract_address, token_standard, token_ids, attribute_key, attribute_value, min_items)
      VALUES ('robinhood-test', 'verify', standard, NULL, 'nft', 4663, '0x1111111111111111111111111111111111111111', standard, ids, 'ALL', 'ALL', 1);
    BEGIN
      INSERT INTO public.verifier_rules (server_id, channel_id, role_id, slug, asset_type, chain_id, contract_address, token_standard, token_ids, attribute_key, attribute_value, min_items)
      VALUES ('robinhood-test', 'verify', standard, NULL, 'nft', 4663, '0x1111111111111111111111111111111111111111', standard, ids, 'ALL', 'ALL', 1);
      RAISE EXCEPTION 'Duplicate Robinhood rule was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;

  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, slug, asset_type, chain_id, contract_address, token_standard, token_ids, attribute_key, attribute_value, min_items)
      VALUES ('robinhood-test', 'verify', 'specific-721', NULL, 'nft', 4663, '0x1111111111111111111111111111111111111111', 'erc721', ARRAY['0'], 'ALL', 'ALL', 1);
  BEGIN
    UPDATE public.verifier_rules SET chain_id = 46630 WHERE server_id = 'robinhood-test';
    RAISE EXCEPTION 'Robinhood testnet was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.verifier_rules SET token_ids = NULL WHERE server_id = 'robinhood-test' AND token_standard = 'erc1155';
    RAISE EXCEPTION 'Unbounded Robinhood ERC-1155 scope was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE public.verifier_rules SET min_items = 2 WHERE server_id = 'robinhood-test' AND role_id = 'specific-721';
    RAISE EXCEPTION 'Multiple copies of a specific Robinhood ERC-721 ID were accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;

ROLLBACK;
