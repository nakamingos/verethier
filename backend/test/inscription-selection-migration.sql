BEGIN;
DO $$
DECLARE
  ord_ids jsonb := jsonb_build_object('kind', 'ids', 'ids', jsonb_build_array(repeat('a',64) || 'i0', repeat('b',64) || 'i0'));
  eth_ids jsonb := jsonb_build_object('kind', 'ids', 'ids', jsonb_build_array('0x' || repeat('a',64), '0x' || repeat('b',64)));
  ranges jsonb := '{"kind":"numbers","ranges":[[0,99999],[200000,200000]]}';
  bad jsonb;
  statement text;
  long_ids jsonb;
BEGIN
  INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, attribute_key, attribute_value, min_items, inscription_criteria)
    VALUES
      ('selection-test','verify','holder','ordinal',NULL,NULL,'ALL','ALL',1,ord_ids),
      ('selection-test','verify','holder','ordinal',NULL,NULL,'ALL','ALL',2,ord_ids),
      ('selection-test','verify','holder','ethscription',1,NULL,'ALL','ALL',1,eth_ids),
      ('selection-test','verify','holder','ordinal',NULL,NULL,'ALL','ALL',1,ranges),
      ('selection-test','verify','holder','ethscription',1,NULL,'ALL','ALL',1,ranges),
      ('selection-test','verify','cursed','ordinal',NULL,NULL,'ALL','ALL',2,'{"kind":"numbers","ranges":[[-10,-1]]}');
  BEGIN
    INSERT INTO public.verifier_rules (server_id, channel_id, role_id, asset_type, chain_id, slug, attribute_key, attribute_value, min_items, inscription_criteria)
      VALUES ('selection-test','verify','holder','ordinal',NULL,NULL,'ALL','ALL',1,ord_ids);
    RAISE EXCEPTION 'Duplicate specific inscription rule was accepted';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT jsonb_build_object('kind','ids','ids',jsonb_agg(identifier ORDER BY identifier COLLATE "C")) INTO long_ids
    FROM (SELECT repeat('c',64) || 'i' || n AS identifier FROM generate_series(0,999) n) identifiers;
  INSERT INTO public.verifier_rules (server_id,channel_id,role_id,asset_type,chain_id,slug,attribute_key,attribute_value,min_items,inscription_criteria)
    VALUES ('selection-test','verify','long-list','ordinal',NULL,NULL,'ALL','ALL',1000,long_ids);
  UPDATE public.verifier_rules SET min_items=1 WHERE server_id='selection-test' AND role_id='long-list';

  FOR bad IN SELECT value FROM jsonb_array_elements('[
    null, [], {}, {"kind":"unknown"},
    {"kind":"ids","ids":[]}, {"kind":"ids","ids":null}, {"kind":"ids","ids":[null]},
    {"kind":"ids","ids":["invalid"]}, {"kind":"ids","ids":[12]},
    {"kind":"numbers","ranges":[]}, {"kind":"numbers","ranges":null},
    {"kind":"numbers","ranges":[[1]]}, {"kind":"numbers","ranges":[[1,2,3]]},
    {"kind":"numbers","ranges":[[2,1]]}, {"kind":"numbers","ranges":[[1.5,2]]},
    {"kind":"numbers","ranges":[["1",2]]}, {"kind":"numbers","ranges":[[null,2]]},
    {"kind":"numbers","ranges":[[1,9007199254740992]]},
    {"kind":"numbers","ranges":[[1,3],[3,5]]}, {"kind":"numbers","ranges":[[1,3],[4,5]]},
    {"kind":"numbers","ranges":[[10,12],[1,3]]},
    {"kind":"numbers","ranges":[[1,2]],"unexpected":true}
  ]'::jsonb) LOOP
    BEGIN
      UPDATE public.verifier_rules SET inscription_criteria=bad WHERE server_id='selection-test' AND role_id='long-list';
      RAISE EXCEPTION 'Malformed inscription selection was accepted: %', bad;
    EXCEPTION WHEN check_violation OR not_null_violation THEN NULL;
    END;
  END LOOP;
  FOREACH statement IN ARRAY ARRAY[
    $q$UPDATE public.verifier_rules SET slug='yonder' WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key='Hat' WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_value='Pirate' WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET attribute_key=NULL WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET min_items=NULL WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET min_items=0 WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET min_items=3 WHERE server_id='selection-test' AND role_id='holder' AND inscription_criteria->>'kind'='ids'$q$,
    $q$UPDATE public.verifier_rules SET inscription_criteria=NULL WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET ordinal_trait_snapshot='{}' WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET collection_name='Custom' WHERE server_id='selection-test'$q$,
    $q$UPDATE public.verifier_rules SET chain_id=1 WHERE server_id='selection-test' AND asset_type='ordinal'$q$,
    $q$UPDATE public.verifier_rules SET chain_id=NULL WHERE server_id='selection-test' AND asset_type='ethscription'$q$,
    $q$UPDATE public.verifier_rules SET inscription_criteria='{"kind":"numbers","ranges":[[-10,-1]]}' WHERE server_id='selection-test' AND asset_type='ethscription'$q$,
    $q$UPDATE public.verifier_rules SET inscription_criteria=jsonb_build_object('kind','ids','ids',jsonb_build_array('0x'||repeat('a',64))) WHERE server_id='selection-test' AND asset_type='ordinal'$q$,
    $q$UPDATE public.verifier_rules SET inscription_criteria=jsonb_build_object('kind','ids','ids',jsonb_build_array(repeat('b',64)||'i0',repeat('a',64)||'i0')) WHERE server_id='selection-test' AND asset_type='ordinal'$q$,
    $q$UPDATE public.verifier_rules SET inscription_criteria=jsonb_build_object('kind','ids','ids',jsonb_build_array(repeat('a',64)||'i0',repeat('a',64)||'i0')) WHERE server_id='selection-test' AND asset_type='ordinal'$q$
  ] LOOP
    BEGIN
      EXECUTE statement;
      RAISE EXCEPTION 'Invalid inscription rule fields were accepted: %', statement;
    EXCEPTION WHEN check_violation OR not_null_violation THEN NULL;
    END;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.verifier_rules'::regclass) THEN
    RAISE EXCEPTION 'Verifier rule RLS was disabled';
  END IF;
END;
$$;
ROLLBACK;
