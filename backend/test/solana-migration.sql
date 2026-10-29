DO $$
DECLARE test_address text:='So11111111111111111111111111111111111111112'; result jsonb; flow uuid:=gen_random_uuid(); r jsonb; action jsonb;
BEGIN
 PERFORM public.verifier_link_verified_wallet('solana-test-one',test_address,'solana',NULL,gen_random_uuid(),'discord','solana-test-server',NULL);
 IF NOT EXISTS(SELECT 1 FROM public.user_wallets WHERE user_id='solana-test-one' AND user_wallets.address=test_address AND wallet_type='solana' AND evm_chain_ids IS NULL)
 THEN RAISE EXCEPTION 'Solana link lost its identity'; END IF;
 INSERT INTO public.verifier_member_flows(user_id,id,purpose,address,wallet_type,challenge,expires_at)
 VALUES('solana-test-two',flow,'wallet_link',test_address,'solana','"proof"',now()+interval '5 minutes');
 result:=public.verifier_member_link_wallet('solana-test-two',flow,false);
 IF result->>'requiresTransfer'<>'true' THEN RAISE EXCEPTION 'Transfer confirmation skipped'; END IF;
 result:=public.verifier_member_link_wallet('solana-test-two',flow,true);
 IF result->>'linked'<>'true' THEN RAISE EXCEPTION 'Solana portal linking failed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_member_actions WHERE user_id='solana-test-one' AND verifier_member_actions.address=test_address AND kind='wallet_transfer_out')
 THEN RAISE EXCEPTION 'Solana transfer history missing'; END IF;
 BEGIN
  UPDATE public.user_wallets SET evm_chain_ids=ARRAY[8453] WHERE user_wallets.address=test_address;
  RAISE EXCEPTION 'Solana accepted EVM scope';
 EXCEPTION WHEN check_violation THEN NULL; END;
 PERFORM public.verifier_portal_wallet_block('111111111111111111','222222222222222222','bc1p111111111111111111111111111111111111111',true,NULL,gen_random_uuid());
 IF NOT EXISTS(SELECT 1 FROM public.verifier_wallet_blocks WHERE address='bc1p111111111111111111111111111111111111111' AND wallet_type='solana') THEN RAISE EXCEPTION 'Solana prefix mistaken for Bitcoin'; END IF;
 r:=jsonb_build_object('server_name','Solana test','channel_name','Solana test','role_name','Solana test','server_id','solana-test-server','channel_id','solana-test-channel','role_id','solana-test-role',
  'asset_type','solana_nft','min_items',1,'solana_criteria',jsonb_build_object('kind','asset_ids','addresses',jsonb_build_array(test_address),'formats',jsonb_build_array('metadata')));
 action:=public.verifier_portal_mutate_rule('solana-test-server','solana-test-admin',gen_random_uuid(),NULL,r);
 IF action->'after_rule'->'solana_criteria' IS DISTINCT FROM r->'solana_criteria' THEN RAISE EXCEPTION 'Rule scope not stored'; END IF;
 r:=action->'after_rule';
 action:=public.verifier_portal_mutate_rule('solana-test-server','solana-test-admin',gen_random_uuid(),r,r||'{"min_items":2}'::jsonb);
 IF action->'after_rule'->>'min_items'<>'2' THEN RAISE EXCEPTION 'Rule edit failed'; END IF;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('solana-test-server','solana-test-admin',gen_random_uuid(),action->'after_rule',
    (action->'after_rule')||'{"solana_criteria":{"kind":"asset_ids","addresses":["11111111111111111111111111111111"],"formats":["metadata"]}}'::jsonb);
  RAISE EXCEPTION 'Rule identity changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Rule identity changed' THEN RAISE; END IF; END;
 IF public.verifier_solana_criteria_valid('{"kind":"collection","addresses":[],"formats":["metadata"]}','solana_nft') IS TRUE
 OR public.verifier_solana_criteria_valid('{"kind":"collection","addresses":["fake"],"formats":["metadata"]}','solana_nft') IS TRUE
 OR public.verifier_solana_criteria_valid('{"kind":"token","mint":"So11111111111111111111111111111111111111112","program":"fake"}','solana_token') IS TRUE
 THEN RAISE EXCEPTION 'Invalid criteria accepted'; END IF;
 IF has_function_privilege('anon','public.verifier_solana_criteria_valid(jsonb,text)','EXECUTE')
 OR has_function_privilege('authenticated','public.verifier_member_link_wallet(text,uuid,boolean,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'Solana privileges leaked'; END IF;
END $$;
