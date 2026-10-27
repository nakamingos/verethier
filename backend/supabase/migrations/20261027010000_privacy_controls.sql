BEGIN;
CREATE TABLE public.verifier_privacy_servers (
 server_id text PRIMARY KEY, sharing_enabled boolean NOT NULL DEFAULT false,
 epoch uuid NOT NULL DEFAULT gen_random_uuid(), updated_by text, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.verifier_privacy_choices (
 server_id text NOT NULL REFERENCES public.verifier_privacy_servers(server_id), user_id text NOT NULL,
 epoch uuid NOT NULL, share_since timestamptz, export_since timestamptz,
 notice_version text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(server_id,user_id)
);
CREATE TABLE public.verifier_privacy_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, server_id text NOT NULL, user_id text NOT NULL,
 epoch uuid NOT NULL, sharing boolean NOT NULL, exports boolean NOT NULL,
 notice_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.verifier_operator_access (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id text NOT NULL, server_id text,
 operation text NOT NULL, reason text, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.verifier_privacy_deletions (
 id uuid PRIMARY KEY, user_id text, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','declined')),
 created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz, reviewed_by text, outcome text,
 completed_at timestamptz, subject_hash text
);
CREATE UNIQUE INDEX verifier_privacy_one_deletion ON public.verifier_privacy_deletions(user_id) WHERE status IN ('pending','processing');
CREATE TABLE public.verifier_wallet_exports (
 id uuid PRIMARY KEY, server_id text NOT NULL, actor_id text NOT NULL, filters jsonb NOT NULL,
 operator_override boolean NOT NULL DEFAULT false, reason text,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','expired')),
 progress integer NOT NULL DEFAULT 0, total integer NOT NULL DEFAULT 0,
 result jsonb, error text, locked_until timestamptz, worker uuid,
 created_at timestamptz NOT NULL DEFAULT now(), checked_at timestamptz, expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes'
);
CREATE INDEX ON public.verifier_wallet_exports(status,created_at);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['verifier_privacy_servers','verifier_privacy_choices','verifier_privacy_events','verifier_operator_access','verifier_privacy_deletions','verifier_wallet_exports'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE public.verifier_privacy_events_id_seq TO service_role;

CREATE FUNCTION public.verifier_privacy_server(p_server text,p_actor text,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.verifier_privacy_servers;
BEGIN
 INSERT INTO public.verifier_privacy_servers(server_id) VALUES(p_server) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.verifier_privacy_servers WHERE server_id=p_server FOR UPDATE;
 IF s.sharing_enabled IS DISTINCT FROM p_enabled THEN
  UPDATE public.verifier_privacy_servers SET sharing_enabled=p_enabled,epoch=gen_random_uuid(),updated_by=p_actor,updated_at=now()
   WHERE server_id=p_server RETURNING * INTO s;
 END IF;
 RETURN to_jsonb(s);
END $$;
CREATE FUNCTION public.verifier_privacy_choose(p_server text,p_user text,p_epoch uuid,p_share boolean,p_export boolean,p_notice text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.verifier_privacy_servers; c public.verifier_privacy_choices;
BEGIN
 SELECT * INTO s FROM public.verifier_privacy_servers WHERE server_id=p_server FOR UPDATE;
 IF NOT FOUND OR s.epoch<>p_epoch OR p_notice<>'2026-10-27' OR p_share IS NULL OR p_export IS NULL
  OR (p_share AND NOT s.sharing_enabled) THEN RAISE EXCEPTION 'Privacy settings changed. Refresh before choosing.'; END IF;
 SELECT * INTO c FROM public.verifier_privacy_choices WHERE server_id=p_server AND user_id=p_user;
 INSERT INTO public.verifier_privacy_choices(server_id,user_id,epoch,share_since,export_since,notice_version)
 VALUES(p_server,p_user,s.epoch,
  CASE WHEN p_share THEN CASE WHEN c.epoch=s.epoch THEN coalesce(c.share_since,now()) ELSE now() END END,
  CASE WHEN p_export THEN CASE WHEN c.epoch=s.epoch THEN coalesce(c.export_since,now()) ELSE now() END END,p_notice)
 ON CONFLICT(server_id,user_id) DO UPDATE SET epoch=excluded.epoch,share_since=excluded.share_since,
  export_since=excluded.export_since,notice_version=excluded.notice_version,updated_at=now() RETURNING * INTO c;
 INSERT INTO public.verifier_privacy_events(server_id,user_id,epoch,sharing,exports,notice_version)
 VALUES(p_server,p_user,s.epoch,p_share,p_export,p_notice);
 RETURN to_jsonb(c);
END $$;
CREATE FUNCTION public.verifier_privacy_visible(p_server text,p_user text,p_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.verifier_privacy_servers s JOIN public.verifier_privacy_choices c USING(server_id)
 WHERE s.server_id=p_server AND c.user_id=p_user AND s.sharing_enabled AND c.epoch=s.epoch
 AND c.share_since IS NOT NULL AND p_time>=c.share_since);
$$;
CREATE FUNCTION public.verifier_privacy_wallet_matches(p_server text,p_address text) RETURNS TABLE(user_id text,wallet_match text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH matches AS (
  SELECT w.user_id,'current'::text AS kind FROM public.user_wallets w WHERE address=p_address
   AND public.verifier_privacy_visible(p_server,w.user_id,w.last_verified_at)
  UNION ALL
  SELECT a.user_id,'history'::text FROM public.verifier_member_actions a WHERE address=p_address
   AND public.verifier_privacy_visible(p_server,a.user_id,a.created_at)
 ) SELECT user_id,CASE WHEN bool_or(kind='current') THEN 'current' ELSE 'history' END FROM matches GROUP BY user_id;
$$;

-- The backend authenticates the operator and logs the override before passing it.
DROP FUNCTION public.verifier_portal_wallet_audit(text,text[],text,text,integer,text,text);
CREATE FUNCTION public.verifier_portal_wallet_audit(p_server text,p_users text[],p_member text,
 p_after text,p_limit integer DEFAULT 20,p_address text DEFAULT NULL,p_account_after text DEFAULT NULL,p_operator boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH eligible AS (
  SELECT unnest(p_users) AS user_id UNION SELECT user_id FROM public.verifier_user_roles WHERE server_id=p_server
  UNION SELECT user_id FROM public.verifier_member_actions WHERE server_id=p_server
 ), associations AS (
  SELECT w.user_id,w.address,w.wallet_type,CASE WHEN p_operator THEN w.created_at ELSE greatest(w.created_at,(SELECT share_since FROM public.verifier_privacy_choices WHERE server_id=p_server AND user_id=w.user_id)) END AS seen_at,w.last_verified_at AS proven_at,true AS current
  FROM public.user_wallets w JOIN eligible e USING(user_id)
  WHERE p_operator OR public.verifier_privacy_visible(p_server,w.user_id,w.last_verified_at)
  UNION ALL SELECT a.user_id,a.address,a.wallet_type,a.created_at,CASE WHEN p_operator OR public.verifier_privacy_visible(p_server,a.user_id,a.last_proven_at) THEN a.last_proven_at END,false
  FROM public.verifier_member_actions a JOIN eligible e USING(user_id)
  WHERE p_operator OR public.verifier_privacy_visible(p_server,a.user_id,a.created_at)
 ), summaries AS (
  SELECT address,user_id,max(wallet_type) AS wallet_type,min(seen_at) AS first_seen,max(seen_at) AS last_seen,
  max(proven_at) AS last_proven,bool_or(current) AS current FROM associations GROUP BY address,user_id
 ), shared AS (
  SELECT address,count(*) AS accounts FROM summaries WHERE p_address IS NULL OR address=p_address GROUP BY address
  HAVING count(*)>1 AND (p_member IS NULL OR bool_or(user_id=p_member))
 ), page AS (
  SELECT * FROM shared WHERE p_after IS NULL OR address>p_after ORDER BY address LIMIT least(greatest(p_limit,1),50)
 ), details AS (
  SELECT p.*,coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.user_id) FROM
   (SELECT * FROM summaries WHERE address=p.address AND (p_account_after IS NULL OR user_id>p_account_after) ORDER BY user_id LIMIT 25) s),'[]'::jsonb) AS account_data,
   (SELECT count(*) FROM summaries WHERE address=p.address AND (p_account_after IS NULL OR user_id>p_account_after)) AS remaining FROM page p
 ) SELECT jsonb_build_object('total',(SELECT count(*) FROM shared),'items',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'address',p.address,'account_count',p.accounts,'accounts',p.account_data,
 'account_next',CASE WHEN p.remaining>25 THEN p.account_data->24->>'user_id' END) ORDER BY p.address) FROM details p),'[]'::jsonb),
 'next',CASE WHEN EXISTS(SELECT 1 FROM shared WHERE address>(SELECT max(address) FROM page)) THEN (SELECT max(address) FROM page) END,
 'history_since',(SELECT min(seen_at) FROM associations));
