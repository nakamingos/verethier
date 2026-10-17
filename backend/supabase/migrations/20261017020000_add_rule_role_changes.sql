BEGIN;
ALTER TABLE public.verifier_reconciliation_jobs ADD COLUMN rule_id bigint, ADD COLUMN member_ids text[];
ALTER TABLE public.verifier_reconciliation_jobs ADD CONSTRAINT verifier_jobs_rule_audience CHECK (
 (rule_id IS NULL AND member_ids IS NULL) OR (rule_id IS NOT NULL AND member_ids IS NOT NULL AND role_id IS NOT NULL AND user_id IS NULL)
);
CREATE INDEX ON public.verifier_reconciliation_jobs(server_id,rule_id) WHERE rule_id IS NOT NULL;
COMMENT ON COLUMN public.verifier_reconciliation_jobs.member_ids IS 'Snapshot of previously earned role holders affected by an administrator role change; fresh group eligibility is required before granting';

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
  IF replacement.server_id IS DISTINCT FROM p_server THEN RAISE EXCEPTION 'Invalid server'; END IF;
  IF p_before IS NOT NULL THEN
   IF replacement.id IS DISTINCT FROM rid OR replacement.channel_id IS DISTINCT FROM current_rule.channel_id
    OR replacement.asset_type IS DISTINCT FROM current_rule.asset_type
    OR replacement.chain_id IS DISTINCT FROM current_rule.chain_id OR replacement.contract_address IS DISTINCT FROM current_rule.contract_address
    THEN RAISE EXCEPTION 'Rule identity cannot change'; END IF;
   UPDATE public.verifier_rules SET role_id=replacement.role_id,role_name=replacement.role_name,slug=replacement.slug,attribute_key=replacement.attribute_key,attribute_value=replacement.attribute_value,
    min_items=replacement.min_items,token_ids=replacement.token_ids,inscription_criteria=replacement.inscription_criteria,
    rule_label=replacement.rule_label,ordinal_trait_snapshot=replacement.ordinal_trait_snapshot,min_balance=replacement.min_balance,
    collection_name=replacement.collection_name WHERE id=rid RETURNING * INTO replacement;
  ELSE
   IF replacement.id IS NOT NULL AND p_reverts IS NULL THEN RAISE EXCEPTION 'Invalid new rule ID'; END IF;
   IF replacement.id IS NULL THEN replacement.id:=nextval(pg_get_serial_sequence('public.verifier_rules','id')); END IF;
   INSERT INTO public.verifier_rules (id,server_id,server_name,channel_id,channel_name,role_id,role_name,slug,attribute_key,
    attribute_value,min_items,asset_type,chain_id,contract_address,token_standard,token_ids,collection_name,
    ordinal_trait_snapshot,inscription_criteria,rule_label,min_balance,token_decimals,token_symbol)
   VALUES (replacement.id,p_server,replacement.server_name,replacement.channel_id,replacement.channel_name,replacement.role_id,
    replacement.role_name,replacement.slug,replacement.attribute_key,replacement.attribute_value,replacement.min_items,
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

NOTIFY pgrst, 'reload schema';
COMMIT;
