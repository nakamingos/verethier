BEGIN;
CREATE TABLE public.verifier_bulk_role_jobs (
 id uuid PRIMARY KEY, server_id text NOT NULL, created_by text NOT NULL, started_by text,
 audience text NOT NULL CHECK(audience IN ('verified','role')), source_role_id text,
 rule_id bigint, mode text NOT NULL CHECK(mode IN ('grant','reconcile')),
 rules_version text NOT NULL, labels jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','pending','running','completed','failed','stale','cancelled')),
 message text, actions jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 preview_expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 days',
 CHECK((audience='role')=(source_role_id IS NOT NULL))
);
CREATE INDEX verifier_bulk_role_server ON public.verifier_bulk_role_jobs(server_id,created_at DESC);
CREATE TABLE public.verifier_bulk_role_members (
 job_id uuid NOT NULL REFERENCES public.verifier_bulk_role_jobs ON DELETE CASCADE,
 user_id text NOT NULL, member_name text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, result jsonb NOT NULL DEFAULT '{}',
 available_at timestamptz NOT NULL DEFAULT now(), locked_by uuid, locked_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(job_id,user_id)
);
CREATE INDEX verifier_bulk_role_claim ON public.verifier_bulk_role_members(available_at,job_id,user_id);
ALTER TABLE public.verifier_bulk_role_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifier_bulk_role_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_bulk_role_jobs,public.verifier_bulk_role_members FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.verifier_bulk_role_jobs,public.verifier_bulk_role_members TO service_role;
CREATE FUNCTION public.verifier_bulk_role_preview(p_job jsonb,p_members jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.verifier_bulk_role_jobs; v_id uuid:=(p_job->>'id')::uuid;
BEGIN
 IF jsonb_typeof(p_members)<>'array' OR jsonb_array_length(p_members)>10000 THEN RAISE EXCEPTION 'Invalid audience'; END IF;
 SELECT * INTO j FROM public.verifier_bulk_role_jobs WHERE verifier_bulk_role_jobs.id=v_id;
 IF FOUND THEN
  IF j.server_id<>p_job->>'server_id' OR j.created_by<>p_job->>'created_by' OR j.audience<>p_job->>'audience' OR j.source_role_id IS DISTINCT FROM p_job->>'source_role_id' OR j.rule_id IS DISTINCT FROM (p_job->>'rule_id')::bigint OR j.mode<>p_job->>'mode' THEN RAISE EXCEPTION 'Request conflict'; END IF;
  RETURN v_id;
 END IF;
 INSERT INTO public.verifier_bulk_role_jobs(id,server_id,created_by,audience,source_role_id,rule_id,mode,rules_version,labels)
 VALUES(v_id,p_job->>'server_id',p_job->>'created_by',p_job->>'audience',p_job->>'source_role_id',(p_job->>'rule_id')::bigint,p_job->>'mode',p_job->>'rules_version',p_job->'labels');
 INSERT INTO public.verifier_bulk_role_members(job_id,user_id,member_name)
 SELECT v_id,m->>'id',left(m->>'name',100) FROM jsonb_array_elements(p_members) m
 WHERE NOT EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE user_id=m->>'id' AND status='processing');
 RETURN v_id;
END $$;
CREATE FUNCTION public.verifier_bulk_role_transition(p_job uuid,p_server text,p_actor text,p_action text,p_request uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.verifier_bulk_role_jobs;
BEGIN
 SELECT * INTO j FROM public.verifier_bulk_role_jobs WHERE id=p_job AND server_id=p_server FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Check not found'; END IF;
 IF j.actions @> jsonb_build_array(jsonb_build_object('request',p_request)) THEN RETURN; END IF;
 IF p_action='start' AND j.status='preview' AND j.preview_expires_at>now() THEN
  UPDATE public.verifier_bulk_role_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job) THEN 'pending' ELSE 'completed' END,started_by=p_actor WHERE id=p_job;
 ELSIF p_action='retry' AND j.status='failed' THEN
  UPDATE public.verifier_bulk_role_members SET status='pending',attempts=0,available_at=now(),locked_by=NULL,locked_until=NULL WHERE job_id=p_job AND status='failed';
  UPDATE public.verifier_bulk_role_jobs SET status='pending',started_by=p_actor,message=NULL WHERE id=p_job;
 ELSIF p_action='cancel' AND j.status IN ('preview','pending','running','failed') THEN
  UPDATE public.verifier_bulk_role_jobs SET status='cancelled' WHERE id=p_job;
 ELSE RAISE EXCEPTION 'Check changed or preview expired'; END IF;
 UPDATE public.verifier_bulk_role_jobs SET updated_at=now(),actions=actions||jsonb_build_array(jsonb_build_object('actor',p_actor,'action',p_action,'request',p_request,'at',now())) WHERE id=p_job;
