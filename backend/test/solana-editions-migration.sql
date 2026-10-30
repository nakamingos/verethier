DO $$
DECLARE address text:='So11111111111111111111111111111111111111112'; criteria jsonb; r jsonb; action jsonb; previous jsonb;
BEGIN
 IF public.verifier_solana_criteria_valid('{"kind":"master_edition","addresses":["So11111111111111111111111111111111111111112"],"formats":["metadata"]}','solana_nft') IS DISTINCT FROM true
 OR public.verifier_solana_criteria_valid('{"kind":"master_edition","addresses":["So11111111111111111111111111111111111111112"],"formats":["compressed"]}','solana_nft') IS DISTINCT FROM false
 OR public.verifier_solana_criteria_valid('{"kind":"master_edition","addresses":["So11111111111111111111111111111111111111112"],"formats":["core","metadata"]}','solana_nft') IS DISTINCT FROM false
 THEN RAISE EXCEPTION 'Print scope format validation failed'; END IF;
 FOR criteria IN SELECT value FROM jsonb_array_elements('[
  {"kind":"collection","addresses":["So11111111111111111111111111111111111111112"],"formats":["core","metadata"]},
  {"kind":"collection","addresses":["So11111111111111111111111111111111111111112"],"formats":["compressed"]},
  {"kind":"verified_creator","addresses":["So11111111111111111111111111111111111111112"],"formats":["compressed","core","metadata"]},
  {"kind":"asset_ids","addresses":["So11111111111111111111111111111111111111112"],"formats":["compressed","metadata"]}
 ]'::jsonb) LOOP
  IF public.verifier_solana_criteria_valid(criteria,'solana_nft') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Valid NFT criteria rejected'; END IF;
 END LOOP;
 FOR criteria IN SELECT value FROM jsonb_array_elements('[
  {"kind":"collection","addresses":["So11111111111111111111111111111111111111112"],"formats":["metadata","compressed"]},
  {"kind":"collection","addresses":["So11111111111111111111111111111111111111112"],"formats":["compressed","compressed"]},
  {"kind":"collection","addresses":["So11111111111111111111111111111111111111112"],"formats":[]},
  {"kind":"collection","addresses":["So11111111111111111111111111111111111111112"],"formats":["unknown"]},
  {"kind":"collection","addresses":[],"formats":["compressed"]},
  {"kind":"collection","addresses":["invalid"],"formats":["compressed"]}
 ]'::jsonb) LOOP
  IF public.verifier_solana_criteria_valid(criteria,'solana_nft') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Invalid NFT criteria accepted'; END IF;
 END LOOP;
 criteria:=jsonb_build_object('kind','master_edition','addresses',jsonb_build_array(address),'formats',jsonb_build_array('metadata'));
 r:=jsonb_build_object('server_name','Edition test','channel_name','Edition test','role_name','Edition test',
  'server_id','editions-test-server','channel_id','editions-test-channel','role_id','editions-test-role',
  'asset_type','solana_nft','min_items',1,'solana_criteria',criteria);
 action:=public.verifier_portal_mutate_rule('editions-test-server','editions-test-admin',gen_random_uuid(),NULL,r);
 previous:=action->'after_rule';
 IF previous->'solana_criteria' IS DISTINCT FROM criteria THEN RAISE EXCEPTION 'Edition scope lost'; END IF;
 action:=public.verifier_portal_mutate_rule('editions-test-server','editions-test-admin',gen_random_uuid(),previous,
  previous||'{"min_items":2,"trait_filter":{"operator":"AND","conditions":[{"key":"Hat","value":"Blue"}]}}'::jsonb);
 IF action->'after_rule'->>'min_items'<>'2' OR action->'after_rule'->'trait_filter'->>'operator'<>'AND' THEN RAISE EXCEPTION 'Edition rule edit failed'; END IF;
 previous:=action->'after_rule';
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('editions-test-server','editions-test-admin',gen_random_uuid(),previous,
   previous||jsonb_build_object('solana_criteria',criteria||'{"kind":"asset_ids"}'::jsonb));
  RAISE EXCEPTION 'Master scope identity changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Master scope identity changed' THEN RAISE; END IF; END;
 IF has_function_privilege('anon','public.verifier_solana_criteria_valid(jsonb,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.verifier_solana_criteria_valid(jsonb,text)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.verifier_solana_criteria_valid(jsonb,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Criteria function privileges changed'; END IF;
END $$;
