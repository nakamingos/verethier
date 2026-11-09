-- Tests run only in a disposable restore; roll back all fixtures afterwards.
UPDATE public.verifier_bulk_role_jobs SET status='cancelled' WHERE status IN ('pending','running');
UPDATE public.verifier_bulk_role_members SET locked_until=now()-interval '1 second' WHERE status='running';
DO $$
DECLARE j uuid:=gen_random_uuid(); j2 uuid:=gen_random_uuid(); j3 uuid:=gen_random_uuid(); s text:='991111111111111111'; actor text:='992222222222222222';
 u text:='993333333333333330'; w1 uuid:=gen_random_uuid(); w2 uuid:=gen_random_uuid(); w3 uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); c public.verifier_bulk_role_members; old_result jsonb;
BEGIN
 ASSERT NOT has_function_privilege('authenticated','public.verifier_bulk_role_transition(uuid,text,text,text,uuid)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.verifier_claim_bulk_role_member(uuid)','EXECUTE');
 PERFORM public.verifier_bulk_role_preview(jsonb_build_object('id',j,'server_id',s,'created_by',actor,'audience','verified','mode','grant','rules_version','v1','labels','{}'::jsonb),
   jsonb_build_array(jsonb_build_object('id',u,'name','Complete'),jsonb_build_object('id',u||'1','name','Failed'),jsonb_build_object('id',u||'2','name','Interrupted'),jsonb_build_object('id',u||'3','name','Pending')));
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'start',gen_random_uuid());
 SELECT * INTO c FROM public.verifier_claim_bulk_role_member(w1);
 ASSERT c.user_id=u;
 PERFORM public.verifier_finish_bulk_role_member(j,u,w1,'{"granted":["kept"],"ineligible":["other"]}',false);
 SELECT result INTO old_result FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=u;
 SELECT * INTO c FROM public.verifier_claim_bulk_role_member(w2);
 ASSERT c.user_id=u||'1';
 UPDATE public.verifier_bulk_role_members SET attempts=3 WHERE job_id=j AND user_id=c.user_id;
 PERFORM public.verifier_finish_bulk_role_member(j,c.user_id,w2,'{"granted":["partial"],"unavailable":["retry"]}',true);
 SELECT * INTO c FROM public.verifier_claim_bulk_role_member(w3);
 ASSERT c.user_id=u||'2';
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'cancel',gen_random_uuid());
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_claim_bulk_role_member(gen_random_uuid()));
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'resume',req);
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'resume',req);
 ASSERT (SELECT count(*) FROM public.verifier_bulk_role_jobs jb,jsonb_array_elements(jb.actions) a WHERE jb.id=j AND a->>'action'='resume')=1, 'Resume replay is idempotent';
 ASSERT (SELECT result=old_result AND status='completed' AND attempts=1 FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=u), 'Completed members must be untouched';
 ASSERT (SELECT status='failed' AND attempts=3 FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=u||'1'), 'Resume does not repeat terminal failures';
 ASSERT (SELECT locked_by=w3 AND status='running' FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=u||'2'), 'Resume keeps an in-flight lease';
 PERFORM public.verifier_finish_bulk_role_member(j,u||'2',w3,'{"granted":["partial-before-cancel"],"interrupted":true}',false);
 ASSERT (SELECT status='pending' AND attempts=0 AND result->'granted'='["partial-before-cancel"]'::jsonb FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=u||'2'), 'Interruption preserves checkpoint and does not consume a retry';
 SELECT * INTO c FROM public.verifier_claim_bulk_role_member(w1);
 ASSERT c.user_id=u||'2' AND c.attempts=1;
 PERFORM public.verifier_finish_bulk_role_member(j,c.user_id,w3,'{"granted":["stale-worker"]}',false);
 ASSERT (SELECT status='running' AND locked_by=w1 AND result->'granted'='["partial-before-cancel"]'::jsonb FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=c.user_id), 'Old worker cannot overwrite resumed results';
 PERFORM public.verifier_finish_bulk_role_member(j,c.user_id,w1,'{"granted":["partial-before-cancel","new"]}',false);
 SELECT * INTO c FROM public.verifier_claim_bulk_role_member(w3);
 ASSERT c.user_id=u||'3';
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'retry',gen_random_uuid());
 ASSERT (SELECT actions->-1->>'new_run'='false' FROM public.verifier_bulk_role_jobs WHERE id=j), 'Retry while running does not invalidate healthy workers';
 ASSERT (SELECT status='pending' AND attempts=0 AND result->'granted'='["partial"]'::jsonb FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=u||'1'), 'Retry requeues only failures and preserves partial grants';
 ASSERT (SELECT status='running' AND locked_by=w3 FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=u||'3'), 'Retry cannot reset another live lease';
 ASSERT (SELECT status='completed' AND result=old_result FROM public.verifier_bulk_role_members WHERE job_id=j AND user_id=u);
 -- Another job cannot concurrently operate on the same server/member.
 PERFORM public.verifier_bulk_role_preview(jsonb_build_object('id',j2,'server_id',s,'created_by',actor,'audience','verified','mode','grant','rules_version','v1','labels','{}'::jsonb),jsonb_build_array(jsonb_build_object('id',u||'3','name','Same member')));
 PERFORM public.verifier_bulk_role_transition(j2,s,actor,'start',gen_random_uuid());
 SELECT * INTO c FROM public.verifier_claim_bulk_role_member(w2);
 ASSERT c.job_id=j AND c.user_id=u||'1';
 PERFORM public.verifier_finish_bulk_role_member(j,c.user_id,w2,'{"granted":["partial","retried"]}',false);
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_claim_bulk_role_member(gen_random_uuid())), 'Other job waits for the active member';
 PERFORM public.verifier_finish_bulk_role_member(j,u||'3',w3,'{}',false);
 ASSERT (SELECT status='completed' FROM public.verifier_bulk_role_jobs WHERE id=j);
 SELECT * INTO c FROM public.verifier_claim_bulk_role_member(w2);
 ASSERT c.job_id=j2 AND c.user_id=u||'3';
 PERFORM public.verifier_finish_bulk_role_member(j2,c.user_id,w2,'{}',false);
 -- Cancelling a never-started preview cannot bypass its start/expiry checks.
 PERFORM public.verifier_bulk_role_preview(jsonb_build_object('id',j3,'server_id',s,'created_by',actor,'audience','verified','mode','grant','rules_version','v1','labels','{}'::jsonb),jsonb_build_array(jsonb_build_object('id',u,'name','Preview')));
 PERFORM public.verifier_bulk_role_transition(j3,s,actor,'cancel',gen_random_uuid());
 BEGIN
  PERFORM public.verifier_bulk_role_transition(j3,s,actor,'resume',gen_random_uuid());
  RAISE EXCEPTION 'Unstarted preview resumed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Unstarted preview resumed' THEN RAISE; END IF; END;
 -- Wrong server and expired jobs cannot be resumed.
 BEGIN
  PERFORM public.verifier_bulk_role_transition(j,'other-server',actor,'resume',gen_random_uuid());
  RAISE EXCEPTION 'Cross-server resume accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cross-server resume accepted' THEN RAISE; END IF; END;
 UPDATE public.verifier_bulk_role_jobs SET status='cancelled',expires_at=now()-interval '1 second' WHERE id=j;
 BEGIN
  PERFORM public.verifier_bulk_role_transition(j,s,actor,'resume',gen_random_uuid());
  RAISE EXCEPTION 'Expired resume accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Expired resume accepted' THEN RAISE; END IF; END;
END $$;
