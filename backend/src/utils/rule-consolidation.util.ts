import { VerifierRole } from '@/models/verifier-role.interface';
import {
  normalizeTraitFilter,
  ruleTraits,
  traitFilterKey,
} from './trait-filter.util';
import {
  ordinalTraitHash,
  usableOrdinalTraitSnapshot,
} from './ordinal-rule.util';

export interface RuleConsolidation {
  before: VerifierRole[];
  after: VerifierRole;
}
const scopeFields = [
  'server_id',
  'channel_id',
  'role_id',
  'asset_type',
  'chain_id',
  'contract_address',
  'token_standard',
  'token_ids',
  'slug',
  'min_items',
  'collection_name',
  'rule_label',
] as const;
/** Pointwise OR preserves the existing union of matching assets in a count group.
 * Do not combine channels, roles, minima, collection scopes or nested AND groups.
 */
export function planRuleConsolidation(
  rules: VerifierRole[],
): RuleConsolidation[] {
  const groups = new Map<string, VerifierRole[]>();
  for (const r of rules) {
    if (r.asset_type === 'erc20' || r.inscription_criteria) continue;
    const f = ruleTraits(r);
    if (f?.operator === 'AND' && f.conditions.length > 1) continue;
    const key = JSON.stringify(scopeFields.map((k) => r[k] ?? null));
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const plans: RuleConsolidation[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const before = group.slice().sort((a, b) => a.id - b.id);
    const filters = before.map(ruleTraits);
    const conditions = filters.flatMap((f) => f?.conditions || []);
    // Keep the ten-condition bound; leave oversized groups for an explicit design.
    const unique = new Map(
      conditions.map((c) => [
        traitFilterKey({ trait_filter: { operator: 'AND', conditions: [c] } }),
        c,
      ]),
    );
    if (filters.every(Boolean) && unique.size > 10) continue;
    const filter = filters.some((f) => !f)
      ? null
      : normalizeTraitFilter({
          operator: 'OR',
          conditions: [...unique.values()],
        });
    const after = { ...before[0], trait_filter: filter };
    delete after.attribute_key;
    delete after.attribute_value;
    if (after.asset_type === 'ordinal') {
      after.ordinal_trait_snapshot = null;
      if (filter) {
        const snapshots = before.map((r) => {
          const fetched = Date.parse(
            r.ordinal_trait_snapshot?.fetched_at || '',
          );
          return Number.isFinite(fetched)
            ? usableOrdinalTraitSnapshot(r, fetched)
            : null;
        });
        if (snapshots.every(Boolean)) {
          const ids = [
            ...new Set(snapshots.flatMap((s) => s.inscription_ids)),
          ].sort();
          if (ids.length <= 20000)
            after.ordinal_trait_snapshot = {
              inscription_ids: ids,
              criteria_hash: ordinalTraitHash(after),
              fetched_at: snapshots.map((s) => s.fetched_at).sort()[0],
            };
        }
      }
    }
    plans.push({ before, after });
  }
  return plans;
}
