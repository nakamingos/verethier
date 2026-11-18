BEGIN;
-- Counterparty asset rules. Additive rule storage only; no existing rules or
-- wallet associations are rewritten.
ALTER TABLE public.verifier_rules ADD COLUMN counterparty_criteria jsonb;
-- Token-style rules store min_items as NULL. Production already allows it; the
-- original table definition did not, so make this explicit (a no-op when nullable).
ALTER TABLE public.verifier_rules ALTER COLUMN min_items DROP NOT NULL;

-- Exactly one scope: {"asset":…}, {"assets":[…]} (sorted, distinct), {"issuer":…} or {"parent":…}.
CREATE FUNCTION public.verifier_counterparty_criteria_valid(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; names text[]; asset_name constant text := '^(XCP|[B-Z][A-Z]{3,11}|A[0-9]{12,20})$';
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(c))<>1
  OR (c-ARRAY['asset','assets','issuer','parent'])<>'{}'::jsonb THEN RETURN false; END IF;
 IF c ? 'asset' THEN RETURN jsonb_typeof(c->'asset')='string' AND c->>'asset' ~ asset_name; END IF;
 IF c ? 'parent' THEN RETURN jsonb_typeof(c->'parent')='string' AND c->>'parent' ~ '^[B-Z][A-Z]{3,11}$'; END IF;
 IF c ? 'issuer' THEN RETURN jsonb_typeof(c->'issuer')='string' AND c->>'issuer' ~ '^(bc1[ac-hj-np-z02-9]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$'; END IF;
 IF jsonb_typeof(c->'assets')<>'array' OR jsonb_array_length(c->'assets') NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(c->'assets') LOOP
  IF jsonb_typeof(item)<>'string' OR item#>>'{}' !~ asset_name THEN RETURN false; END IF;
 END LOOP;
 SELECT array_agg(v ORDER BY v COLLATE "C") INTO names FROM (SELECT DISTINCT jsonb_array_elements_text(c->'assets') v) s;
 RETURN to_jsonb(names) IS NOT DISTINCT FROM c->'assets';
