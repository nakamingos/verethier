BEGIN;
-- Saved ownership proofs remain intact. Absence from this table means active.
CREATE TABLE public.verifier_wallet_dormancy (
 user_id text NOT NULL, server_id text NOT NULL,
 address text NOT NULL REFERENCES public.user_wallets(address) ON DELETE CASCADE,
 network text NOT NULL CHECK(network IN ('ethereum','robinhood','base','solana','bitcoin')),
 last_proven_at timestamptz NOT NULL, empty_checked_at timestamptz NOT NULL DEFAULT now(),
 checked_rule_ids bigint[] NOT NULL,
 PRIMARY KEY(user_id,server_id,address,network)
);
ALTER TABLE public.verifier_wallet_dormancy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_wallet_dormancy FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.verifier_wallet_dormancy TO service_role;
CREATE INDEX verifier_wallet_dormancy_scope ON public.verifier_wallet_dormancy(server_id,network,address);

-- A wallet reassociation must never leave dormant records naming its old owner,
-- including maintenance paths outside the normal signed-link wrappers. Updating
-- the timestamp or label for the same owner deliberately does not reactivate it.
CREATE FUNCTION public.verifier_clear_transferred_wallet_dormancy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
  DELETE FROM public.verifier_wallet_dormancy WHERE address=OLD.address;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.verifier_clear_transferred_wallet_dormancy() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER verifier_clear_transferred_wallet_dormancy BEFORE UPDATE OF user_id ON public.user_wallets
 FOR EACH ROW EXECUTE FUNCTION public.verifier_clear_transferred_wallet_dormancy();

