DO $$
DECLARE r public.verifier_rules; a jsonb; redo jsonb; ids text[]; q text;
 f jsonb:='{"operator":"AND","conditions":[{"key":"Hat","value":"Crown"},{"key":"Background","value":"Blue"}]}';
 max_id text:='115792089237316195423570985008687907853269984665640564039457584007913129639935';
BEGIN
 INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,contract_address,token_standard,token_ids,min_items)
 VALUES('erc721-test','verify','holder','nft',1,NULL,'0x1111111111111111111111111111111111111111','erc721',ARRAY['0'],1) RETURNING * INTO r;
 -- A legacy single-ID rule is valid unchanged; the same rule can now use a list.
 a:=to_jsonb(r);
 a:=public.verifier_portal_mutate_rule(r.server_id,'admin','91111111-1111-4111-8111-111111111111',a,
   jsonb_set(jsonb_set(jsonb_set(a,'{token_ids}','["0","1","2"]'),'{min_items}','2'),'{trait_filter}',f));
 SELECT * INTO r FROM public.verifier_rules WHERE id=r.id;
 IF r.token_ids IS DISTINCT FROM ARRAY['0','1','2'] OR r.min_items<>2 OR r.trait_filter IS DISTINCT FROM public.verifier_traits_normalize(f) THEN RAISE EXCEPTION 'Full edit lost'; END IF;
 -- Undo restores the single ID/minimum, and Redo recovers the whole list/filter.
 redo:=public.verifier_portal_mutate_rule(r.server_id,'admin','92222222-2222-4222-8222-222222222222',a->'after_rule',a->'before_rule',(a->>'id')::uuid);
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=r.id AND token_ids=ARRAY['0'] AND min_items=1 AND trait_filter IS NULL) THEN RAISE EXCEPTION 'Legacy single-ID Undo failed'; END IF;
 PERFORM public.verifier_portal_mutate_rule(r.server_id,'admin','93333333-3333-4333-8333-333333333333',redo->'after_rule',redo->'before_rule',(redo->>'id')::uuid);
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=r.id AND token_ids=ARRAY['0','1','2'] AND min_items=2 AND trait_filter=public.verifier_traits_normalize(f)) THEN RAISE EXCEPTION 'Selection Redo failed'; END IF;
 BEGIN
  INSERT INTO public.verifier_rules(server_id,channel_id,role_id,asset_type,chain_id,slug,contract_address,token_standard,token_ids,min_items,trait_filter)
  VALUES(r.server_id,r.channel_id,r.role_id,'nft',1,NULL,r.contract_address,'erc721',ARRAY['0','1','2'],2,f);
  RAISE EXCEPTION 'Duplicate accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 SELECT array_agg(n::text ORDER BY n) INTO ids FROM generate_series(0,999) n;
 UPDATE public.verifier_rules SET token_ids=ids,chain_id=4663,min_items=1000 WHERE id=r.id;
 UPDATE public.verifier_rules SET token_ids=ARRAY[max_id],min_items=2 WHERE id=r.id;
 -- Higher minima can combine contributions from other rules; no per-rule cap.
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=r.id AND token_ids=ARRAY[max_id] AND min_items=2) THEN RAISE EXCEPTION 'Combined minimum rejected'; END IF;
 FOREACH q IN ARRAY ARRAY[
  $q$UPDATE public.verifier_rules SET token_ids=ARRAY[]::text[] WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET token_ids=ARRAY['1','1'] WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET token_ids=ARRAY['2','1'] WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET token_ids=ARRAY['01'] WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET token_ids=ARRAY[NULL]::text[] WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET token_ids=ARRAY['-1'] WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET token_ids=ARRAY['115792089237316195423570985008687907853269984665640564039457584007913129639936'] WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET token_ids=(SELECT array_agg(n::text ORDER BY n) FROM generate_series(0,1000) n) WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET min_items=0 WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET min_items=9007199254740992 WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET chain_id=137 WHERE server_id='erc721-test'$q$,
  $q$UPDATE public.verifier_rules SET token_standard='erc1155',token_ids=NULL WHERE server_id='erc721-test'$q$
 ] LOOP
  BEGIN EXECUTE q; RAISE EXCEPTION 'Invalid selection accepted: %',q;
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 UPDATE public.verifier_rules SET token_ids=NULL WHERE id=r.id;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=r.id AND token_ids IS NULL AND min_items=2) THEN RAISE EXCEPTION 'Collection scope rejected'; END IF;
 SELECT * INTO r FROM public.verifier_rules WHERE id=r.id;
 a:=public.verifier_portal_mutate_rule(r.server_id,'admin','94444444-4444-4444-8444-444444444444',to_jsonb(r),NULL);
 PERFORM public.verifier_portal_mutate_rule(r.server_id,'admin','95555555-5555-4555-8555-555555555555',NULL,a->'before_rule',(a->>'id')::uuid);
 IF NOT EXISTS(SELECT 1 FROM public.verifier_rules WHERE id=r.id AND trait_filter=public.verifier_traits_normalize(f)) THEN RAISE EXCEPTION 'Delete/restore lost rule ID or traits'; END IF;
END $$;
