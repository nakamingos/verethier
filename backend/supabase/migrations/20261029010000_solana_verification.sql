BEGIN;
-- Additive only. Existing wallet identities and rule values are not rewritten.
ALTER TABLE public.verifier_rules ADD COLUMN solana_criteria jsonb;
ALTER TABLE public.user_wallets DROP CONSTRAINT user_wallets_address_check;
ALTER TABLE public.user_wallets ADD CONSTRAINT user_wallets_address_check CHECK (
 (wallet_type='evm' AND address ~ '^0x[a-fA-F0-9]{40}$') OR
 (wallet_type='bitcoin' AND address ~ '^bc1p[ac-hj-np-z02-9]{58}$') OR
 (wallet_type='solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'));
ALTER TABLE public.verifier_member_flows DROP CONSTRAINT verifier_member_flows_wallet_type_check;
ALTER TABLE public.verifier_member_flows ADD CONSTRAINT verifier_member_flows_wallet_type_check CHECK(wallet_type IN ('evm','bitcoin','solana'));
ALTER TABLE public.verifier_wallet_blocks DROP CONSTRAINT verifier_wallet_blocks_wallet_type_check;
ALTER TABLE public.verifier_wallet_blocks ADD CONSTRAINT verifier_wallet_blocks_wallet_type_check CHECK(wallet_type IN ('evm','bitcoin','solana'));
ALTER TABLE public.verifier_wallet_blocks DROP CONSTRAINT verifier_wallet_blocks_address_check;
ALTER TABLE public.verifier_wallet_blocks ADD CONSTRAINT verifier_wallet_blocks_address_check CHECK (
 (wallet_type='evm' AND address ~ '^0x[0-9a-f]{40}$') OR
 (wallet_type='bitcoin' AND address ~ '^bc1p[ac-hj-np-z02-9]{58}$') OR
 (wallet_type='solana' AND address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'));

CREATE FUNCTION public.verifier_solana_criteria_valid(c jsonb,t text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; addresses text[]; formats text[];
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' THEN RETURN false; END IF;
 IF t='solana_token' THEN
  RETURN c->>'kind'='token' AND c ?& ARRAY['kind','mint','program'] AND (c-ARRAY['kind','mint','program'])='{}'::jsonb
   AND jsonb_typeof(c->'mint')='string' AND c->>'mint' ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
   AND c->>'program' IN ('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
 END IF;
 IF t<>'solana_nft' OR c->>'kind' NOT IN ('collection','verified_creator','asset_ids')
  OR NOT c ?& ARRAY['kind','addresses','formats'] OR (c-ARRAY['kind','addresses','formats'])<>'{}'::jsonb
  OR jsonb_typeof(c->'addresses')<>'array' OR jsonb_typeof(c->'formats')<>'array' THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(c->'addresses') LOOP
  IF jsonb_typeof(item)<>'string' OR item#>>'{}' !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN RETURN false; END IF;
 END LOOP;
 SELECT array_agg(v ORDER BY v COLLATE "C") INTO addresses FROM (SELECT DISTINCT jsonb_array_elements_text(c->'addresses') v) s;
 IF coalesce(cardinality(addresses),0) NOT BETWEEN 1 AND (CASE WHEN c->>'kind'='asset_ids' THEN 1000 ELSE 20 END)
   OR to_jsonb(addresses) IS DISTINCT FROM c->'addresses' THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(c->'formats') LOOP
  IF jsonb_typeof(item)<>'string' OR item#>>'{}' NOT IN ('metadata','core') THEN RETURN false; END IF;
 END LOOP;
 SELECT array_agg(v ORDER BY v COLLATE "C") INTO formats FROM (SELECT DISTINCT jsonb_array_elements_text(c->'formats') v) s;
 RETURN coalesce(cardinality(formats),0) BETWEEN 1 AND 2 AND to_jsonb(formats)=c->'formats';
END $$;
REVOKE ALL ON FUNCTION public.verifier_solana_criteria_valid(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_solana_criteria_valid(jsonb,text) TO service_role;

ALTER TABLE public.verifier_rules DROP CONSTRAINT verifier_rules_asset_fields_check;
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_asset_fields_check CHECK (
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
 ));

CREATE OR REPLACE FUNCTION public.verifier_portal_definition(r jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_object_agg(k,CASE WHEN k='trait_filter' THEN coalesce(public.verifier_traits_key(public.verifier_rule_traits(r)),'null'::jsonb) ELSE coalesce(r->k,'null'::jsonb) END)
 FROM unnest(ARRAY['server_id','channel_id','role_id','asset_type','chain_id','contract_address','slug','trait_filter',
 'solana_criteria','min_items','token_standard','token_ids','collection_name','inscription_criteria','rule_label','min_balance','token_decimals','token_symbol']) k;
$$;

CREATE OR REPLACE FUNCTION public.verifier_unique_traits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (public.verifier_portal_definition(to_jsonb(NEW))-'rule_label'-'collection_name')=(public.verifier_portal_definition(to_jsonb(OLD))-'rule_label'-'collection_name') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('trait-rules:'||NEW.server_id,0));
 IF EXISTS(SELECT 1 FROM public.verifier_rules r WHERE r.id<>NEW.id AND r.server_id=NEW.server_id AND r.channel_id=NEW.channel_id AND r.role_id=NEW.role_id
  AND r.asset_type=NEW.asset_type AND r.chain_id IS NOT DISTINCT FROM NEW.chain_id AND r.contract_address IS NOT DISTINCT FROM NEW.contract_address
  AND r.solana_criteria IS NOT DISTINCT FROM NEW.solana_criteria
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
 action public.verifier_portal_actions; original public.verifier_portal_actions; rid bigint; audience text[];
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
  IF replacement.server_id IS DISTINCT FROM p_server THEN RAISE EXCEPTION 'Invalid server'; END IF;
  IF p_before IS NOT NULL THEN
   IF replacement.id IS DISTINCT FROM rid OR replacement.channel_id IS DISTINCT FROM current_rule.channel_id
    OR replacement.solana_criteria IS DISTINCT FROM current_rule.solana_criteria
    OR replacement.asset_type IS DISTINCT FROM current_rule.asset_type
    OR replacement.chain_id IS DISTINCT FROM current_rule.chain_id OR replacement.contract_address IS DISTINCT FROM current_rule.contract_address
    THEN RAISE EXCEPTION 'Rule identity cannot change'; END IF;
   UPDATE public.verifier_rules SET role_id=replacement.role_id,role_name=replacement.role_name,slug=replacement.slug,trait_filter=replacement.trait_filter,
    min_items=replacement.min_items,token_ids=replacement.token_ids,inscription_criteria=replacement.inscription_criteria,
    rule_label=replacement.rule_label,ordinal_trait_snapshot=replacement.ordinal_trait_snapshot,min_balance=replacement.min_balance,
    collection_name=replacement.collection_name WHERE id=rid RETURNING * INTO replacement;
  ELSE
   IF replacement.id IS NOT NULL AND p_reverts IS NULL THEN RAISE EXCEPTION 'Invalid new rule ID'; END IF;
   IF replacement.id IS NULL THEN replacement.id:=nextval(pg_get_serial_sequence('public.verifier_rules','id')); END IF;
   INSERT INTO public.verifier_rules (id,server_id,server_name,channel_id,channel_name,role_id,role_name,slug,trait_filter,
    min_items,asset_type,chain_id,contract_address,token_standard,token_ids,collection_name,
    ordinal_trait_snapshot,inscription_criteria,rule_label,min_balance,token_decimals,token_symbol,solana_criteria)
   VALUES (replacement.id,p_server,replacement.server_name,replacement.channel_id,replacement.channel_name,replacement.role_id,
    replacement.role_name,replacement.slug,replacement.trait_filter,replacement.min_items,
    replacement.asset_type,replacement.chain_id,replacement.contract_address,replacement.token_standard,replacement.token_ids,
    replacement.collection_name,replacement.ordinal_trait_snapshot,replacement.inscription_criteria,replacement.rule_label,
    replacement.min_balance,replacement.token_decimals,replacement.token_symbol,replacement.solana_criteria) RETURNING * INTO replacement;
  END IF;
 ELSE
  DELETE FROM public.verifier_rules WHERE id=rid;
 END IF;
 INSERT INTO public.verifier_portal_actions(server_id,actor_id,kind,before_rule,after_rule,reverts,request_id)
 VALUES(p_server,p_actor,CASE WHEN p_reverts IS NOT NULL THEN 'reverse' WHEN p_before IS NULL THEN 'create'
  WHEN p_after IS NULL THEN 'delete' ELSE 'edit' END,p_before,CASE WHEN p_after IS NULL THEN NULL ELSE to_jsonb(replacement) END,p_reverts,p_request)
 RETURNING * INTO action;
 IF p_after IS NOT NULL AND ((p_before IS NOT NULL AND current_rule.role_id IS DISTINCT FROM replacement.role_id)
   OR (p_before IS NULL AND p_reverts IS NOT NULL)) THEN
  -- A combined role has one representative rule in assignment history. Capture
  -- all previous holders of the old role, then verify the new rule's group.
  -- Carry earlier audiences forward so rapid edits and Undo/Redo cannot strand
  -- a member whose earlier move is still queued or was interrupted.
  SELECT coalesce(array_agg(DISTINCT user_id ORDER BY user_id),'{}'::text[]) INTO audience FROM (
   SELECT user_id FROM public.verifier_user_roles WHERE server_id=p_server
    AND role_id=coalesce(current_rule.role_id,replacement.role_id) AND status IN ('active','revoked','expired')
   UNION
   SELECT unnest(member_ids) FROM public.verifier_reconciliation_jobs WHERE server_id=p_server AND rule_id=replacement.id
  ) members;
  INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,role_id,rule_id,member_ids,created_at)
   VALUES(action.id,p_server,replacement.role_id,replacement.id,audience,clock_timestamp());
  IF p_before IS NOT NULL AND current_rule.role_id IS DISTINCT FROM replacement.role_id THEN
   INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,role_id,created_at)
    VALUES(action.id,p_server,current_rule.role_id,clock_timestamp());
  END IF;
 ELSE
  INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,role_id)
   VALUES(action.id,p_server,coalesce(replacement.role_id,current_rule.role_id));
 END IF;
 RETURN to_jsonb(action);
END;
$$;

CREATE OR REPLACE FUNCTION public.verifier_portal_wallet_block(p_server text,p_actor text,p_address text,
 p_blocked boolean,p_reason text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior public.verifier_wallet_blocks; replacement public.verifier_wallet_blocks;
 action public.verifier_portal_actions; total integer; action_kind text;
BEGIN
 IF p_blocked IS NULL THEN RAISE EXCEPTION 'Invalid restriction'; END IF;
 action_kind:=CASE WHEN p_blocked THEN 'wallet_block' ELSE 'wallet_unblock' END;
 p_reason:=nullif(btrim(p_reason),'');
 PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||p_address,0));
 SELECT * INTO action FROM public.verifier_portal_actions WHERE request_id=p_request;
 IF FOUND THEN
  IF action.server_id<>p_server OR action.actor_id<>p_actor OR action.kind<>action_kind
   OR coalesce(action.after_rule->>'address',action.before_rule->>'address') IS DISTINCT FROM p_address
   OR (p_blocked AND action.after_rule->>'reason' IS DISTINCT FROM p_reason)
  THEN RAISE EXCEPTION 'Request conflict'; END IF;
  SELECT count(*) INTO total FROM public.verifier_reconciliation_jobs WHERE action_id=action.id;
  RETURN jsonb_build_object('address',p_address,'blocked',p_blocked,'jobs',total,'action_id',action.id);
 END IF;
 SELECT * INTO prior FROM public.verifier_wallet_blocks WHERE server_id=p_server AND address=p_address FOR UPDATE;
 IF p_blocked THEN
  INSERT INTO public.verifier_wallet_blocks(server_id,address,wallet_type,reason,blocked_by)
  VALUES(p_server,p_address,CASE WHEN p_address LIKE '0x%' THEN 'evm' WHEN length(p_address)=62 AND p_address LIKE 'bc1p%' THEN 'bitcoin' ELSE 'solana' END,p_reason,p_actor)
  ON CONFLICT(server_id,address) DO UPDATE SET reason=excluded.reason,blocked_by=excluded.blocked_by,blocked_at=now()
  RETURNING * INTO replacement;
 ELSE
  DELETE FROM public.verifier_wallet_blocks WHERE server_id=p_server AND address=p_address;
 END IF;
 INSERT INTO public.verifier_portal_actions(server_id,actor_id,kind,before_rule,after_rule,request_id)
 VALUES(p_server,p_actor,action_kind,CASE WHEN prior.address IS NULL THEN jsonb_build_object('address',p_address) ELSE to_jsonb(prior) END,
  CASE WHEN p_blocked THEN to_jsonb(replacement) ELSE NULL END,p_request) RETURNING * INTO action;
 INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,user_id)
 SELECT action.id,p_server,user_id FROM public.user_wallets WHERE address=p_address;
 GET DIAGNOSTICS total=ROW_COUNT;
 RETURN jsonb_build_object('address',p_address,'blocked',p_blocked,'jobs',total,'action_id',action.id);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
