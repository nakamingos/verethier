DO $$
DECLARE j uuid; state text; s text:='bulk-delete-test'; u text:='delete-member'; actor text:='delete-admin'; w uuid:=gen_random_uuid(); a jsonb; rid bigint;
BEGIN
 ASSERT NOT has_function_privilege('anon','public.verifier_delete_bulk_role_check(text,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.verifier_delete_bulk_role_check(text,uuid)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.verifier_delete_bulk_role_check(text,uuid)','EXECUTE');
 a:=public.verifier_portal_mutate_rule(s,actor,gen_random_uuid(),NULL,jsonb_build_object('server_id',s,'server_name','Test server','channel_name','verify','channel_id','verify','role_id','977777777777777777','role_name','Kept',
  'asset_type','ordinal','slug',NULL,'chain_id',NULL,'min_items',1,'inscription_criteria','{"kind":"numbers","ranges":[[1,2]]}'::jsonb));
 rid:=(a->'after_rule'->>'id')::bigint;
 INSERT INTO public.verifier_user_roles(user_id,server_id,role_id,rule_id,status) VALUES(u,s,'977777777777777777',rid,'active');
 FOREACH state IN ARRAY ARRAY['preview','completed','failed','stale','cancelled'] LOOP
  j:=gen_random_uuid();
  PERFORM public.verifier_bulk_role_preview(jsonb_build_object('id',j,'server_id',s,'created_by',actor,'audience','verified','mode','grant','rules_version','v1','labels','{}'::jsonb),jsonb_build_array(jsonb_build_object('id',u,'name','Member')));
  UPDATE public.verifier_bulk_role_jobs SET status=state WHERE id=j;
  PERFORM public.verifier_delete_bulk_role_check('different-server',j);
  ASSERT EXISTS(SELECT 1 FROM public.verifier_bulk_role_jobs WHERE id=j),'Cross-server deletion';
  PERFORM public.verifier_delete_bulk_role_check(s,j);
  PERFORM public.verifier_delete_bulk_role_check(s,j); -- Retrying a lost response is harmless.
  ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_jobs WHERE id=j),'Report retained';
  ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_members WHERE job_id=j),'Member results retained';
  ASSERT EXISTS(SELECT 1 FROM public.verifier_user_roles WHERE user_id=u AND server_id=s AND status='active'),'Earned role history changed';
 END LOOP;
 FOREACH state IN ARRAY ARRAY['pending','running'] LOOP
  j:=gen_random_uuid();
  PERFORM public.verifier_bulk_role_preview(jsonb_build_object('id',j,'server_id',s,'created_by',actor,'audience','verified','mode','grant','rules_version','v1','labels','{}'::jsonb),jsonb_build_array(jsonb_build_object('id',u,'name','Member')));
  UPDATE public.verifier_bulk_role_jobs SET status=state WHERE id=j;
  BEGIN
   PERFORM public.verifier_delete_bulk_role_check(s,j);
   RAISE EXCEPTION 'Active report deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  -- Cancellation does not make a still-active member safe to delete.
  UPDATE public.verifier_bulk_role_jobs SET status='cancelled' WHERE id=j;
  UPDATE public.verifier_bulk_role_members SET status='running',locked_by=w,locked_until=now()+interval '15 minutes' WHERE job_id=j;
  BEGIN
   PERFORM public.verifier_delete_bulk_role_check(s,j);
   RAISE EXCEPTION 'Active lease deleted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
  PERFORM public.verifier_finish_bulk_role_member(j,u,w,'{"granted":["kept"]}',false);
  PERFORM public.verifier_delete_bulk_role_check(s,j);
  ASSERT NOT EXISTS(SELECT 1 FROM public.verifier_bulk_role_jobs WHERE id=j),'Finished cancellation could not be deleted';
 END LOOP;
END $$;
