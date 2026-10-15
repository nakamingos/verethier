BEGIN;

CREATE FUNCTION public.ordinal_attribute_values_valid(p_values jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE trait record; entry jsonb; n integer := 0;
BEGIN
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  FOR trait IN SELECT * FROM jsonb_each(p_values) LOOP
    n := n + 1;
    IF n > 100 OR char_length(trait.key) NOT BETWEEN 1 AND 100 OR btrim(trait.key) = '' THEN RETURN false; END IF;
    IF jsonb_typeof(trait.value) = 'string' THEN
      IF char_length(trait.value #>> '{}') NOT BETWEEN 1 AND 100 OR btrim(trait.value #>> '{}') = '' THEN RETURN false; END IF;
    ELSIF jsonb_typeof(trait.value) = 'array' THEN
      IF jsonb_array_length(trait.value) NOT BETWEEN 1 AND 100 THEN RETURN false; END IF;
      FOR entry IN SELECT * FROM jsonb_array_elements(trait.value) LOOP
        IF jsonb_typeof(entry) IS DISTINCT FROM 'string' OR char_length(entry #>> '{}') NOT BETWEEN 1 AND 100
          OR btrim(entry #>> '{}') = '' THEN RETURN false; END IF;
      END LOOP;
    ELSE RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

-- Catalog data is shared across servers. Ownership and number mappings are not stored.
CREATE TABLE public.ordinal_collections (
  slug text PRIMARY KEY CHECK (slug <> 'all' AND slug ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  fetched_at timestamptz NOT NULL,
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 20000)
);

-- Match the market's slug + JSONB values pattern; IDs identify Ordinals directly.
CREATE TABLE public.ordinal_collection_attributes (
  slug text NOT NULL REFERENCES public.ordinal_collections(slug) ON DELETE CASCADE,
  inscription_id text NOT NULL CHECK (inscription_id ~ '^[0-9a-f]{64}i[0-9]+$'),
  "values" jsonb NOT NULL CHECK (public.ordinal_attribute_values_valid("values")),
  PRIMARY KEY (slug, inscription_id)
);
CREATE INDEX ordinal_collection_attributes_values_idx ON public.ordinal_collection_attributes USING gin ("values");

-- A conservative per-installation cap survives restarts. The provider enforces its account quota too.
CREATE TABLE public.ordinal_provider_usage (
  provider text NOT NULL CHECK (provider = 'ordiscan'),
  period date NOT NULL,
  requests integer NOT NULL CHECK (requests BETWEEN 1 AND 1000),
  PRIMARY KEY (provider, period)
);

ALTER TABLE public.ordinal_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordinal_collection_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ordinal_provider_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ordinal_collections, public.ordinal_collection_attributes, public.ordinal_provider_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ordinal_collections, public.ordinal_collection_attributes, public.ordinal_provider_usage TO service_role;

-- One SQL snapshot avoids PostgREST's row cap and mixed versions during a refresh.
CREATE FUNCTION public.get_ordinal_collection(p_slug text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('slug', c.slug, 'fetched_at', c.fetched_at, 'item_count', c.item_count,
    'items', (SELECT jsonb_agg(jsonb_build_object('inscription_id', a.inscription_id, 'values', a.values) ORDER BY a.inscription_id)
      FROM public.ordinal_collection_attributes a WHERE a.slug = c.slug))
  FROM public.ordinal_collections c WHERE c.slug = p_slug;
$$;

CREATE FUNCTION public.replace_ordinal_collection(p_slug text, p_fetched_at timestamptz, p_items jsonb)
RETURNS boolean LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  IF p_slug IS NULL OR p_slug = 'all' OR p_slug !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
    OR p_fetched_at IS NULL OR p_fetched_at > now() + interval '5 minutes'
    OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid Ordinals collection catalog';
  END IF;
  n := jsonb_array_length(p_items);
  IF n NOT BETWEEN 1 AND 20000 OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) i
    WHERE jsonb_typeof(i) IS DISTINCT FROM 'object'
      OR jsonb_typeof(i->'inscription_id') IS DISTINCT FROM 'string'
      OR (i->>'inscription_id') !~ '^[0-9a-f]{64}i[0-9]+$'
      OR NOT public.ordinal_attribute_values_valid(i->'values')
  ) OR (SELECT count(DISTINCT i->>'inscription_id') FROM jsonb_array_elements(p_items) i) <> n THEN
    RAISE EXCEPTION 'Incomplete or invalid Ordinals collection catalog';
  END IF;
  -- Serialize refresh writers; an older scan cannot replace a newer catalog.
  PERFORM pg_advisory_xact_lock(hashtextextended('ordinal-catalog:' || p_slug, 0));
  IF EXISTS (SELECT 1 FROM public.ordinal_collections WHERE slug = p_slug AND fetched_at >= p_fetched_at) THEN
    RETURN false;
  END IF;
  INSERT INTO public.ordinal_collections (slug, fetched_at, item_count) VALUES (p_slug, p_fetched_at, n)
    ON CONFLICT (slug) DO UPDATE SET fetched_at = EXCLUDED.fetched_at, item_count = EXCLUDED.item_count;
  DELETE FROM public.ordinal_collection_attributes WHERE slug = p_slug;
  INSERT INTO public.ordinal_collection_attributes (slug, inscription_id, "values")
    SELECT p_slug, i->>'inscription_id', i->'values' FROM jsonb_array_elements(p_items) i;
  RETURN true;
END;
$$;

CREATE FUNCTION public.reserve_ordinal_provider_request() RETURNS boolean
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE used integer;
BEGIN
  INSERT INTO public.ordinal_provider_usage (provider, period, requests)
    VALUES ('ordiscan', date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1)
    ON CONFLICT (provider, period) DO UPDATE SET requests = public.ordinal_provider_usage.requests + 1
      WHERE public.ordinal_provider_usage.requests < 1000
    RETURNING requests INTO used;
  RETURN used IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.get_ordinal_collection(text),
  public.replace_ordinal_collection(text, timestamptz, jsonb), public.reserve_ordinal_provider_request(),
  public.ordinal_attribute_values_valid(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ordinal_collection(text),
  public.replace_ordinal_collection(text, timestamptz, jsonb), public.reserve_ordinal_provider_request(),
  public.ordinal_attribute_values_valid(jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