$$;

CREATE FUNCTION public.verifier_privacy_redact(j jsonb,term text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 IF j IS NULL THEN RETURN NULL; END IF;
 IF jsonb_typeof(j)='object' THEN
  SELECT coalesce(jsonb_object_agg(CASE WHEN position(lower(term) IN lower(key))>0 THEN '[redacted]' ELSE key END,public.verifier_privacy_redact(value,term)),'{}') INTO result FROM jsonb_each(j);
 ELSIF jsonb_typeof(j)='array' THEN
  SELECT coalesce(jsonb_agg(public.verifier_privacy_redact(value,term) ORDER BY ord),'[]') INTO result FROM jsonb_array_elements(j) WITH ORDINALITY AS a(value,ord);
 ELSIF jsonb_typeof(j)='string' AND position(lower(term) IN lower(j#>>'{}'))>0 THEN result:='"[redacted]"';
 ELSE result:=j; END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.verifier_privacy_assert_active() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy-user:'||NEW.user_id,0));
 IF EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE user_id=NEW.user_id AND status='processing') THEN
  RAISE EXCEPTION 'Account deletion is in progress';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_privacy_wallet_active BEFORE INSERT OR UPDATE ON public.user_wallets
 FOR EACH ROW EXECUTE FUNCTION public.verifier_privacy_assert_active();
CREATE TRIGGER verifier_privacy_flow_active BEFORE INSERT OR UPDATE ON public.verifier_member_flows
 FOR EACH ROW EXECUTE FUNCTION public.verifier_privacy_assert_active();

CREATE FUNCTION public.verifier_privacy_role_active() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy-user:'||NEW.user_id,0));
 IF (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status) AND NEW.status='active' AND EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE user_id=NEW.user_id AND status='processing') THEN
  RAISE EXCEPTION 'Account deletion is in progress';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_privacy_role_active BEFORE INSERT OR UPDATE ON public.verifier_user_roles
 FOR EACH ROW EXECUTE FUNCTION public.verifier_privacy_role_active();

CREATE FUNCTION public.verifier_privacy_review(p_request uuid,p_actor text,p_approve boolean,p_outcome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.verifier_privacy_deletions; w record;
BEGIN
 SELECT * INTO r FROM public.verifier_privacy_deletions WHERE id=p_request FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
 IF r.status<>'pending' THEN RETURN to_jsonb(r); END IF;
 IF nullif(btrim(p_outcome),'') IS NULL OR length(p_outcome)>500 THEN RAISE EXCEPTION 'Explain the outcome'; END IF;
 -- Wallet removal and its durable role reconciliation happen before erasure.
 IF p_approve THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('privacy-user:'||r.user_id,0));
  UPDATE public.verifier_privacy_deletions SET status='processing' WHERE id=r.id;
  FOR w IN SELECT address FROM public.user_wallets WHERE user_id=r.user_id ORDER BY address LOOP
   PERFORM public.verifier_member_remove_wallet(r.user_id,w.address,gen_random_uuid());
  END LOOP;
  DELETE FROM public.verifier_member_flows WHERE user_id=r.user_id;
 END IF;
 UPDATE public.verifier_privacy_deletions SET status=CASE WHEN p_approve THEN 'processing' ELSE 'declined' END,
 reviewed_at=now(),reviewed_by=p_actor,outcome=p_outcome WHERE id=p_request RETURNING * INTO r;
 RETURN to_jsonb(r);
END $$;
-- Preserve the revocation target if a deletion races an untracked Discord grant.
CREATE FUNCTION public.verifier_privacy_recheck_grant(p_user text,p_server text,p_role text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy-user:'||p_user,0));
 IF NOT EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE user_id=p_user AND status='processing') THEN RETURN; END IF;
 INSERT INTO public.verifier_user_roles(user_id,server_id,role_id,status) VALUES(p_user,p_server,p_role,'revoked')
 ON CONFLICT(user_id,server_id,role_id) DO UPDATE SET status='revoked';
 INSERT INTO public.verifier_reconciliation_jobs(server_id,user_id) VALUES(p_server,p_user);
END $$;

CREATE FUNCTION public.verifier_privacy_cleanup(p_grace_seconds integer DEFAULT 900) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE pair record; r record; expired integer:=0; erased integer:=0;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy-cleanup',0));
 UPDATE public.verifier_wallet_exports SET result=NULL,status='expired',worker=NULL,locked_until=NULL
 WHERE expires_at<now() AND (result IS NOT NULL OR status<>'expired');
 DELETE FROM public.verifier_wallet_exports WHERE expires_at<now()-interval '1 day';
 FOR pair IN SELECT user_id,address FROM public.verifier_member_actions a
  GROUP BY user_id,address HAVING max(created_at) FILTER(WHERE kind IN ('wallet_remove','wallet_transfer_out'))<now()-interval '1 year'
  AND NOT EXISTS(SELECT 1 FROM public.user_wallets w WHERE w.user_id=a.user_id AND w.address=a.address)
  LIMIT 100 LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||pair.address,0));
  IF EXISTS(SELECT 1 FROM public.user_wallets WHERE user_id=pair.user_id AND address=pair.address) THEN CONTINUE; END IF;
  UPDATE public.verifier_user_roles SET verification_data=public.verifier_privacy_redact(verification_data,pair.address) WHERE user_id=pair.user_id;
  UPDATE public.verifier_reconciliation_jobs SET result=public.verifier_privacy_redact(result,pair.address)
   WHERE user_id=pair.user_id OR pair.user_id=ANY(member_ids);
  UPDATE public.verifier_reconciliation_jobs SET member_action_id=NULL WHERE member_action_id IN
   (SELECT id FROM public.verifier_member_actions WHERE user_id=pair.user_id AND address=pair.address);
  DELETE FROM public.verifier_member_actions WHERE user_id=pair.user_id AND address=pair.address;
  UPDATE public.verifier_wallet_exports SET result=NULL,status='expired',worker=NULL,locked_until=NULL WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(result->'rows') row WHERE row->>'user_id'=pair.user_id AND row->>'address'=pair.address);
  expired:=expired+1;
 END LOOP;
 FOR r IN SELECT * FROM public.verifier_privacy_deletions d WHERE status='processing' AND reviewed_at<now()-make_interval(secs=>greatest(p_grace_seconds,900))
  AND NOT EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs j WHERE
   (j.user_id=d.user_id OR d.user_id=ANY(j.member_ids)) AND j.status<>'completed') FOR UPDATE LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('privacy-user:'||r.user_id,0));
  IF EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE (user_id=r.user_id OR r.user_id=ANY(member_ids)) AND status<>'completed') THEN CONTINUE; END IF;
  UPDATE public.verifier_wallet_exports SET result=NULL,status='expired',worker=NULL,locked_until=NULL WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(result->'rows') row WHERE row->>'user_id'=r.user_id);
  DELETE FROM public.user_wallets WHERE user_id=r.user_id;
  DELETE FROM public.verifier_member_flows WHERE user_id=r.user_id;
  DELETE FROM public.verifier_web_sessions WHERE user_id=r.user_id;
  UPDATE public.verifier_reconciliation_jobs SET member_action_id=NULL WHERE member_action_id IN
   (SELECT id FROM public.verifier_member_actions WHERE user_id=r.user_id);
  UPDATE public.verifier_reconciliation_jobs SET result=public.verifier_privacy_redact(result,r.user_id),
   member_ids=array_remove(member_ids,r.user_id) WHERE r.user_id=ANY(member_ids);
  DELETE FROM public.verifier_reconciliation_jobs WHERE user_id=r.user_id;
  DELETE FROM public.verifier_member_actions WHERE user_id=r.user_id;
  DELETE FROM public.verifier_user_roles WHERE user_id=r.user_id;
  IF to_regclass('public.verifier_users') IS NOT NULL THEN EXECUTE 'DELETE FROM public.verifier_users WHERE user_id=$1' USING r.user_id; END IF;
  DELETE FROM public.verifier_privacy_choices WHERE user_id=r.user_id;
  DELETE FROM public.verifier_privacy_events WHERE user_id=r.user_id;
  UPDATE public.verifier_privacy_deletions SET subject_hash=encode(sha256(convert_to(r.user_id,'UTF8')),'hex'),user_id=NULL,status='completed',completed_at=now(),outcome='Account deletion completed; minimum block/security records may be retained as disclosed.' WHERE id=r.id;
  erased:=erased+1;
 END LOOP;
 RETURN jsonb_build_object('expired_associations',expired,'deleted_accounts',erased);