END $$;
REVOKE ALL ON FUNCTION public.verifier_counterparty_criteria_valid(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_counterparty_criteria_valid(jsonb) TO service_role;

-- Every existing branch now also requires counterparty_criteria IS NULL.
ALTER TABLE public.verifier_rules DROP CONSTRAINT verifier_rules_asset_fields_check;
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_asset_fields_check CHECK (
 (counterparty_criteria IS NULL AND (
 (stamp_criteria IS NULL AND (
 (solana_criteria IS NULL AND (
  (asset_type <> 'erc20' AND min_balance IS NULL AND token_decimals IS NULL AND token_symbol IS NULL AND (
  (asset_type = 'ethscription' AND slug IS NOT NULL AND chain_id IS NOT NULL AND inscription_criteria IS NULL
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND collection_name IS NULL)
  OR
  (asset_type = 'nft' AND inscription_criteria IS NULL AND chain_id IS NOT NULL AND chain_id IN (1, 4663, 8453) AND slug IS NULL
    AND min_items BETWEEN 1 AND 9007199254740991
    AND contract_address IS NOT NULL AND contract_address ~ '^0x[0-9a-f]{40}$'
    AND contract_address <> '0x0000000000000000000000000000000000000000'
    AND token_standard IS NOT NULL AND token_standard IN ('erc721', 'erc1155')
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100)
    AND (
      (token_standard = 'erc721' AND (token_ids IS NULL OR
        public.verifier_nft_ids_valid(token_ids) IS TRUE))
      OR
      (token_standard = 'erc1155' AND token_ids IS NOT NULL AND public.verifier_nft_ids_valid(token_ids) IS TRUE)
    ))
  OR
  (asset_type = 'ordinal' AND inscription_criteria IS NULL AND chain_id IS NULL
    AND slug IS NOT NULL AND slug <> 'all' AND slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100))
  OR
  (asset_type IN ('ethscription', 'ordinal') AND slug IS NULL
    AND trait_filter IS NULL AND inscription_criteria IS NOT NULL
    AND public.verifier_inscription_criteria_valid(inscription_criteria, asset_type, min_items) IS TRUE
    AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
    AND ((asset_type = 'ordinal' AND chain_id IS NULL) OR (asset_type = 'ethscription' AND chain_id IS NOT NULL AND chain_id = 1))
    AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND collection_name IS NULL AND ordinal_trait_snapshot IS NULL)
  )) OR (
    asset_type = 'erc20' AND chain_id IS NOT NULL AND chain_id IN (1, 4663, 8453)
    AND contract_address IS NOT NULL AND contract_address ~ '^0x[0-9a-f]{40}$'
    AND contract_address <> '0x0000000000000000000000000000000000000000'
    AND trait_filter IS NULL AND slug IS NULL AND token_standard IS NULL AND token_ids IS NULL
    AND inscription_criteria IS NULL AND ordinal_trait_snapshot IS NULL
    AND min_items IS NULL AND token_decimals IS NOT NULL AND token_decimals BETWEEN 0 AND 255
    AND min_balance IS NOT NULL
    AND CASE WHEN min_balance ~ '^[1-9][0-9]{0,77}$' THEN min_balance::numeric <= 115792089237316195423570985008687907853269984665640564039457584007913129639935 ELSE false END
    AND (collection_name IS NULL OR char_length(collection_name) BETWEEN 1 AND 100)
    AND (token_symbol IS NULL OR char_length(token_symbol) BETWEEN 1 AND 32)
  )
 )) OR (
 asset_type IN ('solana_nft','solana_token') AND solana_criteria IS NOT NULL
 AND public.verifier_solana_criteria_valid(solana_criteria,asset_type) IS TRUE
 AND chain_id IS NULL AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND slug IS NULL
 AND inscription_criteria IS NULL AND ordinal_trait_snapshot IS NULL AND token_symbol IS NULL AND collection_name IS NULL
 AND ((asset_type='solana_nft' AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
  AND min_balance IS NULL AND token_decimals IS NULL AND public.verifier_collectible_traits_valid(trait_filter))
 OR (asset_type='solana_token' AND min_items IS NULL AND trait_filter IS NULL AND token_decimals IS NOT NULL AND token_decimals BETWEEN 0 AND 255
  AND min_balance IS NOT NULL AND CASE WHEN min_balance ~ '^[1-9][0-9]{0,19}$' THEN min_balance::numeric<=18446744073709551615 ELSE false END))
 ))) OR (
 asset_type='stamp' AND stamp_criteria IS NOT NULL AND public.verifier_stamp_criteria_valid(stamp_criteria) IS TRUE
 AND solana_criteria IS NULL AND slug IS NULL AND chain_id IS NULL AND trait_filter IS NULL
 AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND collection_name IS NULL
 AND inscription_criteria IS NULL AND ordinal_trait_snapshot IS NULL AND rule_label IS NULL
 AND min_balance IS NULL AND token_decimals IS NULL AND token_symbol IS NULL
 AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991
)))
 OR (
 asset_type='counterparty' AND counterparty_criteria IS NOT NULL AND public.verifier_counterparty_criteria_valid(counterparty_criteria) IS TRUE
 AND stamp_criteria IS NULL AND solana_criteria IS NULL AND slug IS NULL AND chain_id IS NULL AND trait_filter IS NULL
 AND contract_address IS NULL AND token_standard IS NULL AND token_ids IS NULL AND collection_name IS NULL
 AND inscription_criteria IS NULL AND ordinal_trait_snapshot IS NULL AND rule_label IS NULL
 AND (
  -- One asset: a minimum balance in raw units (Counterparty quantities are signed 64-bit).
  (counterparty_criteria ? 'asset' AND min_items IS NULL AND token_decimals IS NOT NULL AND token_decimals IN (0,8)
   AND token_symbol IS NOT NULL AND char_length(token_symbol) BETWEEN 1 AND 270
   AND min_balance IS NOT NULL AND CASE WHEN min_balance ~ '^[1-9][0-9]{0,18}$' THEN min_balance::numeric<=9223372036854775807 ELSE false END)
  -- Lists, issuers and parents count copies of indivisible assets.
  OR (NOT counterparty_criteria ? 'asset' AND min_balance IS NULL AND token_decimals IS NULL AND token_symbol IS NULL
   AND min_items IS NOT NULL AND min_items BETWEEN 1 AND 9007199254740991)
 )
));

