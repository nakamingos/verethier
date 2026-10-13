-- Run only in a disposable database restored from the production backup.
BEGIN;
DO $$
DECLARE
  rule_id bigint;
  statement text;
BEGIN
  INSERT INTO public.verifier_rules
    (server_id, server_name, channel_id, channel_name, role_id, role_name,
     asset_type, chain_id, contract_address, slug, attribute_key, attribute_value,
     min_items, min_balance, token_decimals, token_symbol, collection_name)
  VALUES ('erc20-migration-test', 'Test', 'channel', 'Test', 'holder', 'Holder',
    'erc20', 1, '0x1111111111111111111111111111111111111111', NULL, 'ALL', 'ALL',
    NULL, '500000000000000000', 18, 'TEST', 'Test Token') RETURNING id INTO rule_id;
  FOREACH statement IN ARRAY ARRAY[
    $q$min_balance = '0'$q$, $q$min_balance = '-1'$q$, $q$min_balance = '0.5'$q$,
    $q$min_balance = '01'$q$, $q$min_balance = '1e18'$q$, $q$min_balance = NULL$q$,
    $q$min_balance = '115792089237316195423570985008687907853269984665640564039457584007913129639936'$q$,
    $q$token_decimals = NULL$q$, $q$token_decimals = -1$q$, $q$token_decimals = 256$q$,
    $q$min_items = 1$q$, $q$slug = 'collection'$q$, $q$chain_id = 31337$q$,
    $q$chain_id = NULL$q$, $q$token_standard = 'erc721'$q$, $q$token_ids = ARRAY['1']$q$,
    $q$attribute_key = 'Trait'$q$, $q$attribute_value = NULL$q$,
    $q$contract_address = '0x0000000000000000000000000000000000000000'$q$,
    $q$inscription_criteria = '{"kind":"numbers","ranges":[[1,2]]}'::jsonb$q$,
    $q$token_symbol = repeat('x', 33)$q$, $q$collection_name = repeat('x', 101)$q$
  ] LOOP
    BEGIN
      EXECUTE 'UPDATE public.verifier_rules SET ' || statement || ' WHERE id = ' || rule_id;
      RAISE EXCEPTION 'Invalid ERC-20 rule was accepted: %', statement;
    EXCEPTION WHEN check_violation THEN NULL;
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.verifier_rules
      (server_id, channel_id, role_id, asset_type, chain_id, contract_address,
       slug, attribute_key, attribute_value, min_items, min_balance, token_decimals)
      VALUES ('erc20-migration-test', 'channel', 'holder', 'erc20', 1,
        '0x1111111111111111111111111111111111111111', NULL, 'ALL', 'ALL', NULL, '500000000000000000', 18);
    RAISE EXCEPTION 'Duplicate ERC-20 rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  UPDATE public.verifier_rules SET chain_id = 4663, min_balance = '1', token_decimals = 0,
    token_symbol = NULL, collection_name = NULL WHERE id = rule_id;
  UPDATE public.verifier_rules SET token_decimals = 255,
    min_balance = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
    WHERE id = rule_id;
  BEGIN
    UPDATE public.verifier_rules SET min_balance = '1'
      WHERE id = (SELECT id FROM public.verifier_rules WHERE asset_type <> 'erc20' LIMIT 1);
    RAISE EXCEPTION 'Token fields were accepted on an existing non-token rule';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$$;
ROLLBACK;
