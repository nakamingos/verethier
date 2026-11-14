-- The original schema granted the public anon and authenticated roles full
-- privileges on its tables and sequences, relying on RLS (with no policies)
-- alone to block access. Later tables revoke these grants explicitly; apply the
-- same rule here. Only the backend's service_role key reads or writes them.
-- Legacy tables are included when they still exist.
DO $$
DECLARE
  tab text;
  seq text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['user_wallets','verifier_rules','verifier_user_roles','verifier_servers','verifier_users'] LOOP
    IF to_regclass('public.' || tab) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab);
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', tab);
      EXECUTE format('GRANT ALL ON public.%I TO service_role', tab);
    END IF;
  END LOOP;

  FOREACH seq IN ARRAY ARRAY['user_wallets_id_seq','verifier_rules_id_seq','verifier_user_roles_id_seq'] LOOP
    IF to_regclass('public.' || seq) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated', seq);
      EXECUTE format('GRANT ALL ON SEQUENCE public.%I TO service_role', seq);
    END IF;
  END LOOP;
END $$;
