DO $$
DECLARE t regclass:='public.verifier_blocked_verification_attempts'::regclass; r record; before_wallets bigint; before_actions bigint;
BEGIN
 SELECT count(*) INTO before_wallets FROM public.user_wallets;
 SELECT count(*) INTO before_actions FROM public.verifier_member_actions;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=t) THEN RAISE EXCEPTION 'Missing RLS'; END IF;
 IF has_table_privilege('anon',t,'SELECT') OR has_table_privilege('authenticated',t,'SELECT') OR has_table_privilege('anon',t,'INSERT') OR has_table_privilege('authenticated',t,'INSERT') THEN RAISE EXCEPTION 'Private attempt table exposed'; END IF;
 IF NOT (has_table_privilege('service_role',t,'SELECT') AND has_table_privilege('service_role',t,'INSERT') AND has_table_privilege('service_role',t,'DELETE')) OR has_table_privilege('service_role',t,'UPDATE') THEN RAISE EXCEPTION 'Audit grants incorrect'; END IF;
 INSERT INTO public.verifier_blocked_verification_attempts(user_id,server_id,address,wallet_type,source,chain_id)
 VALUES ('111111111111111111','222222222222222222','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','evm','discord',8453) RETURNING * INTO r;
 IF r.outcome<>'blocked' OR r.expires_at<>r.created_at+interval '1 year' THEN RAISE EXCEPTION 'Incorrect default outcome/retention'; END IF;
 INSERT INTO public.verifier_blocked_verification_attempts(user_id,server_id,address,wallet_type,source)
 VALUES ('111111111111111111','222222222222222222','So11111111111111111111111111111111111111112','solana','portal');
 IF NOT EXISTS(SELECT 1 FROM public.verifier_blocked_verification_attempts WHERE address='So11111111111111111111111111111111111111112') THEN RAISE EXCEPTION 'Solana case lost'; END IF;
 BEGIN
  INSERT INTO public.verifier_blocked_verification_attempts(user_id,server_id,address,wallet_type,source)
  VALUES ('u','s','wallet','evm','discord');
  RAISE EXCEPTION 'Missing EVM chain accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.verifier_blocked_verification_attempts(user_id,server_id,address,wallet_type,source,chain_id)
  VALUES ('u','s','wallet','bitcoin','discord',1);
  RAISE EXCEPTION 'Bitcoin chain accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.verifier_blocked_verification_attempts(user_id,server_id,address,wallet_type,source,outcome)
  VALUES ('u','s','wallet','solana','discord','verified');
  RAISE EXCEPTION 'Successful outcome accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.verifier_blocked_verification_attempts(user_id,server_id,address,wallet_type,source,created_at,expires_at)
 VALUES ('expired','s','wallet','solana','discord',now()-interval '1 year'-interval '1 day',now()-interval '1 day');
 DELETE FROM public.verifier_blocked_verification_attempts WHERE expires_at<now();
 IF EXISTS(SELECT 1 FROM public.verifier_blocked_verification_attempts WHERE user_id='expired') OR NOT EXISTS(SELECT 1 FROM public.verifier_blocked_verification_attempts WHERE user_id='111111111111111111') THEN RAISE EXCEPTION 'Expiry cleanup incorrect'; END IF;
 IF (SELECT count(*) FROM public.user_wallets)<>before_wallets OR (SELECT count(*) FROM public.verifier_member_actions)<>before_actions THEN RAISE EXCEPTION 'Attempt created an ordinary wallet association'; END IF;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='verifier_blocked_verification_attempts' AND column_name IN ('nonce','signature','challenge','ip_address','user_agent')) THEN RAISE EXCEPTION 'Unneeded sensitive audit fields'; END IF;
END $$;