END $$;

-- Recovery-only: import the latest restricted deletion ledger after restoring an older backup,
-- while the public application is offline. Reconcile roles before finishing queued erasures.
CREATE FUNCTION public.verifier_privacy_reapply_deletions(p_markers jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE marker record; subject record; request uuid; total integer:=0;
BEGIN
 IF jsonb_typeof(p_markers)<>'array' THEN RAISE EXCEPTION 'Invalid deletion ledger'; END IF;
 FOR marker IN SELECT * FROM jsonb_to_recordset(p_markers) AS m(subject_hash text,completed_at timestamptz) LOOP
  IF marker.subject_hash !~ '^[0-9a-f]{64}$' OR marker.completed_at IS NULL THEN RAISE EXCEPTION 'Invalid deletion marker'; END IF;
  FOR subject IN SELECT user_id FROM (
   SELECT user_id FROM public.user_wallets UNION SELECT user_id FROM public.verifier_member_actions
   UNION SELECT user_id FROM public.verifier_user_roles UNION SELECT user_id FROM public.verifier_web_sessions
   UNION SELECT user_id FROM public.verifier_member_flows UNION SELECT user_id FROM public.verifier_privacy_choices
  ) users WHERE encode(sha256(convert_to(user_id,'UTF8')),'hex')=marker.subject_hash LOOP
   -- A later newly proven account is outside the earlier deletion's scope.
   IF EXISTS(SELECT 1 FROM public.user_wallets WHERE user_id=subject.user_id AND last_verified_at>marker.completed_at) THEN CONTINUE; END IF;
   IF EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE user_id=subject.user_id AND status IN ('pending','processing')) THEN CONTINUE; END IF;
   request:=gen_random_uuid();
   INSERT INTO public.verifier_privacy_deletions(id,user_id) VALUES(request,subject.user_id);
   PERFORM public.verifier_privacy_review(request,'recovery',true,'Reapply a previously completed deletion after backup restoration.');
   DELETE FROM public.verifier_web_sessions WHERE user_id=subject.user_id;
   total:=total+1;
  END LOOP;
  -- Preserve recovery markers even when the restored backup has no matching records.
  IF NOT EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE subject_hash=marker.subject_hash AND completed_at>=marker.completed_at) THEN
   INSERT INTO public.verifier_privacy_deletions(id,status,subject_hash,completed_at,outcome)
   VALUES(gen_random_uuid(),'completed',marker.subject_hash,marker.completed_at,'Restricted backup recovery marker.');
  END IF;
 END LOOP;
 RETURN total;
END $$;

CREATE FUNCTION public.verifier_privacy_claim_export(p_worker uuid) RETURNS SETOF public.verifier_wallet_exports
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH candidate AS (SELECT id FROM public.verifier_wallet_exports WHERE expires_at>now()
  AND (status='pending' OR (status='running' AND locked_until<now())) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
 UPDATE public.verifier_wallet_exports e SET status='running',worker=p_worker,locked_until=now()+interval '2 minutes'
 FROM candidate c WHERE e.id=c.id RETURNING e.*;
$$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND (p.proname LIKE 'verifier_privacy_%' OR p.proname='verifier_portal_wallet_audit') LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',f.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',f.signature);
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
