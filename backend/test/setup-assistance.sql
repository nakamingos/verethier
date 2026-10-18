DO $$ DECLARE
 server text:='111111111111111111'; actor text:='222222222222222222';
 request uuid:='11111111-1111-4111-8111-111111111111';
 second uuid:='22222222-2222-4222-8222-222222222222';
 worker uuid:='33333333-3333-4333-8333-333333333333';
 other_worker uuid:='44444444-4444-4444-8444-444444444444';
 plan jsonb:='{"kind":"channels","before":{"admin_channel_id":null,"verification_channel_id":null},"admin":{"create":true,"name":"bouncer-admin"},"verification":{"create":true,"name":"verify"}}';
 result jsonb;
BEGIN
 ASSERT NOT has_table_privilege('anon','public.verifier_setup_requests','SELECT');
 ASSERT NOT has_table_privilege('authenticated','public.verifier_setup_requests','INSERT');
 ASSERT NOT has_function_privilege('anon','public.verifier_setup_request(text,text,text,uuid,jsonb,uuid)','EXECUTE');
 ASSERT NOT has_function_privilege('authenticated','public.verifier_setup_request(text,text,text,uuid,jsonb,uuid)','EXECUTE');
 ASSERT has_function_privilege('service_role','public.verifier_setup_request(text,text,text,uuid,jsonb,uuid)','EXECUTE');
 INSERT INTO public.verifier_server_settings(server_id,background_checks_enabled,updated_by) VALUES(server,false,actor);
 result:=public.verifier_setup_request('preview',server,actor,request,plan);
 ASSERT result->>'status'='preview';
 PERFORM public.verifier_setup_request('preview',server,actor,request,plan);
 ASSERT (SELECT count(*)=1 FROM public.verifier_setup_requests);
 BEGIN
  PERFORM public.verifier_setup_request('preview',server,actor,request,plan||'{"admin":{"name":"changed"}}');
  RAISE EXCEPTION 'Changed preview was accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.verifier_setup_request('claim',server,'999999999999999999',request,'{}',worker);
  RAISE EXCEPTION 'Another actor claimed setup';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.verifier_setup_request('claim','999999999999999999',actor,request,'{}',worker);
  RAISE EXCEPTION 'Another server claimed setup';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM public.verifier_setup_request('claim',server,actor,request,'{}',worker);
 PERFORM public.verifier_setup_request('preview',server,actor,second,plan);
 BEGIN
  PERFORM public.verifier_setup_request('claim',server,actor,second,'{}',other_worker);
  RAISE EXCEPTION 'Concurrent server setup was accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 BEGIN
  PERFORM public.verifier_setup_request('progress',server,actor,request,'{}',other_worker);
  RAISE EXCEPTION 'Wrong worker wrote setup';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM public.verifier_setup_request('progress',server,actor,request,'{"admin_channel_id":"555555555555555555"}',worker);
 PERFORM public.verifier_setup_request('release',server,actor,request,'{}',worker);
 ASSERT (SELECT progress->>'admin_channel_id'='555555555555555555' AND status='retry' FROM public.verifier_setup_requests WHERE request_id=request);
 PERFORM public.verifier_setup_request('claim',server,actor,request,'{}',other_worker);
 BEGIN
  PERFORM public.verifier_setup_request('finish',server,actor,request,'{}',worker);
  RAISE EXCEPTION 'Stale worker completed setup';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 PERFORM public.verifier_setup_request('finish',server,actor,request,'{"verification_channel_id":"666666666666666666","admin_message_id":"777777777777777777"}',other_worker);
 ASSERT (SELECT admin_channel_id='555555555555555555' AND verification_channel_id='666666666666666666' AND NOT background_checks_enabled FROM public.verifier_server_settings WHERE server_id=server);
 ASSERT (SELECT count(*)=1 FROM public.verifier_portal_actions WHERE kind='setup_channels');
 ASSERT (SELECT count(*)=0 FROM public.verifier_reconciliation_jobs);
 result:=public.verifier_setup_request('claim',server,actor,request,'{}',worker);
 ASSERT result->>'status'='completed';
 ASSERT (SELECT count(*)=1 FROM public.verifier_portal_actions WHERE request_id=request);
 BEGIN
  PERFORM public.verifier_setup_request('claim',server,actor,second,'{}',worker);
  RAISE EXCEPTION 'Stale settings preview was accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 DELETE FROM public.verifier_setup_requests WHERE request_id=second;
 plan:=jsonb_set(plan,'{before}','{"admin_channel_id":"555555555555555555","verification_channel_id":"666666666666666666"}');
 PERFORM public.verifier_setup_request('preview',server,actor,second,plan);
 UPDATE public.verifier_setup_requests SET expires_at=now()-interval '1 minute' WHERE request_id=second;
 BEGIN
  PERFORM public.verifier_setup_request('claim',server,actor,second,'{}',worker);
  RAISE EXCEPTION 'Expired initial preview was accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 UPDATE public.verifier_setup_requests SET expires_at=now()+interval '1 minute' WHERE request_id=second;
 PERFORM public.verifier_setup_request('claim',server,actor,second,'{}',worker);
 UPDATE public.verifier_setup_requests SET locked_until=now()-interval '1 minute' WHERE request_id=second;
 PERFORM public.verifier_setup_request('claim',server,actor,second,'{}',other_worker);
 BEGIN
  PERFORM public.verifier_setup_request('progress',server,actor,second,'{}',worker);
  RAISE EXCEPTION 'Expired lease wrote progress';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 UPDATE public.verifier_server_settings SET verification_channel_id='888888888888888888' WHERE server_id=server;
 BEGIN
  PERFORM public.verifier_setup_request('finish',server,actor,second,'{"admin_channel_id":"555555555555555555","verification_channel_id":"666666666666666666"}',other_worker);
  RAISE EXCEPTION 'Setup overwrote a newer channel selection';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
 ASSERT (SELECT verification_channel_id='888888888888888888' FROM public.verifier_server_settings WHERE server_id=server);
 PERFORM public.verifier_setup_request('release',server,actor,second,'{}',other_worker);
 DELETE FROM public.verifier_setup_requests WHERE request_id=second;
 PERFORM public.verifier_setup_request('preview',server,actor,second,'{"kind":"recover","channel":{"id":"888888888888888888","name":"renamed-channel"}}');
 PERFORM public.verifier_setup_request('claim',server,actor,second,'{}',worker);
 PERFORM public.verifier_setup_request('finish',server,actor,second,'{"verification_channel_id":"888888888888888888","verification_message_id":"999999999999999999"}',worker);
 ASSERT (SELECT count(*)=1 FROM public.verifier_portal_actions WHERE kind='setup_recover');
 ASSERT (SELECT NOT background_checks_enabled FROM public.verifier_server_settings WHERE server_id=server);
END $$;
