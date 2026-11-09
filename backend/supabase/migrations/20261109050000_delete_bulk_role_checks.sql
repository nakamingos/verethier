BEGIN;
CREATE FUNCTION public.verifier_delete_bulk_role_check(p_server text,p_job uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.verifier_bulk_role_jobs;
BEGIN
 -- Same job-first lock as claim, transition and finish: a concurrent resume
 -- either completes first and prevents deletion, or sees a missing report.
 SELECT * INTO j FROM public.verifier_bulk_role_jobs WHERE id=p_job AND server_id=p_server FOR UPDATE;
 IF NOT FOUND THEN RETURN; END IF;
 -- Freeze lease renewal while checking cancelled/stale reports.
 PERFORM 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job AND status='running' FOR UPDATE;
 IF j.status IN ('pending','running') OR EXISTS(SELECT 1 FROM public.verifier_bulk_role_members
  WHERE job_id=p_job AND status='running' AND locked_until>now()) THEN
  RAISE EXCEPTION 'Bulk check still has active work' USING ERRCODE='55000';
 END IF;
 -- Only member report rows cascade. Earned-role tracking and Discord roles
 -- are independent and are never changed by deleting a report.
 DELETE FROM public.verifier_bulk_role_jobs WHERE id=p_job AND server_id=p_server;
END $$;
REVOKE ALL ON FUNCTION public.verifier_delete_bulk_role_check(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_delete_bulk_role_check(text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
