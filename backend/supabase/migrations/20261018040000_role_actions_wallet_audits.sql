BEGIN;
CREATE TABLE public.verifier_role_actions (
 server_id text NOT NULL, trigger_role_id text NOT NULL, remove_role_ids text[] NOT NULL,
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(server_id,trigger_role_id),
 CHECK(cardinality(remove_role_ids) BETWEEN 1 AND 20),
 CHECK(NOT trigger_role_id=ANY(remove_role_ids))
);
ALTER TABLE public.verifier_role_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_role_actions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.verifier_role_actions TO service_role;
ALTER TABLE public.verifier_reconciliation_jobs ADD COLUMN role_action_role_id text;
ALTER TABLE public.verifier_reconciliation_jobs ADD CONSTRAINT verifier_role_action_job_scope
 CHECK(role_action_role_id IS NULL OR (user_id IS NOT NULL AND rule_id IS NULL));
-- Configuration changes have their own receipt, so an older pending/running
-- grant job cannot absorb a new administrator action. Repeated grant checks
-- (NULL receipt) still share one live job.
CREATE UNIQUE INDEX verifier_role_action_pending ON public.verifier_reconciliation_jobs(server_id,user_id,role_action_role_id,action_id) NULLS NOT DISTINCT
 WHERE role_action_role_id IS NOT NULL AND status IN ('pending','running');

-- Tracking a Bouncer grant/restoration also durably queues its role action.
CREATE FUNCTION public.verifier_queue_role_action() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='active' AND EXISTS(SELECT 1 FROM public.verifier_role_actions
  WHERE server_id=NEW.server_id AND trigger_role_id=NEW.role_id) THEN
  INSERT INTO public.verifier_reconciliation_jobs(server_id,user_id,role_action_role_id)
  VALUES(NEW.server_id,NEW.user_id,NEW.role_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER verifier_role_action_grant AFTER INSERT OR UPDATE ON public.verifier_user_roles
 FOR EACH ROW EXECUTE FUNCTION public.verifier_queue_role_action();

CREATE FUNCTION public.verifier_portal_role_action(p_server text,p_actor text,p_trigger text,
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
 SELECT action.id,p_server,user_id FROM public.verifier_user_roles WHERE server_id=p_server AND role_id=p_trigger;
 GET DIAGNOSTICS total=ROW_COUNT;
 RETURN jsonb_build_object('id',action.id,'kind',action_kind,'jobs',total);
END $$;

CREATE INDEX verifier_member_actions_address_user ON public.verifier_member_actions(address,user_id);
CREATE INDEX verifier_member_actions_server_user ON public.verifier_member_actions(server_id,user_id) WHERE server_id IS NOT NULL;
-- The backend supplies a fresh, complete Discord member list after live admin
-- authorization. Former members are included only with retained server evidence.
CREATE FUNCTION public.verifier_portal_wallet_audit(p_server text,p_users text[],p_member text,
 p_after text,p_limit integer DEFAULT 20,p_address text DEFAULT NULL,p_account_after text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH eligible AS (
  SELECT unnest(p_users) AS user_id
  UNION SELECT user_id FROM public.verifier_user_roles WHERE server_id=p_server
  UNION SELECT user_id FROM public.verifier_member_actions WHERE server_id=p_server
 ), associations AS (
  SELECT w.user_id,w.address,w.wallet_type,w.created_at AS seen_at,w.last_verified_at AS proven_at,true AS current
   FROM public.user_wallets w JOIN eligible e USING(user_id)
  UNION ALL
  SELECT a.user_id,a.address,a.wallet_type,a.created_at,a.last_proven_at,false
   FROM public.verifier_member_actions a JOIN eligible e USING(user_id)
 ), summaries AS (
  SELECT address,user_id,max(wallet_type) AS wallet_type,min(seen_at) AS first_seen,max(seen_at) AS last_seen,
   max(proven_at) AS last_proven,bool_or(current) AS current FROM associations GROUP BY address,user_id
 ), shared AS (
  SELECT address,count(*) AS accounts FROM summaries WHERE p_address IS NULL OR address=p_address GROUP BY address HAVING count(*)>1
   AND (p_member IS NULL OR bool_or(user_id=p_member))
 ), page AS (
  SELECT * FROM shared WHERE p_after IS NULL OR address>p_after ORDER BY address LIMIT least(greatest(p_limit,1),50)
 ), details AS (
  SELECT p.*,coalesce((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('name',(
   SELECT user_name FROM public.verifier_user_roles WHERE server_id=p_server AND user_id=s.user_id ORDER BY updated_at DESC LIMIT 1
  )) ORDER BY s.user_id) FROM (SELECT * FROM summaries WHERE address=p.address
   AND (p_account_after IS NULL OR user_id>p_account_after) ORDER BY user_id LIMIT 25) s),'[]'::jsonb) AS account_data,
  (SELECT count(*) FROM summaries WHERE address=p.address AND (p_account_after IS NULL OR user_id>p_account_after)) AS remaining
  FROM page p
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM shared),'items',coalesce((
  SELECT jsonb_agg(jsonb_build_object('address',p.address,'account_count',p.accounts,
   'accounts',p.account_data,'account_next',CASE WHEN p.remaining>25 THEN p.account_data->24->>'user_id' ELSE NULL END
  ) ORDER BY p.address) FROM details p),'[]'::jsonb),
  'next',CASE WHEN EXISTS(SELECT 1 FROM shared WHERE address>(SELECT max(address) FROM page)) THEN (SELECT max(address) FROM page) ELSE NULL END,
  'history_since',(SELECT min(created_at) FROM public.verifier_member_actions));
$$;
REVOKE ALL ON FUNCTION public.verifier_queue_role_action() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verifier_portal_role_action(text,text,text,text[],timestamptz,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verifier_portal_wallet_audit(text,text[],text,text,integer,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_portal_role_action(text,text,text,text[],timestamptz,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.verifier_portal_wallet_audit(text,text[],text,text,integer,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
