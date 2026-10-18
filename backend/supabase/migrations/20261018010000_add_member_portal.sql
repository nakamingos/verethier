BEGIN;
CREATE TABLE public.verifier_member_flows (
 user_id text PRIMARY KEY, id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
 purpose text NOT NULL CHECK(purpose IN ('wallet_link','verify')),
 server_id text, channel_id text, nonce text,
 address text, wallet_type text CHECK(wallet_type IN ('evm','bitcoin')), challenge jsonb,
 expires_at timestamptz NOT NULL, completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((purpose='verify' AND server_id IS NOT NULL AND channel_id IS NOT NULL AND nonce IS NOT NULL)
    OR (purpose='wallet_link' AND address IS NOT NULL AND wallet_type IS NOT NULL AND challenge IS NOT NULL))
);
CREATE TABLE public.verifier_member_actions (
 id uuid PRIMARY KEY, user_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('wallet_link','wallet_remove')),
 address text NOT NULL, wallet_type text NOT NULL, transferred boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.verifier_member_actions(user_id,created_at DESC);
ALTER TABLE public.verifier_reconciliation_jobs ADD COLUMN member_action_id uuid REFERENCES public.verifier_member_actions(id);
CREATE INDEX ON public.verifier_reconciliation_jobs(member_action_id) WHERE member_action_id IS NOT NULL;
ALTER TABLE public.verifier_member_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.verifier_member_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verifier_member_flows,public.verifier_member_actions FROM anon,authenticated;
GRANT ALL ON public.verifier_member_flows,public.verifier_member_actions TO service_role;

-- The verified proof is checked by the backend against this exact stored flow.
-- Consumption, link/transfer, action and checks commit together or all roll back.
CREATE FUNCTION public.verifier_member_link_wallet(p_user text,p_flow uuid,p_transfer boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE flow public.verifier_member_flows; prior public.user_wallets;
BEGIN
 SELECT * INTO flow FROM public.verifier_member_flows WHERE user_id=p_user AND id=p_flow FOR UPDATE;
 IF NOT FOUND OR flow.purpose<>'wallet_link' OR flow.completed_at IS NOT NULL OR flow.expires_at<=now()
 THEN RAISE EXCEPTION 'Wallet proof expired'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||flow.address,0));
 SELECT * INTO prior FROM public.user_wallets WHERE address=flow.address FOR UPDATE;
 IF prior.user_id IS NOT NULL AND prior.user_id<>p_user AND NOT coalesce(p_transfer,false) THEN
  RETURN jsonb_build_object('requiresTransfer',true);
 END IF;
 IF flow.server_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.verifier_wallet_blocks WHERE server_id=flow.server_id AND address=flow.address)
 THEN RAISE EXCEPTION 'Wallet blocked'; END IF;
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type,transferred)
 VALUES(flow.id,p_user,'wallet_link',flow.address,flow.wallet_type,coalesce(prior.user_id<>p_user,false));
 INSERT INTO public.user_wallets(user_id,address,wallet_type,last_verified_at)
 VALUES(p_user,flow.address,flow.wallet_type,now())
 ON CONFLICT(address) DO UPDATE SET user_id=excluded.user_id,user_name=NULL,last_verified_at=now();
 IF prior.user_id IS NOT NULL AND prior.user_id<>p_user THEN
  INSERT INTO public.verifier_reconciliation_jobs(member_action_id,server_id,user_id)
  SELECT flow.id,server_id,prior.user_id FROM public.verifier_user_roles
  WHERE user_id=prior.user_id AND status IN ('active','revoked','expired') GROUP BY server_id;
 END IF;
 UPDATE public.verifier_member_flows SET completed_at=now() WHERE id=flow.id;
 RETURN jsonb_build_object('linked',true,'transferred',coalesce(prior.user_id<>p_user,false));
END $$;

CREATE FUNCTION public.verifier_member_remove_wallet(p_user text,p_address text,p_request uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE wallet public.user_wallets; action public.verifier_member_actions;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('member-wallet:'||p_address,0));
 SELECT * INTO action FROM public.verifier_member_actions WHERE id=p_request;
 IF FOUND THEN
  IF action.user_id<>p_user OR action.address<>p_address OR action.kind<>'wallet_remove' THEN RAISE EXCEPTION 'Request conflict'; END IF;
  RETURN jsonb_build_object('removed',true);
 END IF;
 SELECT * INTO wallet FROM public.user_wallets WHERE user_id=p_user AND address=p_address FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Wallet no longer linked'; END IF;
 INSERT INTO public.verifier_member_actions(id,user_id,kind,address,wallet_type)
 VALUES(p_request,p_user,'wallet_remove',wallet.address,wallet.wallet_type);
 DELETE FROM public.user_wallets WHERE id=wallet.id AND user_id=p_user;
 INSERT INTO public.verifier_reconciliation_jobs(member_action_id,server_id,user_id)
 SELECT p_request,server_id,p_user FROM public.verifier_user_roles
 WHERE user_id=p_user AND status IN ('active','revoked','expired') GROUP BY server_id;
 RETURN jsonb_build_object('removed',true);
END $$;
REVOKE ALL ON FUNCTION public.verifier_member_link_wallet(text,uuid,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.verifier_member_remove_wallet(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_member_link_wallet(text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.verifier_member_remove_wallet(text,text,uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
