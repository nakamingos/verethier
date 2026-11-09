BEGIN;
-- Permit small selections to contribute toward larger combined role minimums.
CREATE OR REPLACE FUNCTION public.verifier_inscription_criteria_valid(criteria jsonb, asset text, minimum bigint)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
DECLARE
  entry jsonb;
  identifier text;
  previous_id text;
  start_number numeric;
  end_number numeric;
  previous_end numeric;
BEGIN
  IF jsonb_typeof(criteria) IS DISTINCT FROM 'object' OR asset NOT IN ('ordinal', 'ethscription')
    OR minimum NOT BETWEEN 1 AND 9007199254740991 THEN RETURN false; END IF;
  IF criteria->>'kind' = 'ids' THEN
    IF criteria - 'kind' - 'ids' <> '{}'::jsonb OR jsonb_typeof(criteria->'ids') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(criteria->'ids') NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(criteria->'ids') LOOP
      IF jsonb_typeof(entry) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
      identifier := entry #>> '{}';
      IF (asset = 'ordinal' AND identifier !~ '^[0-9a-f]{64}i(0|[1-9][0-9]*)$')
        OR (asset = 'ethscription' AND identifier !~ '^0x[0-9a-f]{64}$')
        OR (previous_id IS NOT NULL AND previous_id COLLATE "C" >= identifier COLLATE "C") THEN RETURN false; END IF;
      previous_id := identifier;
    END LOOP;
  ELSIF criteria->>'kind' = 'numbers' THEN
    IF criteria - 'kind' - 'ranges' <> '{}'::jsonb OR jsonb_typeof(criteria->'ranges') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    IF jsonb_array_length(criteria->'ranges') NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
    FOR entry IN SELECT value FROM jsonb_array_elements(criteria->'ranges') LOOP
      IF jsonb_typeof(entry) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
      IF jsonb_array_length(entry) <> 2 THEN RETURN false; END IF;
      IF jsonb_typeof(entry->0) IS DISTINCT FROM 'number' OR jsonb_typeof(entry->1) IS DISTINCT FROM 'number'
        OR (entry->>0) !~ '^-?(0|[1-9][0-9]*)$' OR (entry->>1) !~ '^-?(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
      start_number := (entry->>0)::numeric;
      end_number := (entry->>1)::numeric;
      IF start_number < -9007199254740991 OR end_number > 9007199254740991 OR start_number > end_number
        OR (asset = 'ethscription' AND start_number < 0)
        OR (previous_end IS NOT NULL AND start_number <= previous_end + 1) THEN RETURN false; END IF;
      previous_end := end_number;
    END LOOP;
  ELSE RETURN false;
  END IF;
  -- A selection can contribute to the shared minimum with other rules.
  RETURN true;
END;
$$;

NOTIFY pgrst,'reload schema';
COMMIT;