CREATE FUNCTION public.verifier_wallet_rule_network(r jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN r->>'asset_type' IN ('ordinal','stamp') THEN 'bitcoin'
 WHEN r->>'asset_type' IN ('solana_nft','solana_token') THEN 'solana'
 WHEN coalesce(r->>'asset_type','ethscription')='ethscription' THEN 'ethereum'
 WHEN (r->>'chain_id')::integer=4663 THEN 'robinhood'
 WHEN (r->>'chain_id')::integer=8453 THEN 'base' ELSE 'ethereum' END;
$$;
REVOKE ALL ON FUNCTION public.verifier_wallet_rule_network(jsonb) FROM PUBLIC,anon,authenticated;

-- Only the backend's complete successful zero-holdings audit calls this RPC.
-- Recheck the association, signature timestamp, rule definitions and worker
-- lease atomically; stale work cannot undo a newer signature or mark a new owner.
CREATE FUNCTION public.verifier_mark_wallet_dormant(p_user text,p_server text,p_address text,p_network text,
 p_proven_at timestamptz,p_rules jsonb,p_job uuid DEFAULT NULL,p_worker uuid DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE wallet public.user_wallets; actual jsonb; supplied jsonb; job public.verifier_bulk_role_jobs;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||p_address,0));
 SELECT * INTO wallet FROM public.user_wallets WHERE address=p_address FOR UPDATE;
 IF NOT FOUND OR wallet.user_id IS DISTINCT FROM p_user OR wallet.last_verified_at IS DISTINCT FROM p_proven_at THEN RETURN false; END IF;
 IF p_network NOT IN ('ethereum','robinhood','base','solana','bitcoin') OR p_network IS NULL THEN RETURN false; END IF;
 IF (p_network='bitcoin' AND wallet.wallet_type<>'bitcoin')
 OR (p_network='solana' AND wallet.wallet_type<>'solana')
 OR (p_network IN ('ethereum','robinhood','base') AND (wallet.wallet_type IS DISTINCT FROM 'evm'
  OR (wallet.evm_chain_ids IS NOT NULL AND NOT (CASE p_network WHEN 'ethereum' THEN 1 WHEN 'base' THEN 8453 ELSE 4663 END=ANY(wallet.evm_chain_ids))))) THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.verifier_privacy_deletions WHERE user_id=p_user AND status='processing') THEN RETURN false; END IF;
 IF p_job IS NOT NULL THEN
  SELECT * INTO job FROM public.verifier_bulk_role_jobs WHERE id=p_job FOR UPDATE;
  IF NOT FOUND OR job.server_id<>p_server OR job.status NOT IN ('pending','running') OR job.expires_at<=now() THEN RETURN false; END IF;
  PERFORM 1 FROM public.verifier_bulk_role_members WHERE job_id=p_job AND user_id=p_user AND status='running'
   AND locked_by=p_worker AND locked_until>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
 END IF;
 IF jsonb_typeof(p_rules) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rules)=0 THEN RETURN false; END IF;
 -- Prevent a concurrent definition edit from slipping between coverage and write.
 LOCK TABLE public.verifier_rules IN SHARE MODE;
 SELECT jsonb_agg(jsonb_build_object('id',r.id,'definition',public.verifier_portal_definition(to_jsonb(r))) ORDER BY r.id)
 INTO actual FROM public.verifier_rules r WHERE r.server_id=p_server AND public.verifier_wallet_rule_network(to_jsonb(r))=p_network
 AND (coalesce(r.asset_type,'ethscription')<>'ordinal' OR p_address ~ '^bc1p[0-9a-z]{58}$');
 SELECT jsonb_agg(jsonb_build_object('id',(r->>'id')::bigint,'definition',public.verifier_portal_definition(r)) ORDER BY (r->>'id')::bigint)
 INTO supplied FROM jsonb_array_elements(p_rules) r;
 IF actual IS NULL OR actual IS DISTINCT FROM supplied THEN RETURN false; END IF;
 INSERT INTO public.verifier_wallet_dormancy(user_id,server_id,address,network,last_proven_at,checked_rule_ids)
 VALUES(p_user,p_server,p_address,p_network,p_proven_at,ARRAY(SELECT (r->>'id')::bigint FROM jsonb_array_elements(p_rules) r ORDER BY (r->>'id')::bigint))
 ON CONFLICT(user_id,server_id,address,network) DO NOTHING;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.verifier_mark_wallet_dormant(text,text,text,text,timestamptz,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_mark_wallet_dormant(text,text,text,text,timestamptz,jsonb,uuid,uuid) TO service_role;

-- This helper is deliberately not callable by the API role. Only the existing
-- signature-consumption functions below can reactivate checking.
CREATE FUNCTION public.verifier_reactivate_signed_wallet(p_user text,p_address text,p_type text,p_server text,p_chain integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 DELETE FROM public.verifier_wallet_dormancy WHERE address=p_address AND user_id<>p_user;
 DELETE FROM public.verifier_wallet_dormancy WHERE user_id=p_user AND address=p_address
 AND (p_server IS NULL OR server_id=p_server)
 AND (CASE p_type WHEN 'bitcoin' THEN network='bitcoin' WHEN 'solana' THEN network='solana'
 ELSE network IN ('ethereum','robinhood','base') AND (p_chain IS NULL OR network=CASE p_chain WHEN 1 THEN 'ethereum' WHEN 8453 THEN 'base' WHEN 4663 THEN 'robinhood' END) END);
END $$;
REVOKE ALL ON FUNCTION public.verifier_reactivate_signed_wallet(text,text,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the existing proof, privacy, block and transfer implementation.
ALTER FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer) RENAME TO verifier_link_verified_wallet_before_dormancy;
REVOKE ALL ON FUNCTION public.verifier_link_verified_wallet_before_dormancy(text,text,text,text,uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.verifier_link_verified_wallet(p_user text,p_address text,p_type text,p_name text,
 p_request uuid,p_source text,p_server text,p_channel text,p_chain integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb;
BEGIN
 result:=public.verifier_link_verified_wallet_before_dormancy(p_user,p_address,p_type,p_name,p_request,p_source,p_server,p_channel,p_chain);
 -- An idempotent replay returns success without a wallet: it is not a new proof.
 IF result->>'success'='true' AND result ? 'wallet' THEN
  PERFORM public.verifier_reactivate_signed_wallet(p_user,p_address,p_type,p_server,p_chain);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer) TO service_role;

ALTER FUNCTION public.verifier_member_link_wallet(text,uuid,boolean,integer) RENAME TO verifier_member_link_wallet_before_dormancy;
REVOKE ALL ON FUNCTION public.verifier_member_link_wallet_before_dormancy(text,uuid,boolean,integer) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.verifier_member_link_wallet(p_user text,p_flow uuid,p_transfer boolean,p_chain integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result jsonb; flow public.verifier_member_flows;
BEGIN
 result:=public.verifier_member_link_wallet_before_dormancy(p_user,p_flow,p_transfer,p_chain);
 IF result->>'linked'='true' THEN
  SELECT * INTO STRICT flow FROM public.verifier_member_flows WHERE id=p_flow AND user_id=p_user AND completed_at IS NOT NULL;
  PERFORM public.verifier_reactivate_signed_wallet(p_user,flow.address,flow.wallet_type,flow.server_id,p_chain);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.verifier_member_link_wallet(text,uuid,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_member_link_wallet(text,uuid,boolean,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
