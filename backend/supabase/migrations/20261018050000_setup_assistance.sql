BEGIN;
ALTER TABLE public.verifier_server_settings ADD COLUMN admin_channel_id text;

-- Plans and Discord receipts stay private. A lease serializes setup per server;
-- receipts and channel topics allow recovery after a lost Discord response.
CREATE TABLE public.verifier_setup_requests (
 request_id uuid PRIMARY KEY, server_id text NOT NULL, actor_id text NOT NULL,
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object'),
 progress jsonb NOT NULL DEFAULT '{}'::jsonb,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','applying','retry','completed')),
 locked_by uuid, locked_until timestamptz, started_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.verifier_setup_requests(server_id, status);
ALTER TABLE public.verifier_setup_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_setup_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.verifier_setup_requests TO service_role;

CREATE FUNCTION public.verifier_setup_request(p_step text,p_server text,p_actor text,p_request uuid,
 p_payload jsonb DEFAULT '{}'::jsonb,p_worker uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE operation public.verifier_setup_requests; settings public.verifier_server_settings;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('setup:'||p_server,0));
 SELECT * INTO operation FROM public.verifier_setup_requests WHERE request_id=p_request FOR UPDATE;
 IF FOUND AND (operation.server_id<>p_server OR operation.actor_id<>p_actor) THEN
  RAISE EXCEPTION 'Setup request conflict' USING ERRCODE='40001';
 END IF;
 IF p_step='preview' THEN
  IF operation.request_id IS NOT NULL THEN
   IF operation.plan IS DISTINCT FROM p_payload THEN
    RAISE EXCEPTION 'Setup preview changed' USING ERRCODE='40001';
   END IF;
   RETURN to_jsonb(operation);
  END IF;
  IF p_payload->>'kind' NOT IN ('channels','recover') OR p_payload->>'kind' IS NULL
   OR EXISTS(SELECT 1 FROM public.verifier_portal_actions WHERE request_id=p_request) THEN
   RAISE EXCEPTION 'Invalid setup preview' USING ERRCODE='40001';
  END IF;
  INSERT INTO public.verifier_setup_requests(request_id,server_id,actor_id,plan)
   VALUES(p_request,p_server,p_actor,p_payload) RETURNING * INTO operation;
  RETURN to_jsonb(operation);
 END IF;
 IF operation.request_id IS NULL THEN RAISE EXCEPTION 'Setup preview not found' USING ERRCODE='40001'; END IF;
 IF p_step='claim' THEN
  IF operation.status='completed' THEN RETURN to_jsonb(operation); END IF;
  IF operation.started_at IS NULL AND operation.expires_at<now() THEN
   RAISE EXCEPTION 'Setup preview expired' USING ERRCODE='40001';
  END IF;
  IF p_worker IS NULL OR EXISTS(SELECT 1 FROM public.verifier_setup_requests
   WHERE server_id=p_server AND status='applying' AND locked_until>now()) THEN
   RAISE EXCEPTION 'Setup is already running' USING ERRCODE='40001';
  END IF;
  IF operation.plan->>'kind'='channels' THEN
   SELECT * INTO settings FROM public.verifier_server_settings WHERE server_id=p_server FOR UPDATE;
   IF settings.admin_channel_id IS DISTINCT FROM operation.plan->'before'->>'admin_channel_id'
    OR settings.verification_channel_id IS DISTINCT FROM operation.plan->'before'->>'verification_channel_id' THEN
    RAISE EXCEPTION 'Channel settings changed; review setup again' USING ERRCODE='40001';
   END IF;
  END IF;
  UPDATE public.verifier_setup_requests SET status='applying',locked_by=p_worker,
   locked_until=now()+interval '10 minutes',started_at=coalesce(started_at,now()),updated_at=now()
   WHERE request_id=p_request RETURNING * INTO operation;
  RETURN to_jsonb(operation);
 END IF;
 IF operation.status<>'applying' OR operation.locked_by IS DISTINCT FROM p_worker
  OR operation.locked_until<now() THEN
  RAISE EXCEPTION 'Setup lease changed; retry setup' USING ERRCODE='40001';
 END IF;
 IF p_step='release' THEN
  UPDATE public.verifier_setup_requests SET status='retry',locked_by=NULL,locked_until=NULL,updated_at=now()
   WHERE request_id=p_request RETURNING * INTO operation;
 ELSIF p_step IN ('progress','finish') THEN
  IF jsonb_typeof(p_payload)<>'object' THEN RAISE EXCEPTION 'Invalid progress'; END IF;
  operation.progress:=operation.progress||p_payload;
  IF p_step='finish' THEN
   IF operation.plan->>'kind'='channels' THEN
    SELECT * INTO settings FROM public.verifier_server_settings WHERE server_id=p_server FOR UPDATE;
    IF settings.admin_channel_id IS DISTINCT FROM operation.plan->'before'->>'admin_channel_id'
     OR settings.verification_channel_id IS DISTINCT FROM operation.plan->'before'->>'verification_channel_id' THEN
     RAISE EXCEPTION 'Channel settings changed; review setup again' USING ERRCODE='40001';
    END IF;
    IF operation.progress->>'admin_channel_id' IS NULL OR operation.progress->>'verification_channel_id' IS NULL THEN
     RAISE EXCEPTION 'Setup channels are incomplete';
    END IF;
    INSERT INTO public.verifier_server_settings(server_id,admin_channel_id,verification_channel_id,updated_by)
     VALUES(p_server,operation.progress->>'admin_channel_id',operation.progress->>'verification_channel_id',p_actor)
     ON CONFLICT(server_id) DO UPDATE SET admin_channel_id=excluded.admin_channel_id,
      verification_channel_id=excluded.verification_channel_id,updated_by=p_actor,updated_at=now()
      WHERE verifier_server_settings.admin_channel_id IS NOT DISTINCT FROM operation.plan->'before'->>'admin_channel_id'
       AND verifier_server_settings.verification_channel_id IS NOT DISTINCT FROM operation.plan->'before'->>'verification_channel_id';
    IF NOT FOUND THEN RAISE EXCEPTION 'Channel settings changed; review setup again' USING ERRCODE='40001'; END IF;
   ELSIF operation.progress->>'verification_message_id' IS NULL THEN
    RAISE EXCEPTION 'Verification message is incomplete';
   END IF;
   INSERT INTO public.verifier_portal_actions(server_id,actor_id,kind,before_rule,after_rule,request_id)
    VALUES(p_server,p_actor,'setup_'||(operation.plan->>'kind'),operation.plan,operation.progress,p_request);
  END IF;
  UPDATE public.verifier_setup_requests SET progress=operation.progress,
   status=CASE WHEN p_step='finish' THEN 'completed' ELSE 'applying' END,
   locked_by=CASE WHEN p_step='finish' THEN NULL ELSE p_worker END,
   locked_until=CASE WHEN p_step='finish' THEN NULL ELSE now()+interval '10 minutes' END,updated_at=now()
   WHERE request_id=p_request RETURNING * INTO operation;
 ELSE RAISE EXCEPTION 'Invalid setup step';
 END IF;
 RETURN to_jsonb(operation);
END $$;
REVOKE ALL ON FUNCTION public.verifier_setup_request(text,text,text,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_setup_request(text,text,text,uuid,jsonb,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
