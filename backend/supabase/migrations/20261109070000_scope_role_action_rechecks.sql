BEGIN;
-- Keep direct Discord enforcement unchanged. Ownership reconciliation is only
-- needed for members with earned history for one of the old/new removal targets.
-- The worker also narrows legacy member jobs using their immutable action receipt.
CREATE OR REPLACE FUNCTION public.verifier_portal_role_action(p_server text,p_actor text,p_trigger text,
 p_remove text[],p_expected timestamptz,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior public.verifier_role_actions; replacement public.verifier_role_actions;
 action public.verifier_portal_actions; action_kind text; normalized text[]; total integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('role-actions:'||p_server,0));
 action_kind:=CASE WHEN p_remove IS NULL THEN 'role_action_delete' ELSE 'role_action_set' END;
 SELECT array_agg(DISTINCT id ORDER BY id) INTO normalized FROM unnest(p_remove) id;
 SELECT * INTO action FROM public.verifier_portal_actions WHERE request_id=p_request;
 IF FOUND THEN
  IF action.server_id<>p_server OR action.actor_id<>p_actor OR action.kind<>action_kind
   OR coalesce(action.after_rule->>'trigger_role_id',action.before_rule->>'trigger_role_id') IS DISTINCT FROM p_trigger
   OR (p_remove IS NOT NULL AND action.after_rule->'remove_role_ids' IS DISTINCT FROM to_jsonb(normalized))
  THEN RAISE EXCEPTION 'Request conflict'; END IF;
  RETURN jsonb_build_object('id',action.id,'kind',action.kind);
 END IF;
 SELECT * INTO prior FROM public.verifier_role_actions WHERE server_id=p_server AND trigger_role_id=p_trigger FOR UPDATE;
 IF prior.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Role action changed; refresh before saving'; END IF;
 IF p_trigger !~ '^\d{17,22}$' OR (p_remove IS NOT NULL AND
  (normalized IS NULL OR cardinality(normalized)>20 OR p_trigger=ANY(normalized)
   OR EXISTS(SELECT 1 FROM unnest(normalized) id WHERE id IS NULL OR id !~ '^\d{17,22}$')))
 THEN RAISE EXCEPTION 'Invalid role action'; END IF;
 IF p_remove IS NOT NULL THEN
  IF EXISTS(WITH RECURSIVE edges(a,b) AS (
    SELECT trigger_role_id,unnest(remove_role_ids) FROM public.verifier_role_actions WHERE server_id=p_server AND trigger_role_id<>p_trigger
    UNION SELECT p_trigger,unnest(normalized)
   ), reach(a,b) AS (SELECT * FROM edges UNION SELECT r.a,e.b FROM reach r JOIN edges e ON e.a=r.b)
   SELECT 1 FROM reach WHERE a=b) THEN RAISE EXCEPTION 'Role actions cannot form a cycle'; END IF;
  INSERT INTO public.verifier_role_actions(server_id,trigger_role_id,remove_role_ids,updated_by)
  VALUES(p_server,p_trigger,normalized,p_actor) ON CONFLICT(server_id,trigger_role_id)
  DO UPDATE SET remove_role_ids=excluded.remove_role_ids,updated_by=p_actor,updated_at=clock_timestamp() RETURNING * INTO replacement;
 ELSE
  IF prior.trigger_role_id IS NULL THEN RAISE EXCEPTION 'Role action no longer exists'; END IF;
  DELETE FROM public.verifier_role_actions WHERE server_id=p_server AND trigger_role_id=p_trigger;
 END IF;
 INSERT INTO public.verifier_portal_actions(server_id,actor_id,kind,before_rule,after_rule,request_id)
 VALUES(p_server,p_actor,action_kind,CASE WHEN prior.trigger_role_id IS NULL THEN NULL ELSE to_jsonb(prior) END,
  CASE WHEN p_remove IS NULL THEN NULL ELSE to_jsonb(replacement) END,p_request) RETURNING * INTO action;
 IF p_remove IS NOT NULL THEN
  INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,user_id,role_action_role_id)
  SELECT action.id,p_server,user_id,p_trigger FROM public.verifier_user_roles
  WHERE server_id=p_server AND role_id=p_trigger AND status='active' ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,user_id)
 SELECT DISTINCT action.id,p_server,holder.user_id
 FROM public.verifier_user_roles holder
 WHERE holder.server_id=p_server AND holder.role_id=p_trigger
 AND EXISTS(SELECT 1 FROM public.verifier_user_roles affected
  WHERE affected.server_id=p_server AND affected.user_id=holder.user_id
  AND affected.role_id=ANY(coalesce(prior.remove_role_ids,ARRAY[]::text[]) || coalesce(replacement.remove_role_ids,ARRAY[]::text[])));
 GET DIAGNOSTICS total=ROW_COUNT;
 RETURN jsonb_build_object('id',action.id,'kind',action_kind,'jobs',total);
END $$;
REVOKE ALL ON FUNCTION public.verifier_portal_role_action(text,text,text,text[],timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_portal_role_action(text,text,text,text[],timestamptz,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
