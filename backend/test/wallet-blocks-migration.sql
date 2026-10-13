BEGIN;
DO $$
DECLARE statement text;
BEGIN
  INSERT INTO public.verifier_wallet_blocks(server_id,address,wallet_type,blocked_by,reason) VALUES
    ('1369930881267142686','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','evm','585432476332064769','Shared asset'),
    ('1369930881267142687','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','evm','585432476332064769',NULL),
    ('1369930881267142686','bc1pmvcm86a0c4ut8q3fxsdvry8gr99gkwk7ep4a9anwqx3p9mpfpgjs6rxd5m','bitcoin','585432476332064769',NULL);
  BEGIN
    INSERT INTO public.verifier_wallet_blocks(server_id,address,wallet_type,blocked_by) VALUES
      ('1369930881267142686','0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','evm','585432476332064769');
    RAISE EXCEPTION 'Duplicate server/address block accepted';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  FOREACH statement IN ARRAY ARRAY[
    $q$UPDATE public.verifier_wallet_blocks SET address='0x123'$q$,
    $q$UPDATE public.verifier_wallet_blocks SET address='0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'$q$,
    $q$UPDATE public.verifier_wallet_blocks SET wallet_type='bitcoin' WHERE wallet_type='evm'$q$,
    $q$UPDATE public.verifier_wallet_blocks SET wallet_type='evm' WHERE wallet_type='bitcoin'$q$,
    $q$UPDATE public.verifier_wallet_blocks SET wallet_type='other'$q$,
    $q$UPDATE public.verifier_wallet_blocks SET server_id='other'$q$,
    $q$UPDATE public.verifier_wallet_blocks SET blocked_by='other'$q$,
    $q$UPDATE public.verifier_wallet_blocks SET reason=repeat('x',201)$q$,
    $q$UPDATE public.verifier_wallet_blocks SET reason=' '$q$
  ] LOOP
    BEGIN EXECUTE statement; RAISE EXCEPTION 'Malformed block accepted: %',statement;
    EXCEPTION WHEN check_violation THEN NULL; END;
  END LOOP;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.verifier_wallet_blocks'::regclass) THEN
    RAISE EXCEPTION 'Wallet restriction RLS is disabled';
  END IF;
END;
$$;

SET LOCAL ROLE anon;
DO $$
BEGIN
  BEGIN PERFORM address FROM public.verifier_wallet_blocks; RAISE EXCEPTION 'Anonymous block read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN DELETE FROM public.verifier_wallet_blocks; RAISE EXCEPTION 'Anonymous unblock allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN PERFORM address FROM public.verifier_wallet_blocks; RAISE EXCEPTION 'Authenticated user block read allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN UPDATE public.verifier_wallet_blocks SET reason='test'; RAISE EXCEPTION 'Authenticated block edit allowed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;

SET LOCAL ROLE service_role;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.verifier_wallet_blocks) <> 3 THEN RAISE EXCEPTION 'Service-role read failed'; END IF;
END;
$$;
DELETE FROM public.verifier_wallet_blocks WHERE server_id='1369930881267142687';
DO $$
BEGIN
  IF (SELECT count(*) FROM public.verifier_wallet_blocks) <> 2 THEN RAISE EXCEPTION 'Server-scoped unblock failed'; END IF;
END;
$$;
RESET ROLE;
ROLLBACK;
