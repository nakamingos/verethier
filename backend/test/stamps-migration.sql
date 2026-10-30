DO $$
DECLARE criteria jsonb; action jsonb; previous jsonb; original jsonb;
BEGIN
 FOR criteria IN SELECT value FROM jsonb_array_elements('[{"creator":"1GotRejB6XsGgMsM79TvcypeanDJRJbMtg"},{"stamp_ids":["0","1","123"]},{"creator":"1GotRejB6XsGgMsM79TvcypeanDJRJbMtg","stamp_ids":["1"]}]') LOOP
  IF public.verifier_stamp_criteria_valid(criteria) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Valid Stamps scope rejected'; END IF;
 END LOOP;
 FOR criteria IN SELECT value FROM jsonb_array_elements('[{},null,[],{"creator":null},{"stamp_ids":null},{"stamp_ids":[]},{"stamp_ids":[1]},{"stamp_ids":["-1"]},{"stamp_ids":["01"]},{"stamp_ids":["9007199254740992"]},{"stamp_ids":["1","1"]},{"stamp_ids":["2","1"]},{"creator":"bad"},{"creator":"1GotRejB6XsGgMsM79TvcypeanDJRJbMtg","unknown":true}]') LOOP
  IF public.verifier_stamp_criteria_valid(criteria) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Invalid Stamps scope accepted: %',criteria; END IF;
 END LOOP;
 criteria:='{"creator":"1GotRejB6XsGgMsM79TvcypeanDJRJbMtg","stamp_ids":["1"]}';
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,
  jsonb_build_object('server_name','Stamps test','channel_name','verify','role_name','Holder','server_id','711111111111111111','channel_id','722222222222222222','role_id','733333333333333333',
   'asset_type','stamp','stamp_criteria',criteria,'min_items',3));
 original:=action; previous:=action->'after_rule';
 IF previous->'stamp_criteria' IS DISTINCT FROM criteria THEN RAISE EXCEPTION 'Stamps criteria lost'; END IF;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,previous-'id');
  RAISE EXCEPTION 'Duplicate Stamps rule accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),previous,previous||'{"min_items":7}');
 previous:=action->'after_rule';
 IF previous->>'min_items'<>'7' THEN RAISE EXCEPTION 'Stamps minimum edit failed'; END IF;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),previous,previous||'{"stamp_criteria":{"stamp_ids":["2"]}}');
  RAISE EXCEPTION 'Stamps scope identity changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Stamps scope identity changed' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),previous,previous||'{"trait_filter":{"operator":"AND","conditions":[{"key":"x","value":"y"}]}}');
  RAISE EXCEPTION 'Stamps traits accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),previous,NULL);
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,previous,(action->>'id')::uuid);
 IF action->'after_rule'->'stamp_criteria' IS DISTINCT FROM criteria THEN RAISE EXCEPTION 'Stamps deletion undo lost scope'; END IF;
 IF public.verifier_bitcoin_base58_valid('1GotRejB6XsGgMsM79TvcypeanDJRJbMtg') IS DISTINCT FROM true
  OR public.verifier_bitcoin_base58_valid('3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy') IS DISTINCT FROM true
  OR public.verifier_bitcoin_base58_valid('1gotrejb6xsggmsm79tvcypeandjrjbmtg') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Bitcoin Base58 checksum validation failed'; END IF;
 INSERT INTO public.user_wallets(user_id,address,wallet_type) VALUES('755555555555555555','1GotRejB6XsGgMsM79TvcypeanDJRJbMtg','bitcoin');
 action:=public.verifier_portal_wallet_block('711111111111111111','744444444444444444','1GotRejB6XsGgMsM79TvcypeanDJRJbMtg',true,'test',gen_random_uuid());
 IF NOT EXISTS(SELECT 1 FROM public.verifier_wallet_blocks WHERE address='1GotRejB6XsGgMsM79TvcypeanDJRJbMtg' AND wallet_type='bitcoin') THEN RAISE EXCEPTION 'Legacy wallet block family incorrect'; END IF;
 IF has_function_privilege('anon' ,'public.verifier_stamp_criteria_valid(jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.verifier_stamp_criteria_valid(jsonb)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.verifier_stamp_criteria_valid(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Criteria RPC privileges incorrect'; END IF;
END $$;
