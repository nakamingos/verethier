DO $$
DECLARE s text:='111111111111111111'; actor text:='222222222222222222';
 trigger_id text:='333333333333333333'; a text:='444444444444444444'; b text:='555555555555555555';
 request uuid:=gen_random_uuid(); receipt uuid; stamp timestamptz; prior_jobs integer;
BEGIN
 INSERT INTO public.verifier_user_roles(server_id,user_id,role_id,status) VALUES
 (s,'affected',trigger_id,'active'),(s,'affected',a,'revoked'),
 (s,'unrelated',trigger_id,'active'),(s,'unrelated','666666666666666666','active'),
 (s,'former-holder',trigger_id,'revoked'),(s,'former-holder',a,'revoked'),
 (s,'new-target',trigger_id,'active'),(s,'new-target',b,'revoked'),
 (s,'target-only',a,'active'),
 ('777777777777777777','outsider',trigger_id,'active'),('777777777777777777','outsider',a,'revoked');
 receipt:=(public.verifier_portal_role_action(s,actor,trigger_id,ARRAY[a],NULL,request)->>'id')::uuid;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=receipt AND role_action_role_id IS NULL)<>2
 THEN RAISE EXCEPTION 'Ownership rechecks were not restricted to affected earned history'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE action_id=receipt AND user_id='former-holder' AND role_action_role_id IS NULL)
 THEN RAISE EXCEPTION 'Revoked target history was lost'; END IF;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=receipt AND role_action_role_id=trigger_id)<>3
 THEN RAISE EXCEPTION 'Immediate Discord enforcement changed'; END IF;
 IF EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE user_id IN ('outsider','target-only'))
 THEN RAISE EXCEPTION 'Role action broadened audience or leaked across servers'; END IF;
 SELECT count(*) INTO prior_jobs FROM public.verifier_reconciliation_jobs;
 PERFORM public.verifier_portal_role_action(s,actor,trigger_id,ARRAY[a],NULL,request);
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs)<>prior_jobs THEN RAISE EXCEPTION 'Receipt replay duplicated jobs'; END IF;
 BEGIN
  PERFORM public.verifier_portal_role_action(s,actor,a,ARRAY[trigger_id],NULL,gen_random_uuid());
  RAISE EXCEPTION 'Cycle accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cycle accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.verifier_portal_role_action(s,actor,trigger_id,ARRAY[a],NULL,gen_random_uuid());
  RAISE EXCEPTION 'Stale write accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Stale write accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.verifier_portal_role_action('777777777777777777',actor,trigger_id,ARRAY[a],NULL,request);
  RAISE EXCEPTION 'Cross-server receipt accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Cross-server receipt accepted' THEN RAISE; END IF; END;
 SELECT updated_at INTO stamp FROM public.verifier_role_actions WHERE server_id=s AND trigger_role_id=trigger_id;
 receipt:=(public.verifier_portal_role_action(s,actor,trigger_id,ARRAY[b],stamp,gen_random_uuid())->>'id')::uuid;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=receipt AND role_action_role_id IS NULL)<>3
 THEN RAISE EXCEPTION 'Edit did not cover both old and new targets'; END IF;
 SELECT updated_at INTO stamp FROM public.verifier_role_actions WHERE server_id=s AND trigger_role_id=trigger_id;
 receipt:=(public.verifier_portal_role_action(s,actor,trigger_id,NULL,stamp,gen_random_uuid())->>'id')::uuid;
 IF (SELECT count(*) FROM public.verifier_reconciliation_jobs WHERE action_id=receipt)<>1
 OR NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE action_id=receipt AND user_id='new-target' AND role_action_role_id IS NULL)
 THEN RAISE EXCEPTION 'Delete did not preserve target restoration scope'; END IF;
 IF has_function_privilege('anon','public.verifier_portal_role_action(text,text,text,text[],timestamptz,uuid)','EXECUTE')
 OR has_function_privilege('authenticated','public.verifier_portal_role_action(text,text,text,text[],timestamptz,uuid)','EXECUTE')
 OR NOT has_function_privilege('service_role','public.verifier_portal_role_action(text,text,text,text[],timestamptz,uuid)','EXECUTE')
 THEN RAISE EXCEPTION 'Backend-only permissions changed'; END IF;
END $$;
