-- Run after the single-collection migration, in a disposable restored database.
BEGIN;
DO $$
DECLARE target bigint;
BEGIN
  SELECT id INTO STRICT target FROM public.verifier_rules WHERE asset_type='ethscription' AND inscription_criteria IS NULL LIMIT 1;
  BEGIN
    UPDATE public.verifier_rules SET slug='one,two' WHERE id=target;
    RAISE EXCEPTION 'Database accepted a multi-collection rule';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.verifier_rules WHERE position(',' in slug)>0) THEN
    RAISE EXCEPTION 'Multi-collection definitions remain';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.verifier_rules'::regclass
    AND conname='verifier_rules_single_collection' AND convalidated) THEN
    RAISE EXCEPTION 'Single-collection constraint missing or unvalidated';
  END IF;
END $$;
ROLLBACK;
