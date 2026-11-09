BEGIN;
-- Rule-save jobs must not consume wallet-inventory providers for Ordinals.
ALTER TABLE public.verifier_reconciliation_jobs ADD COLUMN ordinal_provider_policy text
 CHECK(ordinal_provider_policy IS NULL OR ordinal_provider_policy='ordnet-only');

CREATE FUNCTION public.verifier_ordnet_compatible(r jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN r->>'asset_type' IS DISTINCT FROM 'ordinal' THEN true
 WHEN r->'inscription_criteria' IS NULL OR r->'inscription_criteria'='null'::jsonb
 THEN coalesce(r->>'slug'<>'all' AND r->>'slug' ~ '^[a-z0-9][a-z0-9._-]{0,99}$',false)
 ELSE coalesce(r->'inscription_criteria'->>'kind'='numbers'
  AND r->'inscription_criteria'->>'collection_slug'<>'all'
  AND r->'inscription_criteria'->>'collection_slug' ~ '^[a-z0-9][a-z0-9._-]{0,99}$',false) END;
$$;

CREATE FUNCTION public.verifier_rule_save_provider_policy() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 -- Explicit member repairs, restrictions, role actions and other jobs retain
 -- their existing provider policy. Retry may preserve an earlier strict policy.
 IF NEW.action_id IS NULL OR NEW.role_id IS NULL OR NEW.user_id IS NOT NULL OR NEW.role_action_role_id IS NOT NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.verifier_portal_actions a WHERE a.id=NEW.action_id
  AND a.server_id=NEW.server_id AND a.kind IN ('create','edit','delete','reverse')) THEN RETURN NEW; END IF;
 -- Include every alternative and combined rule, including additional outputs.
 -- Never evaluate an incomplete set of requirements as proof of failure.
 IF EXISTS(SELECT 1 FROM public.verifier_rules r WHERE r.server_id=NEW.server_id
  AND NEW.role_id=ANY(public.verifier_rule_role_ids(to_jsonb(r)))
  AND NOT public.verifier_ordnet_compatible(to_jsonb(r))) THEN RETURN NULL; END IF;
 NEW.ordinal_provider_policy:='ordnet-only';
 RETURN NEW;
END $$;
CREATE TRIGGER verifier_rule_save_provider_policy BEFORE INSERT ON public.verifier_reconciliation_jobs
 FOR EACH ROW EXECUTE FUNCTION public.verifier_rule_save_provider_policy();
REVOKE ALL ON FUNCTION public.verifier_ordnet_compatible(jsonb),public.verifier_rule_save_provider_policy() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verifier_ordnet_compatible(jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
