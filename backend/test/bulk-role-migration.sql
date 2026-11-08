DO $$
DECLARE j uuid:=gen_random_uuid(); s text:='990000000000000011'; u text:='990000000000000012'; actor text:='990000000000000013'; w uuid:=gen_random_uuid(); req uuid:=gen_random_uuid(); c public.verifier_bulk_role_members; summary jsonb;
BEGIN
 ASSERT (SELECT relrowsecurity FROM pg_class WHERE oid='public.verifier_bulk_role_jobs'::regclass);
 ASSERT NOT has_table_privilege('anon','public.verifier_bulk_role_members','SELECT');
 ASSERT NOT has_function_privilege('authenticated','public.verifier_bulk_role_transition(uuid,text,text,text,uuid)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.verifier_claim_bulk_role_member(uuid)','EXECUTE');
 PERFORM public.verifier_bulk_role_preview(jsonb_build_object('id',j,'server_id',s,'created_by',actor,'audience','verified','mode','grant','rules_version','v1','labels','{}'::jsonb),jsonb_build_array(jsonb_build_object('id',u,'name','Member')));
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_claim_bulk_role_member(w)), 'Preview cannot change roles';
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'start',req);
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'start',req);
 ASSERT (SELECT jsonb_array_length(actions)=1 FROM public.verifier_bulk_role_jobs WHERE id=j), 'Start must be idempotent';
 SELECT * INTO c FROM public.verifier_claim_bulk_role_member(w);
 ASSERT c.job_id=j AND c.user_id=u AND c.attempts=1;
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_claim_bulk_role_member(gen_random_uuid())), 'Only one worker may hold a member';
 PERFORM public.verifier_finish_bulk_role_member(j,u,gen_random_uuid(),'{"granted":["role"]}',false);
 ASSERT (SELECT status='running' FROM public.verifier_bulk_role_members WHERE job_id=j), 'Wrong worker cannot complete';
 PERFORM public.verifier_finish_bulk_role_member(j,u,w,'{"granted":["role"],"unavailable":["other"]}',true);
 ASSERT (SELECT status='pending' FROM public.verifier_bulk_role_members WHERE job_id=j);
 UPDATE public.verifier_bulk_role_members SET available_at=now(),attempts=2 WHERE job_id=j;
 PERFORM public.verifier_claim_bulk_role_member(w);
 PERFORM public.verifier_finish_bulk_role_member(j,u,w,'{"granted":["role"],"unavailable":["other"]}',true);
 ASSERT (SELECT status='failed' FROM public.verifier_bulk_role_jobs WHERE id=j);
 summary:=public.verifier_bulk_role_summary(s,j);
 ASSERT summary->>'granted'='1' AND summary->>'unavailable'='1';
 ASSERT (public.verifier_bulk_role_summary('another-server',j))->>'total'='0', 'Summary must stay in server';
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'retry',gen_random_uuid());
 ASSERT (SELECT status='pending' AND attempts=0 AND result->'granted'='["role"]'::jsonb FROM public.verifier_bulk_role_members WHERE job_id=j), 'Retry must preserve actual grants';
 PERFORM public.verifier_bulk_role_transition(j,s,actor,'cancel',gen_random_uuid());
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_claim_bulk_role_member(w)), 'Cancelled jobs must stop';
 BEGIN
  PERFORM public.verifier_bulk_role_transition(j,'another-server',actor,'start',gen_random_uuid());
  RAISE EXCEPTION 'Cross-server start accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cross-server start accepted' THEN RAISE; END IF; END;
 INSERT INTO public.verifier_privacy_deletions(id,user_id,status) VALUES(gen_random_uuid(),u,'processing');
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE user_id=u), 'Deletion must clear member result associations';
 DELETE FROM public.verifier_bulk_role_jobs WHERE id=j;
 ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=j), 'Cleanup must cascade';
END $$;