END $$;
CREATE FUNCTION public.verifier_claim_bulk_role_member(p_worker uuid) RETURNS SETOF public.verifier_bulk_role_members
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE chosen public.verifier_bulk_role_members;
BEGIN
 SELECT m.* INTO chosen FROM public.verifier_bulk_role_members m JOIN public.verifier_bulk_role_jobs j ON j.id=m.job_id
 WHERE j.status IN ('pending','running') AND j.expires_at>now() AND m.status IN ('pending','running') AND m.available_at<=now() AND (m.locked_until IS NULL OR m.locked_until<now())
 ORDER BY j.created_at,m.user_id FOR UPDATE OF m SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN; END IF;
 UPDATE public.verifier_bulk_role_jobs SET status='running',updated_at=now() WHERE id=chosen.job_id AND status='pending';
 RETURN QUERY UPDATE public.verifier_bulk_role_members SET status='running',attempts=attempts+1,locked_by=p_worker,locked_until=now()+interval '15 minutes' WHERE job_id=chosen.job_id AND user_id=chosen.user_id RETURNING *;
END $$;
CREATE FUNCTION public.verifier_finish_bulk_role_member(p_job uuid,p_user text,p_worker uuid,p_result jsonb,p_retry boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.verifier_bulk_role_members SET result=p_result,status=CASE WHEN p_retry THEN CASE WHEN attempts<3 THEN 'pending' ELSE 'failed' END ELSE 'completed' END,
  available_at=now()+interval '1 minute',locked_by=NULL,locked_until=NULL,updated_at=now()
 WHERE job_id=p_job AND user_id=p_user AND locked_by=p_worker AND status='running';
 IF NOT FOUND THEN RETURN; END IF;
 -- Serialize completion so two workers cannot leave an exhausted job running.
 PERFORM 1 FROM public.verifier_bulk_role_jobs WHERE id=p_job FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job AND status IN ('pending','running')) THEN
  UPDATE public.verifier_bulk_role_jobs SET status=CASE WHEN EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job AND status='failed') THEN 'failed' ELSE 'completed' END,updated_at=now()
  WHERE id=p_job AND status IN ('pending','running');
 END IF;
END $$;
CREATE FUNCTION public.verifier_bulk_role_summary(p_server text,p_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT jsonb_build_object('total',count(*),'processed',count(*) FILTER(WHERE status IN ('completed','failed')),
  'granted',coalesce(sum(jsonb_array_length(coalesce(result->'granted','[]'))),0),
  'removed',coalesce(sum(jsonb_array_length(coalesce(result->'removed','[]'))),0),
  'already_held',coalesce(sum(jsonb_array_length(coalesce(result->'already_held','[]'))),0),
  'ineligible',count(*) FILTER(WHERE jsonb_array_length(coalesce(result->'ineligible','[]'))>0),
  'no_wallet',count(*) FILTER(WHERE result->>'skip'='no_wallet'),
  'unavailable',count(*) FILTER(WHERE jsonb_array_length(coalesce(result->'unavailable','[]'))>0),
  'excluded',count(*) FILTER(WHERE jsonb_array_length(coalesce(result->'excluded','[]'))>0),
  'left_audience',count(*) FILTER(WHERE result->>'skip'='left_audience'),
  'errors',count(*) FILTER(WHERE status='failed'))
 FROM public.verifier_bulk_role_members m WHERE job_id=p_job AND EXISTS(SELECT 1 FROM public.verifier_bulk_role_jobs WHERE id=p_job AND server_id=p_server);
$$;
CREATE FUNCTION public.verifier_bulk_role_delete_member() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='processing' THEN
  DELETE FROM public.verifier_bulk_role_members WHERE user_id=NEW.user_id;
  UPDATE public.verifier_bulk_role_jobs j SET status=CASE WHEN EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=j.id AND status='failed') THEN 'failed' ELSE 'completed' END,updated_at=now()
  WHERE status IN ('pending','running') AND NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=j.id AND status IN ('pending','running'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_bulk_role_delete_member AFTER INSERT OR UPDATE ON public.verifier_privacy_deletions FOR EACH ROW EXECUTE FUNCTION public.verifier_bulk_role_delete_member();
REVOKE ALL ON FUNCTION public.verifier_bulk_role_preview(jsonb,jsonb),public.verifier_bulk_role_transition(uuid,text,text,text,uuid),public.verifier_claim_bulk_role_member(uuid),public.verifier_finish_bulk_role_member(uuid,text,uuid,jsonb,boolean),public.verifier_bulk_role_summary(text,uuid),public.verifier_bulk_role_delete_member() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_bulk_role_preview(jsonb,jsonb),public.verifier_bulk_role_transition(uuid,text,text,text,uuid),public.verifier_claim_bulk_role_member(uuid),public.verifier_finish_bulk_role_member(uuid,text,uuid,jsonb,boolean),public.verifier_bulk_role_summary(text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
