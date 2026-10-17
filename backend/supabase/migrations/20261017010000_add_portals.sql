BEGIN;
CREATE TABLE public.verifier_oauth_states (
 state_hash text PRIMARY KEY, return_to text NOT NULL CHECK(return_to IN ('/admin','/member')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.verifier_web_sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL, profile jsonb NOT NULL, guilds jsonb NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.verifier_oauth_states(expires_at);
CREATE INDEX ON public.verifier_web_sessions(expires_at);
CREATE TABLE public.verifier_server_settings (
 server_id text PRIMARY KEY, verification_channel_id text,
 background_checks_enabled boolean NOT NULL DEFAULT true,
 updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.verifier_portal_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), server_id text NOT NULL, actor_id text NOT NULL,
 kind text NOT NULL, before_rule jsonb, after_rule jsonb,
 reverts uuid UNIQUE REFERENCES public.verifier_portal_actions(id),
 request_id uuid NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.verifier_portal_actions(server_id,created_at DESC);
CREATE TABLE public.verifier_reconciliation_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action_id uuid REFERENCES public.verifier_portal_actions(id),
 server_id text NOT NULL, role_id text, user_id text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, locked_by uuid, locked_until timestamptz,
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK((role_id IS NULL) <> (user_id IS NULL))
);
CREATE INDEX ON public.verifier_reconciliation_jobs(status,created_at);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['verifier_oauth_states','verifier_web_sessions','verifier_server_settings','verifier_portal_actions','verifier_reconciliation_jobs'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',tab);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
 END LOOP;
END $$;

-- Exact JSON equality for every editable/identity field (array containment is unsafe).
CREATE FUNCTION public.verifier_portal_definition(r jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT jsonb_object_agg(k, coalesce(r->k,'null'::jsonb)) FROM unnest(ARRAY[
 'server_id','channel_id','role_id','asset_type','chain_id','contract_address','slug','attribute_key',
 'attribute_value','min_items','token_standard','token_ids','collection_name','inscription_criteria',
 'rule_label','min_balance','token_decimals','token_symbol']) k;
$$;

-- Slash commands, including their Undo/Redo paths, queue the same durable checks.
CREATE FUNCTION public.verifier_queue_rule_reconciliation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_setting('bouncer.portal_mutation',true)='true' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND public.verifier_portal_definition(to_jsonb(OLD))=public.verifier_portal_definition(to_jsonb(NEW)) THEN RETURN NULL; END IF;
 IF TG_OP='DELETE' THEN
  INSERT INTO public.verifier_reconciliation_jobs(server_id,role_id) VALUES(OLD.server_id,OLD.role_id);
 ELSE
  INSERT INTO public.verifier_reconciliation_jobs(server_id,role_id) VALUES(NEW.server_id,NEW.role_id);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.verifier_queue_rule_reconciliation() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER verifier_rule_reconciliation AFTER INSERT OR DELETE OR UPDATE ON public.verifier_rules
 FOR EACH ROW EXECUTE FUNCTION public.verifier_queue_rule_reconciliation();

CREATE FUNCTION public.verifier_portal_mutate_rule(p_server text,p_actor text,p_request uuid,
 p_before jsonb,p_after jsonb,p_reverts uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE current_rule public.verifier_rules; replacement public.verifier_rules;
 action public.verifier_portal_actions; original public.verifier_portal_actions; rid bigint;
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
    OR replacement.role_id IS DISTINCT FROM current_rule.role_id OR replacement.asset_type IS DISTINCT FROM current_rule.asset_type
    OR replacement.chain_id IS DISTINCT FROM current_rule.chain_id OR replacement.contract_address IS DISTINCT FROM current_rule.contract_address
    THEN RAISE EXCEPTION 'Rule identity cannot change'; END IF;
   UPDATE public.verifier_rules SET slug=replacement.slug,attribute_key=replacement.attribute_key,attribute_value=replacement.attribute_value,
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
 INSERT INTO public.verifier_reconciliation_jobs(action_id,server_id,role_id)
 VALUES(action.id,p_server,coalesce(replacement.role_id,current_rule.role_id));
 RETURN to_jsonb(action);
END;
$$;

CREATE FUNCTION public.verifier_portal_claim_job(p_worker uuid) RETURNS SETOF public.verifier_reconciliation_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE job public.verifier_reconciliation_jobs;
BEGIN
 -- Serialize claiming; only one live job per server may change roles at once.
 PERFORM pg_advisory_xact_lock(hashtextextended('portal-jobs',0));
 UPDATE public.verifier_reconciliation_jobs SET status='failed',locked_by=NULL,locked_until=NULL,
  result='{"error":"Job interrupted. Request a fresh member check."}'::jsonb,updated_at=now()
  WHERE status='running' AND locked_until<now() AND attempts>=3;
 SELECT j.* INTO job FROM public.verifier_reconciliation_jobs j
 WHERE ((j.status='pending' AND (j.attempts=0 OR j.updated_at<now()-interval '5 minutes')) OR (j.status='running' AND j.locked_until<now())) AND j.attempts<3
 AND NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs live
  WHERE live.server_id=j.server_id AND live.status='running' AND live.locked_until>=now())
 ORDER BY j.created_at FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 RETURN QUERY UPDATE public.verifier_reconciliation_jobs SET status='running',attempts=attempts+1,
  locked_by=p_worker,locked_until=now()+interval '15 minutes',updated_at=now() WHERE id=job.id RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.verifier_portal_definition(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verifier_portal_mutate_rule(text,text,uuid,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verifier_portal_claim_job(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_portal_definition(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.verifier_portal_mutate_rule(text,text,uuid,jsonb,jsonb,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.verifier_portal_claim_job(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
