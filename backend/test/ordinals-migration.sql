-- Run only in the disposable migration test database.
BEGIN;

DO $$
DECLARE
  statement text;
  ordinal_id bigint;
BEGIN
  INSERT INTO public.user_wallets (user_id, address, wallet_type) VALUES
    ('ordinal-user', 'bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler', 'bitcoin');
  BEGIN
    INSERT INTO public.user_wallets (user_id, address, wallet_type) VALUES
      ('other-user', 'bc1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler', 'bitcoin');
    RAISE EXCEPTION 'Bitcoin wallet address was linked twice';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  FOREACH statement IN ARRAY ARRAY[
    $q$UPDATE public.user_wallets SET wallet_type = 'evm' WHERE user_id = 'ordinal-user'$q$,
    $q$UPDATE public.user_wallets SET address = 'tb1pss0zhytly75awhm6x2hhvd5lnzv3vssgrf9axfheq8ldyzn88ges79fler' WHERE user_id = 'ordinal-user'$q$,
    $q$UPDATE public.user_wallets SET wallet_type = 'unknown' WHERE user_id = 'ordinal-user'$q$
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Invalid wallet fields were accepted: %', statement;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;

  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, collection_name, min_items, attribute_key, attribute_value)
    VALUES ('ordinal-test', 'verify', 'holder', 'ordinal', NULL, 'pizza-comrades', 'Pizza Comrades', 10, 'ALL', 'ALL')
    RETURNING id INTO ordinal_id;
  BEGIN
    INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, min_items, attribute_key, attribute_value)
      VALUES ('ordinal-test', 'verify', 'holder', 'ordinal', NULL, 'pizza-comrades', 10, 'ALL', 'ALL');
    RAISE EXCEPTION 'Duplicate Ordinals rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- The same collection can grant the same role through an Ethscriptions rule.
  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, slug, min_items, attribute_key, attribute_value)
    VALUES ('ordinal-test', 'verify', 'holder', 'pizza-comrades', 10, 'ALL', 'ALL');
  -- Production backups may contain no NFT rules. Always test the NFT guard
  -- against our own fixture rather than relying on existing application rows.
  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, contract_address, token_standard, min_items, attribute_key, attribute_value)
    VALUES ('ordinal-test', 'verify', 'nft-holder', 'nft', 1, NULL,
      '0x1111111111111111111111111111111111111111', 'erc721', 1, 'ALL', 'ALL');

  FOREACH statement IN ARRAY ARRAY[
    $q$UPDATE public.verifier_rules SET chain_id = 1 WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET slug = 'ALL' WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET slug = NULL WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET slug = 'pizza-comrades,other' WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key = '' WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET attribute_value = 'Red' WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET min_items = 0 WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET token_ids = ARRAY['1'] WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET contract_address = '0x1111111111111111111111111111111111111111' WHERE server_id = 'ordinal-test' AND asset_type = 'ordinal'$q$,
    $q$UPDATE public.verifier_rules SET chain_id = NULL WHERE server_id = 'ordinal-test' AND asset_type = 'nft'$q$,
    $q$UPDATE public.verifier_rules SET chain_id = NULL WHERE server_id = 'ordinal-test' AND asset_type = 'ethscription'$q$
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Invalid rule fields were accepted: %', statement;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
END;
$$;
ROLLBACK;
