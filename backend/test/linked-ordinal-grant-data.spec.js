const fs = require('node:fs/promises');

jest.mock('node:child_process', () => {
  const run = jest.fn();
  const execFile = () => undefined;
  execFile[Symbol.for('nodejs.util.promisify.custom')] = run;
  return { execFile, run };
});

const { run } = require('node:child_process');
const { linkedOrdinalGrantData } = require('../scripts/linked-ordinal-grant-data.cjs');

describe('linked CLI data for Ordinals grants', () => {
  let sql;
  let rows;
  beforeEach(() => {
    sql = [];
    rows = [];
    run.mockReset().mockImplementation(async (command, args) => {
      expect(command).toBe('supabase');
      expect(args.slice(0, 3)).toEqual(['db', 'query', '--linked']);
      sql.push(await fs.readFile(args[args.indexOf('--file') + 1], 'utf8'));
      return { stdout: JSON.stringify({ rows }) };
    });
  });

  it('matches collection/trait filters and deduplicates identities for combined counts', async () => {
    rows = [
      { hashId: '0xABC', slug: 'comrades', attributes: { Crown: 'Gold' } },
      { hashId: '0xabc', slug: 'comrades', attributes: { crown: 'gold' } },
      { hashId: '0xDEF', slug: 'comrades', attributes: { Crown: 'Silver' } },
      { hashId: '0x123', slug: 'other', attributes: { Crown: 'Gold' } },
    ];
    const linked = linkedOrdinalGrantData('/app', '/data');
    expect(await linked.data.matchingAssetIdsWithCriteria(['0xWALLET'], 'comrades', 'cRoWn', 'GOLD')).toEqual(['0xabc']);
    expect(await linked.data.checkAssetOwnershipWithCriteria(['0xwallet'], 'comrades', 'ALL', 'ALL', 2)).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sql[0]).toContain("e.owner = '0xd3418772623be1a3cc6b6d45cb46420cedd9154a'");
    expect(sql[0]).toContain('AND e."prevOwner" IN');
  });

  it('fails closed when the holdings database is unavailable', async () => {
    run.mockRejectedValue(new Error('CLI failed'));
    const linked = linkedOrdinalGrantData('/app', '/data');
    await expect(linked.data.matchingAssetIdsWithCriteria(['0xwallet'], 'comrades')).rejects.toThrow('Linked database query failed');
    await expect(linkedOrdinalGrantData('/app').data.matchingAssetIdsWithCriteria(['0xwallet'], 'comrades')).rejects.toThrow('linked holdings database');
  });

  it('checks server wallet blocks once per member context and isolates later checks', async () => {
    const linked = linkedOrdinalGrantData('/app');
    rows = [{ address: 'bc1pblocked' }];
    const first = {};
    expect(await linked.blocks.allowedAddresses('server', ['bc1pblocked', 'bc1pallowed'], first)).toEqual(['bc1pallowed']);
    expect(await linked.blocks.allowedAddresses('server', ['bc1pblocked'], first)).toEqual([]);
    rows = [{ address: 'bc1pallowed' }];
    expect(await linked.blocks.allowedAddresses('server', ['bc1pallowed'], {})).toEqual([]);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('quotes names and metadata when tracking a confirmed grant and preserves existing metadata', async () => {
    const linked = linkedOrdinalGrantData('/app');
    await linked.db.trackRoleAssignment({ userId: 'user', serverId: 'server', roleId: 'role', ruleId: '1',
      userName: "O'Brien", serverName: 'Server', roleName: "King's Guard", verificationData: { source: "today's pass" } });
    expect(sql[0]).toContain("'O''Brien'");
    expect(sql[0]).toContain("'King''s Guard'");
    expect(sql[0]).toContain("coalesce(previous.verification_data, '{}'::jsonb) || EXCLUDED.verification_data");
    expect(sql[0]).not.toMatch(/DELETE|TRUNCATE/);
  });
});
