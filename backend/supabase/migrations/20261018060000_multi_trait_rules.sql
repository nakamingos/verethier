BEGIN;
CREATE FUNCTION public.verifier_trait_condition_key(c jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_array(CASE WHEN c->>'key'='ALL' THEN NULL ELSE lower(c->>'key') END,
  CASE WHEN c->>'value'='ALL' THEN NULL ELSE lower(c->>'value') END);
$$;
CREATE FUNCTION public.verifier_traits_normalize(f jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE c jsonb; result jsonb:='[]'; k text; v text;
BEGIN
 IF f IS NULL OR f='null'::jsonb THEN RETURN NULL; END IF;
 IF jsonb_typeof(f)<>'object' OR f-'operator'-'conditions'<>'{}'::jsonb
  OR f->>'operator' NOT IN ('AND','OR') OR f->>'operator' IS NULL
  OR jsonb_typeof(f->'conditions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid trait filter' USING ERRCODE='22023'; END IF;
 IF jsonb_array_length(f->'conditions')>10 THEN RAISE EXCEPTION 'At most 10 trait conditions' USING ERRCODE='22023'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(f->'conditions') LOOP
  IF jsonb_typeof(c)<>'object' OR c-'key'-'value'<>'{}'::jsonb
   OR jsonb_typeof(c->'key') IS DISTINCT FROM 'string' OR jsonb_typeof(c->'value') IS DISTINCT FROM 'string'
   THEN RAISE EXCEPTION 'Each trait needs a key and value' USING ERRCODE='22023'; END IF;
  k:=btrim(c->>'key'); v:=btrim(c->>'value');
  IF length(k) NOT BETWEEN 1 AND 4000 OR length(v) NOT BETWEEN 1 AND 4000 OR (k='ALL' AND v='ALL')
   THEN RAISE EXCEPTION 'Invalid trait key or value' USING ERRCODE='22023'; END IF;
  c:=jsonb_build_object('key',k,'value',v);
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(result) item WHERE public.verifier_trait_condition_key(item)=public.verifier_trait_condition_key(c)) THEN
   result:=result||jsonb_build_array(c);
  END IF;
 END LOOP;
 IF jsonb_array_length(result)=0 THEN RETURN NULL; END IF;
 SELECT jsonb_agg(value ORDER BY public.verifier_trait_condition_key(value)::text COLLATE "C") INTO result FROM jsonb_array_elements(result);
 result:=jsonb_build_object('operator',CASE WHEN jsonb_array_length(result)=1 THEN 'AND' ELSE f->>'operator' END,'conditions',result);
 IF length(result::text)>20000 THEN RAISE EXCEPTION 'Trait filter too large' USING ERRCODE='22023'; END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.verifier_rule_traits(r jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE k text:=coalesce(nullif(btrim(r->>'attribute_key'),''),'ALL');
 v text:=coalesce(nullif(btrim(r->>'attribute_value'),''),'ALL');
BEGIN
 IF r ? 'trait_filter' THEN RETURN public.verifier_traits_normalize(r->'trait_filter'); END IF;
 IF k='ALL' AND v='ALL' THEN RETURN NULL; END IF;
 RETURN public.verifier_traits_normalize(jsonb_build_object('operator','AND','conditions',jsonb_build_array(jsonb_build_object('key',k,'value',v))));
END $$;
CREATE FUNCTION public.verifier_traits_key(f jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN normalized IS NULL THEN NULL ELSE jsonb_build_object('operator',normalized->>'operator',
  'conditions',(SELECT jsonb_agg(public.verifier_trait_condition_key(value) ORDER BY public.verifier_trait_condition_key(value)::text COLLATE "C") FROM jsonb_array_elements(normalized->'conditions'))) END
 FROM (SELECT public.verifier_traits_normalize(f) normalized) n;
$$;
ALTER TABLE public.verifier_rules ADD COLUMN trait_filter jsonb;
ALTER TABLE public.verifier_rules ADD COLUMN trait_key jsonb GENERATED ALWAYS AS (public.verifier_traits_key(trait_filter)) STORED;
-- Backfill preserves IDs, assignments, proof history and existing snapshot hashes.
SELECT set_config('bouncer.portal_mutation','true',true);
UPDATE public.verifier_rules SET trait_filter=public.verifier_rule_traits(to_jsonb(verifier_rules)-'trait_filter'-'trait_key');
SELECT set_config('bouncer.portal_mutation','false',true);

CREATE OR REPLACE FUNCTION public.verifier_portal_definition(r jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_object_agg(k,CASE WHEN k='trait_filter' THEN coalesce(public.verifier_traits_key(public.verifier_rule_traits(r)),'null'::jsonb) ELSE coalesce(r->k,'null'::jsonb) END)
 FROM unnest(ARRAY['server_id','channel_id','role_id','asset_type','chain_id','contract_address','slug','trait_filter',
 'min_items','token_standard','token_ids','collection_name','inscription_criteria','rule_label','min_balance','token_decimals','token_symbol']) k;
$$;

-- Legacy fields are guarded compatibility inputs/projections, never independent
-- criteria. Single-condition Discord inputs are translated into the canonical JSON.
CREATE FUNCTION public.verifier_sync_traits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE f jsonb; first_condition jsonb;
BEGIN
 IF TG_OP='INSERT' THEN
  f:=CASE WHEN NEW.trait_filter IS NULL THEN public.verifier_rule_traits(to_jsonb(NEW)-'trait_filter') ELSE public.verifier_traits_normalize(NEW.trait_filter) END;
 ELSIF NEW.trait_filter IS DISTINCT FROM OLD.trait_filter THEN
  f:=public.verifier_traits_normalize(NEW.trait_filter);
 ELSIF NEW.attribute_key IS DISTINCT FROM OLD.attribute_key OR NEW.attribute_value IS DISTINCT FROM OLD.attribute_value THEN
  IF jsonb_array_length(OLD.trait_filter->'conditions')>1 THEN RAISE EXCEPTION 'Edit multi-trait rules in the Control Room' USING ERRCODE='22023'; END IF;
  f:=public.verifier_rule_traits(to_jsonb(NEW)-'trait_filter');
 ELSE f:=public.verifier_traits_normalize(NEW.trait_filter);
 END IF;
 IF f IS NOT NULL AND (NEW.asset_type='erc20' OR NEW.inscription_criteria IS NOT NULL) THEN RAISE EXCEPTION 'This rule type does not support traits' USING ERRCODE='22023'; END IF;
 IF f IS NOT NULL AND NEW.asset_type IN ('nft','ordinal') AND EXISTS(SELECT 1 FROM jsonb_array_elements(f->'conditions') c WHERE c->>'key'='ALL' OR length(c->>'key')>100 OR length(c->>'value')>100)
  THEN RAISE EXCEPTION 'NFT and Ordinals traits require a key and 1-100 character values' USING ERRCODE='22023'; END IF;
 NEW.trait_filter:=f; first_condition:=f->'conditions'->0;
 NEW.attribute_key:=coalesce(first_condition->>'key','ALL'); NEW.attribute_value:=coalesce(first_condition->>'value','ALL');
 IF TG_OP='UPDATE' AND NEW.ordinal_trait_snapshot IS NOT DISTINCT FROM OLD.ordinal_trait_snapshot
  AND (public.verifier_traits_key(f) IS DISTINCT FROM OLD.trait_key OR NEW.slug IS DISTINCT FROM OLD.slug) THEN NEW.ordinal_trait_snapshot:=NULL; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_rules_00_traits BEFORE INSERT OR UPDATE ON public.verifier_rules FOR EACH ROW EXECUTE FUNCTION public.verifier_sync_traits();
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_rules_traits_canonical CHECK(trait_filter IS NOT DISTINCT FROM public.verifier_traits_normalize(trait_filter));

DROP INDEX public.verifier_rules_ethscription_unique;
DROP INDEX public.verifier_rules_nft_collection_unique;
DROP INDEX public.verifier_rules_nft_tokens_unique;
DROP INDEX public.verifier_rules_ordinal_unique;
CREATE INDEX verifier_rules_trait_scope ON public.verifier_rules(server_id,channel_id,role_id,md5(coalesce(trait_key::text,'null')));
-- Existing case-variant equivalent rules retain their IDs. Reject new duplicates
-- under a server lock, including direct/slash writes and reordered conditions.
CREATE FUNCTION public.verifier_unique_traits() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND (public.verifier_portal_definition(to_jsonb(NEW))-'rule_label'-'collection_name')=(public.verifier_portal_definition(to_jsonb(OLD))-'rule_label'-'collection_name') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('trait-rules:'||NEW.server_id,0));
 IF EXISTS(SELECT 1 FROM public.verifier_rules r WHERE r.id<>NEW.id AND r.server_id=NEW.server_id AND r.channel_id=NEW.channel_id AND r.role_id=NEW.role_id
  AND r.asset_type=NEW.asset_type AND r.chain_id IS NOT DISTINCT FROM NEW.chain_id AND r.contract_address IS NOT DISTINCT FROM NEW.contract_address
  AND r.slug IS NOT DISTINCT FROM NEW.slug AND r.token_standard IS NOT DISTINCT FROM NEW.token_standard
  AND public.verifier_nft_ids_key(r.token_ids) IS NOT DISTINCT FROM public.verifier_nft_ids_key(NEW.token_ids)
  AND public.verifier_inscription_criteria_key(r.inscription_criteria) IS NOT DISTINCT FROM public.verifier_inscription_criteria_key(NEW.inscription_criteria)
  AND r.min_items IS NOT DISTINCT FROM NEW.min_items AND r.min_balance IS NOT DISTINCT FROM NEW.min_balance
  AND r.trait_key IS NOT DISTINCT FROM public.verifier_traits_key(NEW.trait_filter)) THEN
  RAISE EXCEPTION 'An identical rule already exists' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_rules_01_unique_traits BEFORE INSERT OR UPDATE ON public.verifier_rules FOR EACH ROW EXECUTE FUNCTION public.verifier_unique_traits();

DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('verifier_trait_condition_key','verifier_traits_normalize','verifier_rule_traits','verifier_traits_key','verifier_sync_traits','verifier_unique_traits') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
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
    ordinal_trait_snapshot,inscription_criteria,rule_label,min_balance,token_decimals,token_symbol)
   VALUES (replacement.id,p_server,replacement.server_name,replacement.channel_id,replacement.channel_name,replacement.role_id,
    replacement.role_name,replacement.slug,replacement.trait_filter,replacement.min_items,
    replacement.asset_type,replacement.chain_id,replacement.contract_address,replacement.token_standard,replacement.token_ids,
    replacement.collection_name,replacement.ordinal_trait_snapshot,replacement.inscription_criteria,replacement.rule_label,
    replacement.min_balance,replacement.token_decimals,replacement.token_symbol) RETURNING * INTO replacement;
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


NOTIFY pgrst,'reload schema';
COMMIT;
