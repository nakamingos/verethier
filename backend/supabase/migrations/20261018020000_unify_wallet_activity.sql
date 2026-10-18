BEGIN;
ALTER TABLE public.verifier_member_actions DROP CONSTRAINT verifier_member_actions_kind_check;
ALTER TABLE public.verifier_member_actions ADD CONSTRAINT verifier_member_actions_kind_check
 CHECK(kind IN ('wallet_link','wallet_remove','wallet_verify','wallet_transfer_out'));
ALTER TABLE public.verifier_member_actions
 ADD COLUMN source text NOT NULL DEFAULT 'portal' CHECK(source IN ('portal','discord')),
 ADD COLUMN server_id text, ADD COLUMN channel_id text, ADD COLUMN last_proven_at timestamptz;

-- Removal happens after its activity insert, so preserve the proof timestamp
-- while the original wallet row is still available. Older unknown dates stay null.
CREATE FUNCTION public.verifier_preserve_wallet_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.last_proven_at IS NULL THEN
  IF NEW.kind='wallet_link' THEN NEW.last_proven_at:=now();
  ELSIF NEW.kind IN ('wallet_remove','wallet_transfer_out') THEN
   SELECT last_verified_at INTO NEW.last_proven_at FROM public.user_wallets WHERE user_id=NEW.user_id AND address=NEW.address;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_wallet_proof_history BEFORE INSERT ON public.verifier_member_actions
 FOR EACH ROW EXECUTE FUNCTION public.verifier_preserve_wallet_proof();

-- Called only after the existing signature verifier consumes a fresh proof.
-- Wallet changes and their history commit together for either entry point.
CREATE FUNCTION public.verifier_link_verified_wallet(p_user text,p_address text,p_type text,p_name text,
 p_request uuid,p_source text,p_server text,p_channel text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior public.user_wallets; wallet public.user_wallets; action public.verifier_member_actions;
BEGIN
 IF p_source NOT IN ('portal','discord') OR p_source IS NULL THEN RAISE EXCEPTION 'Invalid activity source'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||p_address,0));
 SELECT * INTO action FROM public.verifier_member_actions WHERE id=p_request;
 IF FOUND THEN
  IF action.user_id<>p_user OR action.address<>p_address OR action.kind<>'wallet_link' THEN RAISE EXCEPTION 'Request conflict'; END IF;
  RETURN jsonb_build_object('success',true,'wasTransferred',action.transferred,'reconciliationQueued',true);
 END IF;
 IF EXISTS(SELECT 1 FROM public.verifier_wallet_blocks WHERE server_id=p_server AND address=p_address)
 THEN RAISE EXCEPTION 'Wallet blocked'; END IF;
 SELECT * INTO prior FROM public.user_wallets WHERE address=p_address FOR UPDATE;
 INSERT INTO public.user_wallets(user_id,address,wallet_type,user_name,last_verified_at)
 VALUES(p_user,p_address,p_type,p_name,now())
 ON CONFLICT(address) DO UPDATE SET user_id=excluded.user_id,user_name=excluded.user_name,last_verified_at=now()
 RETURNING * INTO wallet;
 IF prior.user_id IS DISTINCT FROM p_user THEN
  INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,transferred,source,server_id,channel_id)
  VALUES(p_request,p_user,'wallet_link',p_address,p_type,prior.user_id IS NOT NULL,p_source,p_server,p_channel);
 END IF;
 IF prior.user_id IS NOT NULL AND prior.user_id<>p_user THEN
  -- The previous owner sees the move, never the new owner's identity/context.
  INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,source,last_proven_at)
  VALUES(gen_random_uuid(),prior.user_id,'wallet_transfer_out',p_address,p_type,p_source,prior.last_verified_at);
  INSERT INTO public.verifier_reconciliation_jobs(member_action_id,server_id,user_id)
  SELECT p_request,server_id,prior.user_id FROM public.verifier_user_roles
  WHERE user_id=prior.user_id AND status IN ('active','revoked','expired') GROUP BY server_id;
 END IF;
 RETURN jsonb_build_object('success',true,'wallet',to_jsonb(wallet),'isNewAddress',prior.user_id IS NULL,
  'wasTransferred',coalesce(prior.user_id<>p_user,false),'reconciliationQueued',true);
END $$;

-- Portal links already record their own transaction; mirror moves to the old
-- owner's private history without exposing the destination account.
CREATE FUNCTION public.verifier_record_portal_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior_user text;
BEGIN
 IF NEW.kind='wallet_link' AND NEW.transferred AND NEW.source='portal' AND NEW.server_id IS NULL THEN
  SELECT user_id INTO prior_user FROM public.user_wallets WHERE address=NEW.address AND user_id<>NEW.user_id;
  IF prior_user IS NOT NULL THEN
   INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,source)
   VALUES(gen_random_uuid(),prior_user,'wallet_transfer_out',NEW.address,NEW.wallet_type,'portal');
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_portal_transfer_history AFTER INSERT ON public.verifier_member_actions
 FOR EACH ROW EXECUTE FUNCTION public.verifier_record_portal_transfer();
REVOKE ALL ON FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verifier_record_portal_transfer() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verifier_preserve_wallet_proof() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