CREATE OR REPLACE FUNCTION public.verifier_portal_definition(r jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_object_agg(k,CASE WHEN k='additional_roles' THEN to_jsonb(ARRAY(SELECT v->>'id' FROM jsonb_array_elements(coalesce(r->'additional_roles','[]'::jsonb)) v ORDER BY v->>'id')) WHEN k='trait_filter' THEN coalesce(public.verifier_traits_key(public.verifier_rule_traits(r)),'null'::jsonb) ELSE coalesce(r->k,'null'::jsonb) END)
 FROM unnest(ARRAY['server_id','channel_id','role_id','additional_roles','asset_type','chain_id','contract_address','slug','trait_filter',
 'solana_criteria','stamp_criteria','counterparty_criteria','min_items','token_standard','token_ids','collection_name','inscription_criteria','rule_label','min_balance','token_decimals','token_symbol']) k;
$$;

CREATE OR REPLACE FUNCTION public.verifier_unique_traits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (public.verifier_portal_definition(to_jsonb(NEW))-'rule_label'-'collection_name')=(public.verifier_portal_definition(to_jsonb(OLD))-'rule_label'-'collection_name') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('trait-rules:'||NEW.server_id,0));
 IF EXISTS(SELECT 1 FROM public.verifier_rules r WHERE r.id<>NEW.id AND r.server_id=NEW.server_id AND r.channel_id=NEW.channel_id AND public.verifier_rule_role_ids(to_jsonb(r)) && public.verifier_rule_role_ids(to_jsonb(NEW))
  AND r.asset_type=NEW.asset_type AND r.chain_id IS NOT DISTINCT FROM NEW.chain_id AND r.contract_address IS NOT DISTINCT FROM NEW.contract_address
  AND r.solana_criteria IS NOT DISTINCT FROM NEW.solana_criteria
  AND r.stamp_criteria IS NOT DISTINCT FROM NEW.stamp_criteria
  AND r.counterparty_criteria IS NOT DISTINCT FROM NEW.counterparty_criteria
  AND r.slug IS NOT DISTINCT FROM NEW.slug AND r.token_standard IS NOT DISTINCT FROM NEW.token_standard
  AND public.verifier_nft_ids_key(r.token_ids) IS NOT DISTINCT FROM public.verifier_nft_ids_key(NEW.token_ids)
  AND public.verifier_inscription_criteria_key(r.inscription_criteria) IS NOT DISTINCT FROM public.verifier_inscription_criteria_key(NEW.inscription_criteria)
  AND r.min_items IS NOT DISTINCT FROM NEW.min_items AND r.min_balance IS NOT DISTINCT FROM NEW.min_balance
  AND r.trait_key IS NOT DISTINCT FROM public.verifier_traits_key(NEW.trait_filter)) THEN
  RAISE EXCEPTION 'An identical rule already exists' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.verifier_portal_mutate_rule(p_server text,p_actor text,p_request uuid,
 p_before jsonb,p_after jsonb,p_reverts uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE current_rule public.verifier_rules; replacement public.verifier_rules;
 action public.verifier_portal_actions; original public.verifier_portal_actions; rid bigint; audience text[]; old_roles text[]; new_roles text[]; target text;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('portal:'||p_server,0));
 PERFORM set_config('bouncer.portal_mutation','true',true);
 SELECT * INTO action FROM public.verifier_portal_actions WHERE request_id=p_request;
 IF FOUND THEN
  IF action.server_id<>p_server OR action.actor_id<>p_actor THEN RAISE EXCEPTION 'Request conflict'; END IF;
  RETURN to_jsonb(action);
 END IF;
 IF p_before IS NULL AND p_after IS NULL THEN RAISE EXCEPTION 'Empty mutation'; END IF;
 IF p_before IS NOT NULL THEN
  rid := (p_before->>'id')::bigint;
  SELECT * INTO current_rule FROM public.verifier_rules WHERE id=rid AND server_id=p_server FOR UPDATE;
  IF NOT FOUND OR public.verifier_portal_definition(to_jsonb(current_rule)) IS DISTINCT FROM public.verifier_portal_definition(p_before)
   THEN RAISE EXCEPTION 'Rule changed. Refresh before saving.' USING ERRCODE='40001'; END IF;
 END IF;
 IF p_reverts IS NOT NULL THEN
  SELECT * INTO original FROM public.verifier_portal_actions WHERE id=p_reverts AND server_id=p_server;
  IF NOT FOUND OR original.before_rule IS DISTINCT FROM p_after OR original.after_rule IS DISTINCT FROM p_before
   THEN RAISE EXCEPTION 'Invalid reversal'; END IF;
 END IF;
 IF p_after IS NOT NULL THEN
  replacement := jsonb_populate_record(NULL::public.verifier_rules,p_after);
  replacement.trait_filter:=public.verifier_rule_traits(p_after);
  replacement.additional_roles:=coalesce(p_after->'additional_roles','[]'::jsonb);
  IF replacement.server_id IS DISTINCT FROM p_server THEN RAISE EXCEPTION 'Invalid server'; END IF;
  IF p_before IS NOT NULL THEN
   IF replacement.id IS DISTINCT FROM rid OR replacement.channel_id IS DISTINCT FROM current_rule.channel_id
    OR replacement.solana_criteria IS DISTINCT FROM current_rule.solana_criteria
    OR replacement.stamp_criteria IS DISTINCT FROM current_rule.stamp_criteria
    OR replacement.counterparty_criteria IS DISTINCT FROM current_rule.counterparty_criteria
    OR replacement.asset_type IS DISTINCT FROM current_rule.asset_type
    OR replacement.chain_id IS DISTINCT FROM current_rule.chain_id OR replacement.contract_address IS DISTINCT FROM current_rule.contract_address
    THEN RAISE EXCEPTION 'Rule identity cannot change'; END IF;
   UPDATE public.verifier_rules SET role_id=replacement.role_id,role_name=replacement.role_name,additional_roles=replacement.additional_roles,slug=replacement.slug,trait_filter=replacement.trait_filter,
    min_items=replacement.min_items,token_ids=replacement.token_ids,inscription_criteria=replacement.inscription_criteria,
    rule_label=replacement.rule_label,ordinal_trait_snapshot=replacement.ordinal_trait_snapshot,min_balance=replacement.min_balance,
    collection_name=replacement.collection_name WHERE id=rid RETURNING * INTO replacement;
  ELSE
   IF replacement.id IS NOT NULL AND p_reverts IS NULL THEN RAISE EXCEPTION 'Invalid new rule ID'; END IF;
   IF replacement.id IS NULL THEN replacement.id:=nextval(pg_get_serial_sequence('public.verifier_rules','id')); END IF;
   INSERT INTO public.verifier_rules (id,server_id,server_name,channel_id,channel_name,role_id,role_name,additional_roles,slug,trait_filter,
    min_items,asset_type,chain_id,contract_address,token_standard,token_ids,collection_name,
    ordinal_trait_snapshot,inscription_criteria,rule_label,min_balance,token_decimals,token_symbol,solana_criteria,stamp_criteria,counterparty_criteria)
   VALUES (replacement.id,p_server,replacement.server_name,replacement.channel_id,replacement.channel_name,replacement.role_id,
    replacement.role_name,replacement.additional_roles,replacement.slug,replacement.trait_filter,replacement.min_items,
    replacement.asset_type,replacement.chain_id,replacement.contract_address,replacement.token_standard,replacement.token_ids,
    replacement.collection_name,replacement.ordinal_trait_snapshot,replacement.inscription_criteria,replacement.rule_label,
    replacement.min_balance,replacement.token_decimals,replacement.token_symbol,replacement.solana_criteria,replacement.stamp_criteria,replacement.counterparty_criteria) RETURNING * INTO replacement;
  END IF;
 ELSE
  DELETE FROM public.verifier_rules WHERE id=rid;
 END IF;
 INSERT INTO public.verifier_portal_actions(server_id,actor_id,kind,before_rule,after_rule,reverts,request_id)
 VALUES(p_server,p_actor,CASE WHEN p_reverts IS NOT NULL THEN 'reverse' WHEN p_before IS NULL THEN 'create'
  WHEN p_after IS NULL THEN 'delete' ELSE 'edit' END,p_before,CASE WHEN p_after IS NULL THEN NULL ELSE to_jsonb(replacement) END,p_reverts,p_request)
 RETURNING * INTO action;
 old_roles:=public.verifier_rule_role_ids(p_before);
 new_roles:=public.verifier_rule_role_ids(CASE WHEN p_after IS NULL THEN NULL ELSE to_jsonb(replacement) END);
 -- A new output inherits the previous rule's earned audience, not the entire server.
 SELECT coalesce(array_agg(DISTINCT user_id ORDER BY user_id),'{}'::text[]) INTO audience FROM (
  SELECT user_id FROM public.verifier_user_roles WHERE server_id=p_server
   AND role_id=ANY(CASE WHEN cardinality(old_roles)>0 THEN old_roles ELSE new_roles END)
   AND status IN ('active','revoked','expired')
  UNION SELECT unnest(member_ids) FROM public.verifier_reconciliation_jobs
   WHERE server_id=p_server AND rule_id=coalesce(replacement.id,current_rule.id)
 ) members;
 FOR target IN SELECT DISTINCT unnest(old_roles||new_roles) LOOP
  IF target=ANY(new_roles) AND (NOT target=ANY(old_roles)) AND (p_before IS NOT NULL OR p_reverts IS NOT NULL) THEN
   INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,role_id,rule_id,member_ids,created_at)
    VALUES(action.id,p_server,target,replacement.id,audience,clock_timestamp());
  ELSE
   INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,role_id,created_at)
    VALUES(action.id,p_server,target,clock_timestamp());
  END IF;
 END LOOP;
 RETURN to_jsonb(action);
END;
$$;

-- Counterparty balances are read from Bitcoin addresses, like Stamps.
CREATE OR REPLACE FUNCTION public.verifier_wallet_rule_network(r jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN r->>'asset_type' IN ('ordinal','stamp','counterparty') THEN 'bitcoin'
 WHEN r->>'asset_type' IN ('solana_nft','solana_token') THEN 'solana'
 WHEN coalesce(r->>'asset_type','ethscription')='ethscription' THEN 'ethereum'
 WHEN (r->>'chain_id')::integer=4663 THEN 'robinhood'
 WHEN (r->>'chain_id')::integer=8453 THEN 'base' ELSE 'ethereum' END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
