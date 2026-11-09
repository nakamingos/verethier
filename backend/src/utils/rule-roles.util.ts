import { VerifierRole } from '@/models/verifier-role.interface';

/** Additional outputs share the canonical rule ID and requirements. */
export function ruleRoles(rule: Pick<VerifierRole, 'role_id' | 'role_name' | 'additional_roles'>): { id: string; name: string }[] {
  return [{ id: rule.role_id, name: rule.role_name || rule.role_id }, ...(rule.additional_roles || [])];
}
export function expandRuleRoles<T extends VerifierRole>(rules: T[]): T[] {
  return rules.flatMap(rule => !rule.additional_roles?.length ? [rule] : ruleRoles(rule).map(role => ({ ...rule, role_id: role.id, role_name: role.name, additional_roles: [] })));
}
export function roleIds(rule: VerifierRole): string[] { return ruleRoles(rule).map(role => role.id); }
