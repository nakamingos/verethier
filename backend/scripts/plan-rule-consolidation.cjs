// Generate a private, reviewable transaction from a backed-up rules snapshot.
// Build the backend first. This script never connects to or mutates a database.
const fs = require('node:fs'),
  path = require('node:path'),
  { randomUUID } = require('node:crypto');
const {
  planRuleConsolidation,
} = require('../dist/utils/rule-consolidation.util');
const { traitFilterKey } = require('../dist/utils/trait-filter.util');
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error(
    'Usage: node backend/scripts/plan-rule-consolidation.cjs RULES_JSON PRIVATE_OUTPUT_DIRECTORY',
  );
const plans = planRuleConsolidation(
  JSON.parse(fs.readFileSync(input, 'utf8')),
).map((p) => ({
  ...p,
  after: { ...p.after, trait_key: JSON.parse(traitFilterKey(p.after)) },
  requests: Object.fromEntries(p.before.map((r) => [r.id, randomUUID()])),
}));
if (!plans.length) throw new Error('No compatible rules to consolidate.');
const literal = JSON.stringify(plans).replace(/'/g, "''");
const sql = `BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='90s';
SET LOCAL standard_conforming_strings=on;
LOCK TABLE public.verifier_rules,public.verifier_user_roles,public.verifier_reconciliation_jobs IN SHARE ROW EXCLUSIVE MODE;
DO $merge$
DECLARE plans jsonb:='${literal}'::jsonb; g jsonb; expected jsonb; actual public.verifier_rules;
 anchor public.verifier_rules; old_rows jsonb; ids bigint[]; merged jsonb; condition_list jsonb; canonical jsonb;
BEGIN
 PERFORM set_config('bouncer.portal_mutation','true',true);
 FOR g IN SELECT value FROM jsonb_array_elements(plans) LOOP
  SELECT array_agg((r->>'id')::bigint ORDER BY (r->>'id')::bigint) INTO ids FROM jsonb_array_elements(g->'before') r;
  IF cardinality(ids)<2 OR ids[1]<>(g->'after'->>'id')::bigint THEN RAISE EXCEPTION 'Invalid retained rule'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('portal:'||(g->'after'->>'server_id'),0));
  PERFORM pg_advisory_xact_lock(hashtextextended('trait-rules:'||(g->'after'->>'server_id'),0));
  IF EXISTS(SELECT 1 FROM public.verifier_reconciliation_jobs WHERE rule_id=ANY(ids) AND status='running') THEN RAISE EXCEPTION 'A source rule has an active reconciliation worker'; END IF;
  old_rows:='[]';
  FOR expected IN SELECT value FROM jsonb_array_elements(g->'before') LOOP
   SELECT * INTO actual FROM public.verifier_rules WHERE id=(expected->>'id')::bigint FOR UPDATE;
   IF NOT FOUND OR (to_jsonb(actual)-'attribute_key'-'attribute_value'-'created_at'-'trait_key') IS DISTINCT FROM (expected-'attribute_key'-'attribute_value'-'created_at'-'trait_key') THEN
    RAISE EXCEPTION 'Rule % changed fields: %',(expected->>'id'),(SELECT string_agg(k,',') FROM jsonb_object_keys(to_jsonb(actual)-'attribute_key'-'attribute_value'-'created_at'-'trait_key') k WHERE to_jsonb(actual)->k IS DISTINCT FROM expected->k); END IF;
   IF actual.id=ids[1] THEN anchor:=actual; END IF;
   old_rows:=old_rows||jsonb_build_array(to_jsonb(actual));
  END LOOP;
  FOR expected IN SELECT value FROM jsonb_array_elements(old_rows) LOOP
   IF (public.verifier_portal_definition(expected)-'trait_filter') IS DISTINCT FROM (public.verifier_portal_definition(to_jsonb(anchor))-'trait_filter')
    OR expected->>'asset_type'='erc20' OR expected->'inscription_criteria'<>'null'::jsonb
    OR (expected->'trait_filter'->>'operator'='AND' AND jsonb_array_length(expected->'trait_filter'->'conditions')>1) THEN RAISE EXCEPTION 'Incompatible source scope'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(old_rows) r WHERE r->'trait_filter'='null'::jsonb) THEN canonical:=NULL;
  ELSE
   SELECT jsonb_agg(c) INTO condition_list FROM jsonb_array_elements(old_rows) r CROSS JOIN LATERAL jsonb_array_elements(r->'trait_filter'->'conditions') c;
   -- The reviewed planner enforces the ten-condition cap. Normalize deduplicates
   -- repeated case variants; reject any unexpected change in the predicate.
   canonical:=public.verifier_traits_normalize(jsonb_build_object('operator','OR','conditions',condition_list));
  END IF;
  IF canonical IS DISTINCT FROM nullif(g->'after'->'trait_filter','null'::jsonb) THEN RAISE EXCEPTION 'Reviewed predicate differs'; END IF;
  UPDATE public.verifier_rules SET trait_filter=canonical,
   ordinal_trait_snapshot=nullif(g->'after'->'ordinal_trait_snapshot','null'::jsonb) WHERE id=ids[1] RETURNING * INTO anchor;
  UPDATE public.verifier_user_roles SET rule_id=anchor.id WHERE rule_id=ANY(ids) AND rule_id<>anchor.id AND server_id=anchor.server_id AND role_id=anchor.role_id;
  UPDATE public.verifier_reconciliation_jobs SET rule_id=anchor.id WHERE rule_id=ANY(ids) AND rule_id<>anchor.id AND status IN ('pending','failed') AND server_id=anchor.server_id AND role_id=anchor.role_id;
  DELETE FROM public.verifier_rules WHERE id=ANY(ids) AND id<>anchor.id;
  FOR expected IN SELECT value FROM jsonb_array_elements(old_rows) LOOP
   INSERT INTO public.verifier_portal_actions(server_id,actor_id,kind,before_rule,after_rule,request_id)
   VALUES(anchor.server_id,'maintenance:rule-consolidation','merge',expected,to_jsonb(anchor),(g->'requests'->>(expected->>'id'))::uuid);
  END LOOP;
 END LOOP;
 INSERT INTO public.verifier_reconciliation_jobs(server_id,role_id)
 SELECT DISTINCT entry->'after'->>'server_id',entry->'after'->>'role_id' FROM jsonb_array_elements(plans) entry;
END $merge$;
COMMIT;
`;
fs.writeFileSync(
  path.join(output, 'rule-consolidation-plan.json'),
  JSON.stringify(plans),
  { mode: 0o600 },
);
fs.writeFileSync(path.join(output, 'rule-consolidation.sql'), sql, {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    groups: plans.length,
    retiredRules: plans.reduce((n, p) => n + p.before.length - 1, 0),
    retainedIds: plans.map((p) => p.after.id),
  }),
);
