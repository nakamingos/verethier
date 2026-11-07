BEGIN;
ALTER TABLE public.verifier_server_settings
 ADD COLUMN log_channel_id text CHECK(log_channel_id IS NULL OR log_channel_id ~ '^\d{17,22}$'),
 ADD COLUMN log_events text[] NOT NULL DEFAULT ARRAY['verification_success','verification_failed','verification_blocked','wallet_added','wallet_removed','role_added','role_removed'],
 ADD COLUMN log_version uuid NOT NULL DEFAULT gen_random_uuid(),
 ADD CONSTRAINT verifier_log_events_valid CHECK(array_position(log_events,NULL) IS NULL AND log_events <@ ARRAY['verification_success','verification_failed','verification_blocked','wallet_added','wallet_removed','role_added','role_removed']);
CREATE FUNCTION public.verifier_bouncer_log_config() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.log_channel_id IS DISTINCT FROM OLD.log_channel_id OR NEW.log_events IS DISTINCT FROM OLD.log_events THEN
  NEW.log_version:=gen_random_uuid();
 ELSE NEW.log_version:=OLD.log_version; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_bouncer_log_config BEFORE UPDATE ON public.verifier_server_settings
 FOR EACH ROW EXECUTE FUNCTION public.verifier_bouncer_log_config();
CREATE TABLE public.verifier_bouncer_log_queue (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL,
 server_id text NOT NULL, user_id text NOT NULL CHECK(user_id ~ '^\d{17,22}$'),
 channel_id text NOT NULL, config_version uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('verification_success','verification_failed','verification_blocked','wallet_added','wallet_removed','role_added','role_removed')),
 source text NOT NULL CHECK(source IN ('discord','portal','background')),
 role_id text CHECK(role_id IS NULL OR role_id ~ '^\d{17,22}$'),
 reason text CHECK(reason IS NULL OR reason IN ('no_assets','provider_unavailable','requirements_changed','verification_failed')),
 occurred_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
 available_at timestamptz NOT NULL DEFAULT now(), attempts integer NOT NULL DEFAULT 0,
 locked_by uuid, locked_until timestamptz,
 UNIQUE(server_id,event_id,kind),
 CHECK((kind IN ('role_added','role_removed'))=(role_id IS NOT NULL))
);
CREATE INDEX verifier_bouncer_log_pending ON public.verifier_bouncer_log_queue(available_at,occurred_at,id);
CREATE INDEX verifier_bouncer_log_expiry ON public.verifier_bouncer_log_queue(expires_at);
ALTER TABLE public.verifier_bouncer_log_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_bouncer_log_queue FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.verifier_bouncer_log_queue TO service_role;

CREATE FUNCTION public.verifier_enqueue_bouncer_log(p_server text,p_user text,p_kind text,p_source text,
 p_role text DEFAULT NULL,p_reason text DEFAULT NULL,p_event uuid DEFAULT gen_random_uuid(),p_time timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.verifier_server_settings;
BEGIN
 SELECT * INTO s FROM public.verifier_server_settings WHERE server_id=p_server;
 IF s.log_channel_id IS NULL OR NOT (p_kind=ANY(s.log_events)) OR p_time<now()-interval '24 hours'
 OR EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE user_id=p_user AND status='processing') THEN RETURN; END IF;
 IF p_kind IN ('wallet_added','wallet_removed') AND NOT EXISTS(
  SELECT 1 FROM public.verifier_privacy_servers ps JOIN public.verifier_privacy_choices c USING(server_id)
  WHERE ps.server_id=p_server AND c.user_id=p_user AND ps.sharing_enabled AND c.epoch=ps.epoch AND c.share_since<=p_time
 ) THEN RETURN; END IF;
 INSERT INTO public.verifier_bouncer_log_queue(event_id,server_id,user_id,channel_id,config_version,kind,source,role_id,reason,occurred_at)
 VALUES(p_event,p_server,p_user,s.log_channel_id,s.log_version,p_kind,p_source,p_role,p_reason,p_time)
 ON CONFLICT(server_id,event_id,kind) DO NOTHING;
END $$;
CREATE FUNCTION public.verifier_claim_bouncer_log(p_worker uuid) RETURNS SETOF public.verifier_bouncer_log_queue
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH next AS (
  SELECT id FROM public.verifier_bouncer_log_queue
  WHERE available_at<=now() AND expires_at>now() AND (locked_until IS NULL OR locked_until<now())
  ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT 1
 ) UPDATE public.verifier_bouncer_log_queue q SET locked_by=p_worker,locked_until=now()+interval '2 minutes',attempts=attempts+1
 FROM next WHERE q.id=next.id RETURNING q.*;
$$;
CREATE FUNCTION public.verifier_bouncer_wallet_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target text; event_kind text;
BEGIN
 IF NEW.kind='wallet_verify' THEN
  PERFORM public.verifier_enqueue_bouncer_log(NEW.server_id,NEW.user_id,'verification_success',NEW.source,p_event=>NEW.id,p_time=>NEW.created_at);
 ELSIF NEW.kind IN ('wallet_link','wallet_remove','wallet_transfer_out') THEN
  event_kind:=CASE WHEN NEW.kind='wallet_link' THEN 'wallet_added' ELSE 'wallet_removed' END;
  -- Account-wide link/removal events go only to communities with current sharing permission.
  FOR target IN SELECT server_id FROM public.verifier_privacy_choices WHERE user_id=NEW.user_id LOOP
   PERFORM public.verifier_enqueue_bouncer_log(target,NEW.user_id,event_kind,NEW.source,p_event=>NEW.id,p_time=>NEW.created_at);
  END LOOP;
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 RAISE LOG 'Bouncer wallet channel activity could not be queued'; RETURN NEW;
END $$;
CREATE TRIGGER verifier_bouncer_wallet_log AFTER INSERT ON public.verifier_member_actions
 FOR EACH ROW EXECUTE FUNCTION public.verifier_bouncer_wallet_log();
CREATE FUNCTION public.verifier_bouncer_blocked_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM public.verifier_enqueue_bouncer_log(NEW.server_id,NEW.user_id,'verification_blocked',NEW.source,p_event=>NEW.id,p_time=>NEW.created_at);
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 RAISE LOG 'Bouncer blocked channel activity could not be queued'; RETURN NEW;
END $$;
CREATE TRIGGER verifier_bouncer_blocked_log AFTER INSERT ON public.verifier_blocked_verification_attempts
 FOR EACH ROW EXECUTE FUNCTION public.verifier_bouncer_blocked_log();
CREATE FUNCTION public.verifier_bouncer_delete_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='processing' THEN DELETE FROM public.verifier_bouncer_log_queue WHERE user_id=NEW.user_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_bouncer_delete_log AFTER INSERT OR UPDATE ON public.verifier_privacy_deletions
 FOR EACH ROW EXECUTE FUNCTION public.verifier_bouncer_delete_log();
REVOKE ALL ON FUNCTION public.verifier_bouncer_log_config(),public.verifier_bouncer_wallet_log(),public.verifier_bouncer_blocked_log(),public.verifier_bouncer_delete_log(),
 public.verifier_enqueue_bouncer_log(text,text,text,text,text,text,uuid,timestamptz),public.verifier_claim_bouncer_log(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_enqueue_bouncer_log(text,text,text,text,text,text,uuid,timestamptz),public.verifier_claim_bouncer_log(uuid) TO service_role;
COMMENT ON TABLE public.verifier_bouncer_log_queue IS 'Address-free Discord activity delivery queue; expires after 24 hours. Sent/discarded entries are removed. No backfill.';
NOTIFY pgrst,'reload schema';
COMMIT;
