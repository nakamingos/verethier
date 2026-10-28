DO $$
DECLARE chain integer; standard text; r public.verifier_rules; a jsonb;
  traits jsonb:='{"operator":"AND","conditions":[{"key":"Hat","value":"Crown"},{"key":"Color","value":"Blue"}]}';
BEGIN
 FOREACH chain IN ARRAY ARRAY[1,4663,8453] LOOP
  FOREACH standard IN ARRAY ARRAY['erc721','erc1155'] LOOP
   INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,
     contract_address,token_standard,token_ids,min_items,trait_filter)
   VALUES('base-test','verify',standard,'nft',chain,NULL,
     '0x1111111111111111111111111111111111111111',standard,ARRAY['1','3'],2,traits) RETURNING * INTO r;
   IF r.chain_id<>chain OR jsonb_array_length(r.trait_filter->'conditions')<>2 THEN RAISE EXCEPTION 'NFT network/traits lost'; END IF;
   BEGIN
    INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,
      contract_address,token_standard,token_ids,min_items,trait_filter)
    VALUES('base-test','verify',standard,'nft',chain,NULL,
      '0x1111111111111111111111111111111111111111',standard,ARRAY['1','3'],2,traits);
    RAISE EXCEPTION 'Duplicate NFT accepted';
   EXCEPTION WHEN unique_violation THEN NULL; END;
  END LOOP;
  INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,
    contract_address,min_items,min_balance,token_decimals,token_symbol)
  VALUES('base-test','verify','token','erc20',chain,NULL,
    '0x1111111111111111111111111111111111111111',NULL,'500000',6,'TEST');
  BEGIN
   INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,
     contract_address,min_items,min_balance,token_decimals,token_symbol)
   VALUES('base-test','verify','token','erc20',chain,NULL,
     '0x1111111111111111111111111111111111111111',NULL,'500000',6,'TEST');
   RAISE EXCEPTION 'Duplicate token rule accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  INSERT INTO public.nft_token_metadata(chain_id,contract_address,token_id,attributes)
  VALUES(chain,'0x1111111111111111111111111111111111111111','1','[]');
 END LOOP;
 IF (SELECT count(*) FROM public.nft_token_metadata)<>3 THEN RAISE EXCEPTION 'Metadata networks not isolated'; END IF;
 IF (SELECT count(*) FROM public.verifier_rules WHERE server_id='base-test')<>9 THEN RAISE EXCEPTION 'Rule network uniqueness changed'; END IF;
 FOREACH chain IN ARRAY ARRAY[84532,46630,137] LOOP
  BEGIN
   UPDATE public.verifier_rules SET chain_id=chain WHERE id=r.id;
   RAISE EXCEPTION 'Unsupported NFT network accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
   UPDATE public.verifier_rules SET chain_id=chain WHERE server_id='base-test' AND asset_type='erc20';
   RAISE EXCEPTION 'Unsupported token network accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
   INSERT INTO public.nft_token_metadata(chain_id,contract_address,token_id,attributes)
   VALUES(chain,'0x1111111111111111111111111111111111111111','1','[]');
   RAISE EXCEPTION 'Unsupported metadata network accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 BEGIN
  UPDATE public.verifier_rules SET token_ids=ARRAY['-1'] WHERE id=r.id;
  RAISE EXCEPTION 'Malformed Base token IDs accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 a:=public.verifier_portal_mutate_rule(r.server_id,'admin','b1111111-1111-4111-8111-111111111111',to_jsonb(r),NULL);
 PERFORM public.verifier_portal_mutate_rule(r.server_id,'admin','b2222222-2222-4222-8222-222222222222',NULL,a->'before_rule',(a->>'id')::uuid);
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=r.id AND chain_id=8453 AND trait_filter=r.trait_filter) THEN RAISE EXCEPTION 'Base Undo lost network or traits'; END IF;
 IF has_table_privilege('anon','public.nft_token_metadata','SELECT') OR has_table_privilege('authenticated','public.nft_token_metadata','INSERT') THEN RAISE EXCEPTION 'Metadata permissions leaked'; END IF;
END $$;
