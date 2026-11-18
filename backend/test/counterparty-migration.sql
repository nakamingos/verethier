-- Exercises 20261118010000_counterparty_rules.sql in a disposable database.
DO $$
DECLARE criteria jsonb; action jsonb; previous jsonb; base jsonb;
BEGIN
 FOR criteria IN SELECT value FROM jsonb_array_elements('[{"asset":"PEPECASH"},{"asset":"XCP"},{"asset":"A12345678901234567"},{"assets":["PEPECASH","RAREPEPE"]},{"issuer":"1GQhaWqejcGJ4GhQar7SjcCfadxvf5DNBD"},{"parent":"PEPE"}]') LOOP
  IF public.verifier_counterparty_criteria_valid(criteria) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Valid Counterparty scope rejected: %',criteria; END IF;
 END LOOP;
 FOR criteria IN SELECT value FROM jsonb_array_elements('[{},null,[],{"asset":"AAAA"},{"asset":"pepecash"},{"asset":1},{"assets":[]},{"assets":["RAREPEPE","PEPECASH"]},{"assets":["PEPECASH","PEPECASH"]},{"issuer":"bad"},{"parent":"PEPE.kek"},{"asset":"PEPECASH","parent":"PEPE"},{"other":"x"}]') LOOP
  IF public.verifier_counterparty_criteria_valid(criteria) IS DISTINCT FROM false THEN RAISE EXCEPTION 'Invalid Counterparty scope accepted: %',criteria; END IF;
 END LOOP;
 base:=jsonb_build_object('server_name','Counterparty test','channel_name','verify','role_name','Holder','server_id','711111111111111111',
  'channel_id','722222222222222222','role_id','733333333333333333','asset_type','counterparty');
 -- A single asset stores a raw-unit minimum balance.
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,
  base||'{"counterparty_criteria":{"asset":"PEPECASH"},"min_balance":"100000000000","token_decimals":8,"token_symbol":"PEPECASH"}');
 previous:=action->'after_rule';
 IF previous->'counterparty_criteria' IS DISTINCT FROM '{"asset":"PEPECASH"}'::jsonb OR previous->>'min_items' IS NOT NULL THEN RAISE EXCEPTION 'Single-asset rule stored incorrectly'; END IF;
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),previous,previous||'{"min_balance":"5"}');
 IF action->'after_rule'->>'min_balance'<>'5' THEN RAISE EXCEPTION 'Minimum balance edit failed'; END IF;
 previous:=action->'after_rule';
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),previous,previous||'{"counterparty_criteria":{"asset":"XCP"}}');
  RAISE EXCEPTION 'Counterparty scope identity changed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Counterparty scope identity changed' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),previous,previous||'{"min_balance":"9223372036854775808"}');
  RAISE EXCEPTION 'Minimum above int64 accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 FOR criteria IN SELECT value FROM jsonb_array_elements('[
  {"counterparty_criteria":{"asset":"PEPECASH"},"min_balance":"1","token_decimals":2,"token_symbol":"PEPECASH"},
  {"counterparty_criteria":{"asset":"PEPECASH"},"min_items":1},
  {"counterparty_criteria":{"issuer":"1GQhaWqejcGJ4GhQar7SjcCfadxvf5DNBD"},"min_items":1,"min_balance":"1","token_decimals":0,"token_symbol":"X"},
  {"counterparty_criteria":{"parent":"PEPE"},"min_items":1,"slug":"x"},
  {"counterparty_criteria":{"parent":"PEPE"},"min_items":1,"stamp_criteria":{"creator":"1GotRejB6XsGgMsM79TvcypeanDJRJbMtg"}},
  {"counterparty_criteria":{"parent":"PEPE"},"min_items":1,"asset_type":"stamp"}]') LOOP
  BEGIN
   PERFORM public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,base||'{"channel_id":"722222222222222299"}'||criteria);
   RAISE EXCEPTION 'Invalid Counterparty rule accepted: %',criteria;
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 -- Collectible scopes count items; identical rules are refused.
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,
  base||'{"counterparty_criteria":{"assets":["PEPECASH","RAREPEPE"]},"min_items":3}');
 previous:=action->'after_rule';
 BEGIN
  PERFORM public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,previous-'id');
  RAISE EXCEPTION 'Duplicate Counterparty rule accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,
  base||'{"counterparty_criteria":{"parent":"PEPE"},"min_items":3}');
 -- Delete and undo keep the scope.
 previous:=action->'after_rule';
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),previous,NULL);
 action:=public.verifier_portal_mutate_rule('711111111111111111','744444444444444444',gen_random_uuid(),NULL,previous,(action->>'id')::uuid);
 IF action->'after_rule'->'counterparty_criteria' IS DISTINCT FROM '{"parent":"PEPE"}'::jsonb THEN RAISE EXCEPTION 'Undo lost Counterparty scope'; END IF;
 IF public.verifier_wallet_rule_network('{"asset_type":"counterparty"}') IS DISTINCT FROM 'bitcoin'
  OR public.verifier_wallet_rule_network('{"asset_type":"stamp"}') IS DISTINCT FROM 'bitcoin' THEN RAISE EXCEPTION 'Counterparty wallet network incorrect'; END IF;
 IF public.verifier_portal_definition(previous)->'counterparty_criteria' IS DISTINCT FROM '{"parent":"PEPE"}'::jsonb THEN RAISE EXCEPTION 'Definition omits Counterparty scope'; END IF;
 IF has_function_privilege('anon','public.verifier_counterparty_criteria_valid(jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','public.verifier_counterparty_criteria_valid(jsonb)','EXECUTE')
  OR NOT has_function_privilege('service_role','public.verifier_counterparty_criteria_valid(jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Criteria RPC privileges incorrect'; END IF;
END $$;
