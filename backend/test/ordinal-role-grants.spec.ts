import { ordinalGrantGroups, runOrdinalRoleGrants, OrdinalGrantDependencies } from '../src/maintenance/ordinal-role-grants';
import { VerificationEngine } from '../src/services/verification-engine.service';
import { VerifierRole } from '../src/models/verifier-role.interface';

const address = 'bc1ptest';
const rule = (id: number, changes = {}): VerifierRole => ({
  id, server_id: 'server', channel_id: 'channel', role_id: 'role', asset_type: 'ordinal',
  slug: 'pizza-comrades', attribute_key: 'ALL', attribute_value: 'ALL', min_items: 1, ...changes,
} as VerifierRole);

describe('one-time Ordinals role grants', () => {
  let deps: OrdinalGrantDependencies;
  let ownership: any;
  let allowedAddresses: jest.Mock;
  let currentRoles: Set<string>;
  const saved = [{ userId: 'member', address }];

  beforeEach(() => {
    currentRoles = new Set(['security-role']);
    ownership = { count: jest.fn(async () => 1n), matchingAssets: jest.fn() };
    allowedAddresses = jest.fn(async (_server, addresses) => addresses);
    const engine = new VerificationEngine({} as any, ownership,
      { getUserAddresses: async () => [address, '0xwallet'] } as any, { allowedAddresses } as any);
    deps = {
      member: jest.fn(async () => ({ name: 'Member', roles: new Set(currentRoles) })),
      verify: jest.fn((user, wallet, rules, context) => engine.verifyUserBulk(user, rules.map(rule => rule.id), wallet, rules, context)),
      add: jest.fn(async (_user, role) => { currentRoles.add(role); }),
      track: jest.fn(async () => undefined), record: jest.fn(),
    };
  });

  it('dry-runs only saved Bitcoin users and reports eligibility without role or assignment writes', async () => {
    const result = await runOrdinalRoleGrants([...saved, ...saved], [rule(1), rule(2, { asset_type: 'nft', role_id: 'evm-only' })], false, deps);
    expect(result).toMatchObject({ users: 1, eligibleGrants: 1, granted: 0 });
    expect(deps.verify).toHaveBeenCalledTimes(1);
    expect(ownership.count).toHaveBeenCalledTimes(1);
    expect(deps.add).not.toHaveBeenCalled();
    expect(deps.track).not.toHaveBeenCalled();
  });

  it('adds missing eligible roles, preserves existing roles, tracks grants, and is safe to rerun', async () => {
    const rules = [rule(1), rule(2, { role_id: 'owned' })];
    currentRoles.add('owned');
    const result = await runOrdinalRoleGrants(saved, rules, true, deps);
    expect(result.granted).toBe(1);
    expect(currentRoles).toEqual(new Set(['security-role', 'owned', 'role']));
    expect(deps.track).toHaveBeenCalledWith('member', 'Member', expect.objectContaining({ id: 1 }), [expect.objectContaining({ isValid: true })]);
    await runOrdinalRoleGrants(saved, rules, true, deps);
    expect(deps.add).toHaveBeenCalledTimes(1);
    expect(deps.verify).toHaveBeenCalledTimes(1);
  });

  it('combines saved EVM and Bitcoin holdings using the normal verification engine', async () => {
    ownership.count.mockImplementation(async rule => rule.asset_type === 'ordinal' ? 3n : 7n);
    const rules = [rule(1, { min_items: 10 }), rule(2, { asset_type: 'ethscription', min_items: 10 })];
    expect((await runOrdinalRoleGrants(saved, rules, true, deps)).granted).toBe(1);
    expect(deps.track).toHaveBeenCalledWith('member', 'Member', expect.objectContaining({ asset_type: 'ordinal' }),
      expect.arrayContaining([expect.objectContaining({ combinedAssetCount: 10, combinedRuleIds: [1, 2] })]));
  });

  it('honors an independently passing EVM path for a role also available through Ordinals', async () => {
    ownership.count.mockImplementation(async rule => rule.asset_type === 'ordinal' ? 0n : 10n);
    await runOrdinalRoleGrants(saved, [rule(1), rule(2, { asset_type: 'ethscription' })], true, deps);
    expect(deps.add).toHaveBeenCalledWith('member', 'role');
  });

  it('grants the shared minimum when EVM holdings already meet it and Ordinals also contribute', async () => {
    ownership.count.mockImplementation(async rule => rule.asset_type === 'ordinal' ? 3n : 10n);
    await runOrdinalRoleGrants(saved, [rule(1, { min_items: 10 }), rule(2, { asset_type: 'ethscription', min_items: 10 })], true, deps);
    expect(deps.add).toHaveBeenCalledWith('member', 'role');
    expect(deps.track).toHaveBeenCalledWith('member', 'Member', expect.objectContaining({ id: 2 }),
      expect.arrayContaining([expect.objectContaining({ ruleId: 2, isValid: true })]));
  });

  it('respects wallet blocks and leaves roles alone on failed or unavailable checks', async () => {
    allowedAddresses.mockResolvedValue([]);
    await runOrdinalRoleGrants(saved, [rule(1)], true, deps);
    expect(ownership.count).not.toHaveBeenCalled();
    allowedAddresses.mockImplementation(async (_server, wallets) => wallets);
    ownership.count.mockRejectedValue(new Error('Provider unavailable'));
    const result = await runOrdinalRoleGrants(saved, [rule(1)], true, deps);
    expect(result.unavailableChecks).toBe(1);
    expect(deps.add).not.toHaveBeenCalled();
    expect(currentRoles).toEqual(new Set(['security-role']));
  });

  it('skips members who left and roles obtained while their holdings were being checked', async () => {
    (deps.member as jest.Mock).mockResolvedValueOnce(null);
    expect((await runOrdinalRoleGrants(saved, [rule(1)], true, deps)).absentMembers).toBe(1);
    (deps.member as jest.Mock).mockResolvedValueOnce({ name: 'Member', roles: new Set() })
      .mockResolvedValueOnce({ name: 'Member', roles: new Set(['role']) });
    await runOrdinalRoleGrants(saved, [rule(1)], true, deps);
    expect(deps.add).not.toHaveBeenCalled();
  });

  it('does not track a failed Discord grant', async () => {
    (deps.add as jest.Mock).mockRejectedValue(new Error('Missing permissions'));
    expect((await runOrdinalRoleGrants(saved, [rule(1)], true, deps)).errors).toBe(1);
    expect(deps.track).not.toHaveBeenCalled();
  });

  it('stops after a tracking failure and journals the successful grant for repair', async () => {
    (deps.track as jest.Mock).mockRejectedValue(new Error('Database unavailable'));
    await expect(runOrdinalRoleGrants(saved, [rule(1), rule(2, { role_id: 'another' })], true, deps)).rejects.toThrow('Role granted but tracking failed');
    expect(deps.add).toHaveBeenCalledTimes(1);
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ event: 'tracking_failed', roleId: 'role' }));
  });

  it('keeps channel scopes separate and includes alternative minimums and ALL-channel rules', () => {
    const rules = [rule(1, { min_items: 10 }), rule(2, { min_items: 10, asset_type: 'ethscription', channel_id: 'other' }),
      rule(3, { min_items: 5, asset_type: 'ethscription' }), rule(4, { channel_id: 'ALL', role_id: 'global' })];
    expect(ordinalGrantGroups(rules).map(group => group.map(rule => rule.id))).toEqual([[1, 3, 4], [4]]);
  });

  it('evaluates a different minimum as an alternative without combining its count', async () => {
    ownership.count.mockImplementation(async rule => rule.asset_type === 'ordinal' ? 3n : 4n);
    await runOrdinalRoleGrants(saved, [rule(1, { min_items: 10 }), rule(2, { asset_type: 'ethscription', min_items: 5 })], true, deps);
    expect(deps.add).not.toHaveBeenCalled();
    ownership.count.mockImplementation(async rule => rule.asset_type === 'ordinal' ? 3n : 5n);
    await runOrdinalRoleGrants(saved, [rule(1, { min_items: 10 }), rule(2, { asset_type: 'ethscription', min_items: 5 })], true, deps);
    expect(deps.add).toHaveBeenCalledWith('member', 'role');
  });

  it('keeps each member’s live ownership context separate', async () => {
    const members = Array.from({ length: 5 }, (_, index) => ({ userId: `member-${index}`, address }));
    const summary = await runOrdinalRoleGrants(members, [rule(1)], false, deps);
    expect(summary).toMatchObject({ users: 5, eligibleGrants: 5 });
    const contexts = (deps.verify as jest.Mock).mock.calls.map(call => call[3]);
    expect(new Set(contexts).size).toBe(5);
  });
});
