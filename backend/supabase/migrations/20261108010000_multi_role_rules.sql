BEGIN;
-- Existing single-role rules retain their ID, requirements, and primary output.
ALTER TABLE public.verifier_rules ADD COLUMN additional_roles jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE FUNCTION public.verifier_rule_role_ids(r jsonb) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN r IS NULL THEN '{}'::text[] ELSE
 ARRAY[r->>'role_id'] || ARRAY(SELECT v->>'id' FROM jsonb_array_elements(coalesce(r->'additional_roles','[]'::jsonb)) v) END;
$$;
CREATE FUNCTION public.verifier_additional_roles_valid(primary_id text, roles jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; seen text[]:=ARRAY[primary_id];
BEGIN
 IF roles IS NULL OR jsonb_typeof(roles)<>'array' THEN RETURN false; END IF;
 IF jsonb_array_length(roles)>19 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(roles) LOOP
  IF jsonb_typeof(item)<>'object' OR NOT item ?& ARRAY['id','name'] OR (item-ARRAY['id','name'])<>'{}'::jsonb
   OR jsonb_typeof(item->'id')<>'string' OR jsonb_typeof(item->'name')<>'string'
   OR item->>'id' !~ '^\d{17,22}$' OR length(btrim(item->>'name')) NOT BETWEEN 1 AND 100
   OR item->>'id'=ANY(seen) THEN RETURN false; END IF;
  seen:=array_append(seen,item->>'id');
 END LOOP;
 RETURN true;
END $$;
ALTER TABLE public.verifier_rules ADD CONSTRAINT verifier_additional_roles_check
 CHECK(public.verifier_additional_roles_valid(role_id,additional_roles));
REVOKE ALL ON FUNCTION public.verifier_rule_role_ids(jsonb),public.verifier_additional_roles_valid(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_rule_role_ids(jsonb),public.verifier_additional_roles_valid(text,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.verifier_portal_definition(r jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT jsonb_object_agg(k,CASE WHEN k='additional_roles' THEN to_jsonb(ARRAY(SELECT v->>'id' FROM jsonb_array_elements(coalesce(r->'additional_roles','[]'::jsonb)) v ORDER BY v->>'id')) WHEN k='trait_filter' THEN coalesce(public.verifier_traits_key(public.verifier_rule_traits(r)),'null'::jsonb) ELSE coalesce(r->k,'null'::jsonb) END)
 FROM unnest(ARRAY['server_id','channel_id','role_id','additional_roles','asset_type','chain_id','contract_address','slug','trait_filter',
 'solana_criteria','stamp_criteria','min_items','token_standard','token_ids','collection_name','inscription_criteria','rule_label','min_balance','token_decimals','token_symbol']) k;
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
    ordinal_trait_snapshot,inscription_criteria,rule_label,min_balance,token_decimals,token_symbol,solana_criteria,stamp_criteria)
   VALUES (replacement.id,p_server,replacement.server_name,replacement.channel_id,replacement.channel_name,replacement.role_id,
    replacement.role_name,replacement.additional_roles,replacement.slug,replacement.trait_filter,replacement.min_items,
    replacement.asset_type,replacement.chain_id,replacement.contract_address,replacement.token_standard,replacement.token_ids,
    replacement.collection_name,replacement.ordinal_trait_snapshot,replacement.inscription_criteria,replacement.rule_label,
    replacement.min_balance,replacement.token_decimals,replacement.token_symbol,replacement.solana_criteria,replacement.stamp_criteria) RETURNING * INTO replacement;
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
CREATE OR REPLACE FUNCTION public.verifier_queue_rule_reconciliation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_ids text[]:='{}'; new_ids text[]:='{}'; target text;
BEGIN
 IF current_setting('bouncer.portal_mutation',true)='true' THEN RETURN coalesce(NEW,OLD); END IF;
 IF TG_OP<>'INSERT' THEN old_ids:=public.verifier_rule_role_ids(to_jsonb(OLD)); END IF;
 IF TG_OP<>'DELETE' THEN new_ids:=public.verifier_rule_role_ids(to_jsonb(NEW)); END IF;
 IF TG_OP='UPDATE' AND public.verifier_portal_definition(to_jsonb(NEW))=public.verifier_portal_definition(to_jsonb(OLD)) THEN RETURN NEW; END IF;
 FOR target IN SELECT DISTINCT unnest(old_ids||new_ids) LOOP
  INSERT INTO public.verifier_reconciliation_jobs(server_id,role_id) VALUES(coalesce(NEW.server_id,OLD.server_id),target);
 END LOOP;
 RETURN coalesce(NEW,OLD);
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
