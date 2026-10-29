BEGIN;
-- Existing EOA/Bitcoin links retain their meaning. Contract proofs list only the
-- chains on which ERC-1271 was checked; no signature or new personal data is stored.
ALTER TABLE public.user_wallets ADD COLUMN evm_chain_ids integer[];
ALTER TABLE public.user_wallets ADD CONSTRAINT user_wallets_evm_scope_check CHECK (
 evm_chain_ids IS NULL OR (wallet_type='evm' AND cardinality(evm_chain_ids)>0
 AND array_position(evm_chain_ids,NULL) IS NULL AND evm_chain_ids <@ ARRAY[1,8453,4663]));

CREATE FUNCTION public.verifier_wallet_scope(p_prior public.user_wallets,p_user text,p_chain integer)
RETURNS integer[] LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_chain IS NULL THEN RETURN NULL; END IF;
 IF p_chain NOT IN (1,8453,4663) THEN RAISE EXCEPTION 'Invalid wallet proof network'; END IF;
 IF p_prior.user_id=p_user THEN
  IF p_prior.evm_chain_ids IS NULL THEN RETURN NULL; END IF;
  RETURN ARRAY(SELECT DISTINCT c FROM unnest(p_prior.evm_chain_ids || p_chain) c ORDER BY c);
 END IF;
 RETURN ARRAY[p_chain];
END $$;
REVOKE ALL ON FUNCTION public.verifier_wallet_scope(public.user_wallets,text,integer) FROM PUBLIC,anon,authenticated;

DROP FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text);
DROP FUNCTION public.verifier_member_link_wallet(text,uuid,boolean);
CREATE FUNCTION public.verifier_link_verified_wallet(p_user text,p_address text,p_type text,p_name text,
 p_request uuid,p_source text,p_server text,p_channel text,p_chain integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE prior public.user_wallets; wallet public.user_wallets; action public.verifier_member_actions;
BEGIN
 IF p_type<>'evm' AND p_chain IS NOT NULL THEN RAISE EXCEPTION 'Invalid wallet proof type'; END IF;
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
 INSERT INTO public.user_wallets(user_id,address,wallet_type,user_name,last_verified_at,evm_chain_ids)
 VALUES(p_user,p_address,p_type,p_name,now(),public.verifier_wallet_scope(prior,p_user,p_chain))
 ON CONFLICT(address) DO UPDATE SET user_id=excluded.user_id,user_name=excluded.user_name,last_verified_at=now(),evm_chain_ids=excluded.evm_chain_ids
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

CREATE FUNCTION public.verifier_member_link_wallet(p_user text,p_flow uuid,p_transfer boolean,p_chain integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE flow public.verifier_member_flows; prior public.user_wallets;
BEGIN
 SELECT * INTO flow FROM public.verifier_member_flows WHERE user_id=p_user AND id=p_flow FOR UPDATE;
 IF NOT FOUND OR flow.purpose<>'wallet_link' OR flow.completed_at IS NOT NULL OR flow.expires_at<=now()
 THEN RAISE EXCEPTION 'Wallet proof expired'; END IF;
 IF p_chain IS NOT NULL AND (flow.wallet_type<>'evm' OR (flow.challenge->'domain'->>'chainId')::integer IS DISTINCT FROM p_chain)
 THEN RAISE EXCEPTION 'Wallet proof network changed'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||flow.address,0));
 SELECT * INTO prior FROM public.user_wallets WHERE address=flow.address FOR UPDATE;
 IF prior.user_id IS NOT NULL AND prior.user_id<>p_user AND NOT coalesce(p_transfer,false) THEN
  RETURN jsonb_build_object('requiresTransfer',true);
 END IF;
 IF flow.server_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.verifier_wallet_blocks WHERE server_id=flow.server_id AND address=flow.address)
 THEN RAISE EXCEPTION 'Wallet blocked'; END IF;
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,transferred)
 VALUES(flow.id,p_user,'wallet_link',flow.address,flow.wallet_type,coalesce(prior.user_id<>p_user,false));
 INSERT INTO public.user_wallets(user_id,address,wallet_type,last_verified_at,evm_chain_ids)
 VALUES(p_user,flow.address,flow.wallet_type,now(),public.verifier_wallet_scope(prior,p_user,p_chain))
 ON CONFLICT(address) DO UPDATE SET user_id=excluded.user_id,user_name=NULL,last_verified_at=now(),evm_chain_ids=excluded.evm_chain_ids;
 IF prior.user_id IS NOT NULL AND prior.user_id<>p_user THEN
  INSERT INTO public.verifier_reconciliation_jobs(member_action_id,server_id,user_id)
  SELECT flow.id,server_id,prior.user_id FROM public.verifier_user_roles
  WHERE user_id=prior.user_id AND status IN ('active','revoked','expired') GROUP BY server_id;
 END IF;
 UPDATE public.verifier_member_flows SET completed_at=now() WHERE id=flow.id;
 RETURN jsonb_build_object('linked',true,'transferred',coalesce(prior.user_id<>p_user,false));
END $$;

REVOKE ALL ON FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verifier_member_link_wallet(text,uuid,boolean,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_link_verified_wallet(text,text,text,text,uuid,text,text,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.verifier_member_link_wallet(text,uuid,boolean,integer) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
