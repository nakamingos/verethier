BEGIN;
-- Visibility associations only: ownership, wallet stacking and dormancy stay account-wide.
-- No FK to user_wallets: removed-wallet disclosure follows the existing one-year retention.
CREATE TABLE public.verifier_wallet_communities (
 user_id text NOT NULL, address text NOT NULL, server_id text NOT NULL,
 source text NOT NULL CHECK(source IN ('legacy','verification','member')),
 enabled boolean NOT NULL DEFAULT true,
 associated_at timestamptz NOT NULL DEFAULT now(), shared_at timestamptz NOT NULL DEFAULT now(),
 removed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,address,server_id)
);
CREATE INDEX verifier_wallet_communities_server ON public.verifier_wallet_communities(server_id,user_id,address);
CREATE TABLE public.verifier_wallet_community_events (
 id uuid PRIMARY KEY, user_id text NOT NULL, address text NOT NULL, server_id text NOT NULL,
 enabled boolean NOT NULL, source text NOT NULL CHECK(source IN ('verification','member')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifier_wallet_community_events_subject ON public.verifier_wallet_community_events(user_id,address,created_at);
ALTER TABLE public.verifier_wallet_communities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifier_wallet_community_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_wallet_communities, public.verifier_wallet_community_events FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.verifier_wallet_communities, public.verifier_wallet_community_events TO service_role;

-- The operator explicitly approved these two existing servers only. Future
-- wallets and future servers never acquire legacy rows. Existing privacy epochs
-- and member sharing/export choices still gate all ordinary access.
LOCK TABLE public.user_wallets IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO public.verifier_wallet_communities(user_id,address,server_id,source,associated_at,shared_at)
 SELECT w.user_id,w.address,s.server_id,'legacy',w.created_at,w.last_verified_at
 FROM public.user_wallets w CROSS JOIN (VALUES ('1369930881267142686'),('919772570612539422')) s(server_id)
 WHERE w.last_verified_at IS NOT NULL;
INSERT INTO public.verifier_wallet_communities(user_id,address,server_id,source,associated_at,shared_at,removed_at)
 SELECT a.user_id,a.address,s.server_id,'legacy',min(a.created_at),max(a.created_at),max(a.created_at)
 FROM public.verifier_member_actions a
 CROSS JOIN (VALUES ('1369930881267142686'),('919772570612539422')) s(server_id)
 WHERE a.kind IN ('wallet_remove','wallet_transfer_out')
 AND NOT EXISTS(SELECT 1 FROM public.user_wallets w WHERE w.user_id=a.user_id AND w.address=a.address)
 GROUP BY a.user_id,a.address,s.server_id
 HAVING max(a.created_at)>=now()-interval '1 year'
 ON CONFLICT DO NOTHING;

CREATE FUNCTION public.verifier_wallet_community_allowed(p_server text,p_user text,p_address text,
 p_time timestamptz DEFAULT NULL,p_event_server text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.verifier_wallet_communities c
 WHERE c.server_id=p_server AND c.user_id=p_user AND c.address=p_address AND c.enabled
 AND CASE WHEN p_time IS NULL THEN c.removed_at IS NULL
 ELSE (c.source='legacy' OR (p_time>=c.associated_at AND (p_event_server IS NULL OR p_event_server=p_server)))
  AND (c.removed_at IS NULL OR p_time<=c.removed_at) END);
$$;

-- Preserve removed/previous-owner history, but never give a new ownership tenure
-- the old tenure's disclosure grants. A fresh proof can create its own association.
CREATE FUNCTION public.verifier_wallet_community_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- BEFORE INSERT also fires on UPSERT: leave existing ownership for UPDATE.
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM public.user_wallets WHERE address=NEW.address) THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' THEN
  UPDATE public.verifier_wallet_communities SET removed_at=now(),updated_at=now()
   WHERE user_id=OLD.user_id AND address=OLD.address AND removed_at IS NULL;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
  IF TG_OP='UPDATE' THEN
   UPDATE public.verifier_wallet_communities SET removed_at=now(),updated_at=now()
    WHERE user_id=OLD.user_id AND address=OLD.address AND removed_at IS NULL;
  END IF;
  DELETE FROM public.verifier_wallet_communities WHERE user_id=NEW.user_id AND address=NEW.address;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_wallet_community_lifecycle BEFORE INSERT OR DELETE OR UPDATE OF user_id
 ON public.user_wallets FOR EACH ROW EXECUTE FUNCTION public.verifier_wallet_community_lifecycle();

CREATE FUNCTION public.verifier_associate_signed_wallet(p_user text,p_address text,p_server text,p_request uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.user_wallets; enabled_choice boolean;
BEGIN
 IF p_server IS NULL THEN RETURN; END IF;
 IF p_server !~ '^\d{17,22}$' THEN RAISE EXCEPTION 'Invalid community'; END IF;
 SELECT * INTO STRICT w FROM public.user_wallets WHERE user_id=p_user AND address=p_address FOR UPDATE;
 -- Keep deliberate per-wallet opt-outs even when ending their legacy fallback.
 UPDATE public.verifier_wallet_communities SET source='member',updated_at=now()
  WHERE user_id=p_user AND address=p_address AND source='legacy' AND server_id<>p_server AND NOT enabled;
 DELETE FROM public.verifier_wallet_communities
  WHERE user_id=p_user AND address=p_address AND source='legacy' AND server_id<>p_server;
 INSERT INTO public.verifier_wallet_communities(user_id,address,server_id,source,shared_at)
 VALUES(p_user,p_address,p_server,'verification',now())
 ON CONFLICT(user_id,address,server_id) DO UPDATE SET source='verification',shared_at=now(),removed_at=NULL,updated_at=now()
 RETURNING enabled INTO enabled_choice;
 INSERT INTO public.verifier_wallet_community_events(id,user_id,address,server_id,enabled,source)
 VALUES(p_request,p_user,p_address,p_server,enabled_choice,'verification') ON CONFLICT DO NOTHING;
END $$;

-- Wrap the existing atomic proof/link/dormancy transaction for all wallet families.
ALTER FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer)
 RENAME TO verifier_link_verified_wallet_before_communities;
CREATE FUNCTION public.verifier_link_verified_wallet(p_user text,p_address text,p_type text,p_name text,
 p_request uuid,p_source text,p_server text,p_channel text,p_chain integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.verifier_link_verified_wallet_before_communities(p_user,p_address,p_type,p_name,p_request,p_source,p_server,p_channel,p_chain);
 IF result->>'success'='true' AND result ? 'wallet' THEN
  PERFORM public.verifier_associate_signed_wallet(p_user,p_address,p_server,p_request);
  IF p_server IS NOT NULL AND (result->>'isNewAddress'='true' OR result->>'wasTransferred'='true')
   AND public.verifier_wallet_community_allowed(p_server,p_user,p_address) THEN
   BEGIN
    PERFORM public.verifier_enqueue_bouncer_log(p_server,p_user,'wallet_added',p_source,p_event=>p_request);
   EXCEPTION WHEN OTHERS THEN RAISE LOG 'Bouncer wallet channel activity could not be queued'; END;
  END IF;
 END IF;
 RETURN result;
END $$;
ALTER FUNCTION public.verifier_member_link_wallet(text,uuid,boolean,integer)
 RENAME TO verifier_member_link_wallet_before_communities;
CREATE FUNCTION public.verifier_member_link_wallet(p_user text,p_flow uuid,p_transfer boolean,p_chain integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; flow public.verifier_member_flows; fresh boolean;
BEGIN
 SELECT * INTO flow FROM public.verifier_member_flows WHERE id=p_flow AND user_id=p_user FOR UPDATE;
 fresh:=flow.completed_at IS NULL;
 result:=public.verifier_member_link_wallet_before_communities(p_user,p_flow,p_transfer,p_chain);
 IF result->>'linked'='true' AND fresh THEN
  SELECT * INTO STRICT flow FROM public.verifier_member_flows WHERE id=p_flow AND user_id=p_user AND completed_at IS NOT NULL;
  PERFORM public.verifier_associate_signed_wallet(p_user,flow.address,flow.server_id,p_flow);
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.verifier_member_wallet_community(p_user text,p_address text,p_server text,p_enabled boolean,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE event public.verifier_wallet_community_events;
BEGIN
 IF p_server !~ '^\d{17,22}$' OR p_enabled IS NULL THEN RAISE EXCEPTION 'Invalid wallet sharing choice'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||p_address,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy-user:'||p_user,0));
 IF EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE user_id=p_user AND status='processing')
 THEN RAISE EXCEPTION 'Account deletion is in progress'; END IF;
 PERFORM 1 FROM public.user_wallets WHERE user_id=p_user AND address=p_address FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Saved wallet not found'; END IF;
 SELECT * INTO event FROM public.verifier_wallet_community_events WHERE id=p_request;
 IF FOUND THEN
  IF event.user_id<>p_user OR event.address<>p_address OR event.server_id<>p_server OR event.enabled<>p_enabled OR event.source<>'member'
  THEN RAISE EXCEPTION 'Request conflict'; END IF;
  RETURN jsonb_build_object('ok',true);
 END IF;
 INSERT INTO public.verifier_wallet_communities(user_id,address,server_id,source,enabled,shared_at)
 VALUES(p_user,p_address,p_server,'member',p_enabled,now())
 ON CONFLICT(user_id,address,server_id) DO UPDATE SET source='member',
 enabled=p_enabled,shared_at=now(),removed_at=NULL,updated_at=now();
 INSERT INTO public.verifier_wallet_community_events(id,user_id,address,server_id,enabled,source)
 VALUES(p_request,p_user,p_address,p_server,p_enabled,'member');
 RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.verifier_privacy_wallet_matches(p_server text,p_address text) RETURNS TABLE(user_id text,wallet_match text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH matches AS (
  SELECT w.user_id,'current'::text AS kind FROM public.user_wallets w
  JOIN public.verifier_wallet_communities c ON c.user_id=w.user_id AND c.address=w.address AND c.server_id=p_server
  WHERE w.address=p_address AND public.verifier_wallet_community_allowed(p_server,w.user_id,w.address)
   AND public.verifier_privacy_visible(p_server,w.user_id,c.shared_at)
  UNION ALL
  SELECT a.user_id,'history'::text FROM public.verifier_member_actions a WHERE a.address=p_address
   AND ((SELECT source FROM public.verifier_wallet_communities c WHERE c.server_id=p_server AND c.user_id=a.user_id AND c.address=a.address)='legacy' OR a.server_id IS NOT NULL OR a.kind IN ('wallet_remove','wallet_transfer_out'))
   AND public.verifier_wallet_community_allowed(p_server,a.user_id,a.address,a.created_at,a.server_id)
   AND public.verifier_privacy_visible(p_server,a.user_id,a.created_at)
 ) SELECT user_id,CASE WHEN bool_or(kind='current') THEN 'current' ELSE 'history' END FROM matches GROUP BY user_id;
$$;
CREATE OR REPLACE FUNCTION public.verifier_portal_wallet_audit(p_server text,p_users text[],p_member text,
 p_after text,p_limit integer DEFAULT 20,p_address text DEFAULT NULL,p_account_after text DEFAULT NULL,p_operator boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH eligible AS (
  SELECT unnest(p_users) AS user_id UNION SELECT user_id FROM public.verifier_user_roles WHERE server_id=p_server
  UNION SELECT user_id FROM public.verifier_member_actions WHERE server_id=p_server
 ), associations AS (
  SELECT w.user_id,w.address,w.wallet_type,CASE WHEN p_operator THEN w.created_at ELSE greatest(w.created_at,wc.associated_at,(SELECT share_since FROM public.verifier_privacy_choices WHERE server_id=p_server AND user_id=w.user_id)) END AS seen_at,w.last_verified_at AS proven_at,true AS current
  FROM public.user_wallets w JOIN eligible e USING(user_id)
  LEFT JOIN public.verifier_wallet_communities wc ON wc.user_id=w.user_id AND wc.address=w.address AND wc.server_id=p_server
  WHERE p_operator OR (public.verifier_wallet_community_allowed(p_server,w.user_id,w.address)
   AND public.verifier_privacy_visible(p_server,w.user_id,wc.shared_at))
  UNION ALL SELECT a.user_id,a.address,a.wallet_type,a.created_at,CASE WHEN p_operator OR public.verifier_privacy_visible(p_server,a.user_id,a.last_proven_at) THEN a.last_proven_at END,false
  FROM public.verifier_member_actions a JOIN eligible e USING(user_id)
  WHERE p_operator OR (public.verifier_wallet_community_allowed(p_server,a.user_id,a.address,a.created_at,a.server_id)
   AND ((SELECT source FROM public.verifier_wallet_communities c WHERE c.server_id=p_server AND c.user_id=a.user_id AND c.address=a.address)='legacy' OR a.server_id IS NOT NULL OR a.kind IN ('wallet_remove','wallet_transfer_out'))
   AND public.verifier_privacy_visible(p_server,a.user_id,a.created_at))
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

CREATE OR REPLACE FUNCTION public.verifier_bouncer_wallet_log() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE target text; event_kind text;
BEGIN
 IF NEW.kind='wallet_verify' THEN
  PERFORM public.verifier_enqueue_bouncer_log(NEW.server_id,NEW.user_id,'verification_success',NEW.source,p_event=>NEW.id,p_time=>NEW.created_at);
 ELSIF NEW.kind IN ('wallet_link','wallet_remove','wallet_transfer_out') THEN
  event_kind:=CASE WHEN NEW.kind='wallet_link' THEN 'wallet_added' ELSE 'wallet_removed' END;
  -- Account-wide link/removal events go only to communities with current sharing permission.
  FOR target IN SELECT c.server_id FROM public.verifier_privacy_choices c WHERE c.user_id=NEW.user_id
   AND public.verifier_wallet_community_allowed(c.server_id,NEW.user_id,NEW.address,NEW.created_at,NEW.server_id) LOOP
   PERFORM public.verifier_enqueue_bouncer_log(target,NEW.user_id,event_kind,NEW.source,p_event=>NEW.id,p_time=>NEW.created_at);
  END LOOP;
 END IF;
 RETURN NEW;
EXCEPTION WHEN OTHERS THEN
 RAISE LOG 'Bouncer wallet channel activity could not be queued'; RETURN NEW;
END $$;

-- Extend existing erasure transactions; do not create a separate retention clock.
DO $migration$
DECLARE body text;
BEGIN
 SELECT pg_get_functiondef('public.verifier_privacy_cleanup(integer)'::regprocedure) INTO body;
 IF position('DELETE FROM public.verifier_member_actions WHERE user_id=pair.user_id AND address=pair.address;' IN body)=0
 OR position('DELETE FROM public.verifier_privacy_choices WHERE user_id=r.user_id;' IN body)=0
 THEN RAISE EXCEPTION 'Unexpected privacy cleanup definition; review before migration'; END IF;
 body:=replace(body,'DELETE FROM public.verifier_member_actions WHERE user_id=pair.user_id AND address=pair.address;',
 'DELETE FROM public.verifier_wallet_communities WHERE user_id=pair.user_id AND address=pair.address;
  DELETE FROM public.verifier_wallet_community_events WHERE user_id=pair.user_id AND address=pair.address;
  DELETE FROM public.verifier_member_actions WHERE user_id=pair.user_id AND address=pair.address;');
 body:=replace(body,'DELETE FROM public.verifier_privacy_choices WHERE user_id=r.user_id;',
 'DELETE FROM public.verifier_wallet_communities WHERE user_id=r.user_id;
  DELETE FROM public.verifier_wallet_community_events WHERE user_id=r.user_id;
  DELETE FROM public.verifier_privacy_choices WHERE user_id=r.user_id;');
 body:=replace(body,'RETURN jsonb_build_object(''expired_associations'',expired,''deleted_accounts'',erased);',
 'FOR pair IN SELECT c.user_id,c.address FROM public.verifier_wallet_communities c
  WHERE c.removed_at<now()-interval ''1 year'' AND NOT EXISTS(SELECT 1 FROM public.user_wallets w WHERE w.user_id=c.user_id AND w.address=c.address)
  GROUP BY c.user_id,c.address LIMIT 100 LOOP
   PERFORM pg_advisory_xact_lock(hashtextextended(''member-wallet:''||pair.address,0));
   IF EXISTS(SELECT 1 FROM public.user_wallets WHERE user_id=pair.user_id AND address=pair.address) THEN CONTINUE; END IF;
   DELETE FROM public.verifier_wallet_communities WHERE user_id=pair.user_id AND address=pair.address;
   DELETE FROM public.verifier_wallet_community_events WHERE user_id=pair.user_id AND address=pair.address;
  END LOOP;
  RETURN jsonb_build_object(''expired_associations'',expired,''deleted_accounts'',erased);');
 EXECUTE body;
 SELECT pg_get_functiondef('public.verifier_privacy_reapply_deletions(jsonb)'::regprocedure) INTO body;
 IF position('UNION SELECT user_id FROM public.verifier_member_flows' IN body)=0 THEN RAISE EXCEPTION 'Unexpected deletion recovery definition'; END IF;
 body:=replace(body,'UNION SELECT user_id FROM public.verifier_member_flows','UNION SELECT user_id FROM public.verifier_wallet_communities UNION SELECT user_id FROM public.verifier_member_flows');
 EXECUTE body;
END $migration$;

-- Internal proof helpers and renamed implementations cannot be called directly.
REVOKE ALL ON FUNCTION public.verifier_associate_signed_wallet(text,text,text,uuid),
 public.verifier_wallet_community_lifecycle(),
 public.verifier_link_verified_wallet_before_communities(text,text,text,text,uuid,text,text,text,integer),
 public.verifier_member_link_wallet_before_communities(text,uuid,boolean,integer)
 FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.verifier_wallet_community_allowed(text,text,text,timestamptz,text),
 public.verifier_member_wallet_community(text,text,text,boolean,uuid),
 public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer),
 public.verifier_member_link_wallet(text,uuid,boolean,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_wallet_community_allowed(text,text,text,timestamptz,text),
 public.verifier_member_wallet_community(text,text,text,boolean,uuid),
 public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer),
 public.verifier_member_link_wallet(text,uuid,boolean,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
