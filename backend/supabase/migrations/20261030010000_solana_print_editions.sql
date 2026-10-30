BEGIN;
-- Add explicit print-edition scope without changing any existing rule or wallet.
CREATE OR REPLACE FUNCTION public.verifier_solana_criteria_valid(c jsonb,t text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; addresses text[]; formats text[];
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' THEN RETURN false; END IF;
 IF t='solana_token' THEN
  RETURN c->>'kind'='token' AND c ?& ARRAY['kind','mint','program'] AND (c-ARRAY['kind','mint','program'])='{}'::jsonb
   AND jsonb_typeof(c->'mint')='string' AND c->>'mint' ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
   AND c->>'program' IN ('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
 END IF;
 IF t<>'solana_nft' OR c->>'kind' NOT IN ('collection','verified_creator','asset_ids','master_edition')
  OR NOT c ?& ARRAY['kind','addresses','formats'] OR (c-ARRAY['kind','addresses','formats'])<>'{}'::jsonb
  OR jsonb_typeof(c->'addresses')<>'array' OR jsonb_typeof(c->'formats')<>'array' THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(c->'addresses') LOOP
  IF jsonb_typeof(item)<>'string' OR item#>>'{}' !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' THEN RETURN false; END IF;
 END LOOP;
 SELECT array_agg(v ORDER BY v COLLATE "C") INTO addresses FROM (SELECT DISTINCT jsonb_array_elements_text(c->'addresses') v) s;
 IF coalesce(cardinality(addresses),0) NOT BETWEEN 1 AND (CASE WHEN c->>'kind'='asset_ids' THEN 1000 ELSE 20 END)
   OR to_jsonb(addresses) IS DISTINCT FROM c->'addresses' THEN RETURN false; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(c->'formats') LOOP
  IF jsonb_typeof(item)<>'string' OR item#>>'{}' NOT IN ('metadata','core','compressed') THEN RETURN false; END IF;
 END LOOP;
 SELECT array_agg(v ORDER BY v COLLATE "C") INTO formats FROM (SELECT DISTINCT jsonb_array_elements_text(c->'formats') v) s;
 RETURN coalesce(cardinality(formats),0) BETWEEN 1 AND 3 AND to_jsonb(formats)=c->'formats'
  AND (c->>'kind'<>'master_edition' OR formats=ARRAY['metadata']);
END $$;
REVOKE ALL ON FUNCTION public.verifier_solana_criteria_valid(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_solana_criteria_valid(jsonb,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
