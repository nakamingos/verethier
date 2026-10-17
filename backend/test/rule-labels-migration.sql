-- Validate labels on a disposable restored database after migration.
BEGIN;
INSERT INTO public.verifier_rules(server_id, channel_id, role_id, asset_type, chain_id, slug,
  attribute_key, attribute_value, min_items, inscription_criteria, rule_label)
VALUES ('label-test', 'verify', 'ord-label', 'ordinal', NULL, NULL, 'ALL', 'ALL', 1,
  '{"kind":"numbers","ranges":[[123,456]]}', 'Pizza Comrades — Gold Crowns'),
 ('label-test', 'verify', 'eth-label', 'ethscription', 1, NULL, 'ALL', 'ALL', 1,
  jsonb_build_object('kind','ids','ids',jsonb_build_array('0x'||repeat('a',64))), 'Named Ethscriptions');
DO $$ DECLARE invalid_label text; target bigint;
BEGIN
 SELECT id INTO STRICT target FROM public.verifier_rules WHERE server_id='label-test' AND role_id='ord-label';
 FOREACH invalid_label IN ARRAY ARRAY['', ' ', ' leading', 'trailing ', repeat('a',101), E'first\nsecond', E'first\tsecond'] LOOP
  BEGIN
   UPDATE public.verifier_rules SET rule_label=invalid_label WHERE id=target;
   RAISE EXCEPTION 'Malformed label was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
 END LOOP;
 UPDATE public.verifier_rules SET rule_label=repeat('a',100) WHERE id=target;
 UPDATE public.verifier_rules SET rule_label=NULL WHERE id=target;
 BEGIN
  UPDATE public.verifier_rules SET rule_label='Not an inscription selection'
    WHERE id=(SELECT id FROM public.verifier_rules WHERE inscription_criteria IS NULL LIMIT 1);
  RAISE EXCEPTION 'Label was accepted on a collection rule';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
