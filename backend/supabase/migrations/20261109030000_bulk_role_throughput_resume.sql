BEGIN;
-- New transitions preserve completed members and historical role mutations.
CREATE OR REPLACE FUNCTION public.verifier_bulk_role_transition(p_job uuid,p_server text,p_actor text,p_action text,p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.verifier_bulk_role_jobs; new_run boolean := true;
BEGIN
 SELECT * INTO j FROM public.verifier_bulk_role_jobs WHERE id=p_job AND server_id=p_server FOR UPDATE;
 IF NOT FOUND OR j.expires_at<=now() THEN RAISE EXCEPTION 'Check not found or expired'; END IF;
 IF j.actions @> jsonb_build_array(jsonb_build_object('request',p_request)) THEN RETURN; END IF;
 IF p_action='start' AND j.status='preview' AND j.preview_expires_at>now() THEN
  UPDATE public.verifier_bulk_role_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job) THEN 'pending' ELSE 'completed' END,started_by=p_actor WHERE id=p_job;
 ELSIF p_action='resume' AND j.started_by IS NOT NULL AND j.status IN ('cancelled','failed')
   AND EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job AND status IN ('pending','running')) THEN
  -- Active leases are not revoked: an in-flight Discord request must finish
  -- checkpointing before the same member can be claimed again.
  UPDATE public.verifier_bulk_role_jobs SET status='pending',started_by=p_actor,message=NULL WHERE id=p_job;
 ELSIF p_action='retry' AND j.status IN ('failed','cancelled','pending','running')
   AND EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job AND status='failed') THEN
  new_run := j.status NOT IN ('pending','running');
  UPDATE public.verifier_bulk_role_members SET status='pending',attempts=0,available_at=now(),locked_by=NULL,locked_until=NULL
   WHERE job_id=p_job AND status='failed';
  UPDATE public.verifier_bulk_role_jobs SET status=CASE WHEN j.status='running' THEN 'running' ELSE 'pending' END,started_by=p_actor,message=NULL WHERE id=p_job;
 ELSIF p_action='cancel' AND j.status IN ('preview','pending','running','failed') THEN
  UPDATE public.verifier_bulk_role_jobs SET status='cancelled' WHERE id=p_job;
 ELSE RAISE EXCEPTION 'Check changed or has no matching remaining work'; END IF;
 UPDATE public.verifier_bulk_role_jobs SET updated_at=now(),actions=actions||jsonb_build_array(jsonb_build_object('actor',p_actor,'action',p_action,'request',p_request,'at',now(),'new_run',new_run)) WHERE id=p_job;
END $$;

CREATE OR REPLACE FUNCTION public.verifier_claim_bulk_role_member(p_worker uuid) RETURNS SETOF public.verifier_bulk_role_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE chosen public.verifier_bulk_role_members;
BEGIN
 -- Serialize only short claims, never provider reads or Discord requests. This
 -- prevents two jobs from claiming the same server/member concurrently.
 PERFORM pg_advisory_xact_lock(591228933::bigint);
 SELECT m.* INTO chosen FROM public.verifier_bulk_role_members m JOIN public.verifier_bulk_role_jobs j ON j.id=m.job_id
 WHERE j.status IN ('pending','running') AND j.expires_at>now() AND m.status IN ('pending','running') AND m.available_at<=now()
   AND (m.locked_until IS NULL OR m.locked_until<now())
   AND NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_members other JOIN public.verifier_bulk_role_jobs other_job ON other_job.id=other.job_id
     WHERE other.user_id=m.user_id AND other_job.server_id=j.server_id AND other.status='running' AND other.locked_until>now())
 ORDER BY j.created_at,m.user_id LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 -- Use the same job-then-member lock order as transitions and completion.
 PERFORM 1 FROM public.verifier_bulk_role_jobs WHERE id=chosen.job_id FOR UPDATE;
 SELECT m.* INTO chosen FROM public.verifier_bulk_role_members m JOIN public.verifier_bulk_role_jobs j ON j.id=m.job_id
 WHERE m.job_id=chosen.job_id AND m.user_id=chosen.user_id AND j.status IN ('pending','running') AND j.expires_at>now()
   AND m.status IN ('pending','running') AND m.available_at<=now() AND (m.locked_until IS NULL OR m.locked_until<now())
 FOR UPDATE OF m SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.verifier_bulk_role_jobs SET status='running',updated_at=now() WHERE id=chosen.job_id AND status='pending';
 RETURN QUERY UPDATE public.verifier_bulk_role_members SET status='running',attempts=attempts+1,locked_by=p_worker,locked_until=now()+interval '15 minutes'
  WHERE job_id=chosen.job_id AND user_id=chosen.user_id RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.verifier_finish_bulk_role_member(p_job uuid,p_user text,p_worker uuid,p_result jsonb,p_retry boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE interrupted boolean := coalesce((p_result->>'interrupted')='true',false);
BEGIN
 PERFORM 1 FROM public.verifier_bulk_role_jobs WHERE id=p_job FOR UPDATE;
 UPDATE public.verifier_bulk_role_members SET result=p_result,
  status=CASE WHEN interrupted THEN 'pending' WHEN p_retry THEN CASE WHEN attempts<3 THEN 'pending' ELSE 'failed' END ELSE 'completed' END,
  attempts=CASE WHEN interrupted THEN greatest(attempts-1,0) ELSE attempts END,
  available_at=CASE WHEN interrupted THEN now() ELSE now()+interval '1 minute' END,
  locked_by=NULL,locked_until=NULL,updated_at=now()
 WHERE job_id=p_job AND user_id=p_user AND locked_by=p_worker AND status='running';
 IF NOT FOUND THEN RETURN; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job AND status IN ('pending','running')) THEN
  UPDATE public.verifier_bulk_role_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job AND status='failed') THEN 'failed' ELSE 'completed' END,updated_at=now()
  WHERE id=p_job AND status IN ('pending','running');
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS verifier_bulk_role_active_member ON public.verifier_bulk_role_members(user_id,locked_until) WHERE status='running';
NOTIFY pgrst,'reload schema';
COMMIT;
