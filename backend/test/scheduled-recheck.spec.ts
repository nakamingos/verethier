import { Logger } from '@nestjs/common';
import { DynamicRoleService } from '../src/services/dynamic-role.service';

describe('Scheduled recheck: grouping, rule reuse and bounded concurrency', () => {
  beforeEach(() => {
    jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const assignment = (id: string, user: string, server = 'guild', role = `role-${id}`) =>
    ({ id, user_id: user, server_id: server, role_id: role, status: 'active' });

  function setup(assignments: any[], evaluate: (userId: string, serverId: string, roleId: string) => Promise<void> = async () => undefined) {
    const db: any = {
      getDisabledBackgroundServers: jest.fn().mockResolvedValue(new Set()),
      getEarnedRoleAssignments: jest.fn().mockResolvedValue(assignments),
      getRoleMappings: jest.fn(async (serverId: string) => [{ id: `rule-${serverId}`, server_id: serverId }]),
      saveRoleCheckDetails: jest.fn(),
      updateLastVerified: jest.fn(),
      updateRoleAssignmentStatus: jest.fn(),
    };
    const engine: any = {
      evaluateRole: jest.fn(async (userId: string, serverId: string, roleId: string) => {
        await evaluate(userId, serverId, roleId);
        return { status: 'passed', results: [] };
      }),
      finishWalletChecks: jest.fn(),
    };
    const discord: any = {
      isMember: jest.fn().mockResolvedValue(true),
      addUserRoleDynamic: jest.fn().mockResolvedValue(true),
      removeUserRole: jest.fn().mockResolvedValue(true),
    };
    return { service: new DynamicRoleService(db, engine, discord), db, engine, discord };
  }

  it('reads each server\'s rules once and passes them to every role evaluation', async () => {
    const { service, db, engine } = setup([
      assignment('1', 'a', 'guild-1'), assignment('2', 'b', 'guild-1'), assignment('3', 'a', 'guild-2'),
    ]);
    await service.performScheduledReverification();
    expect(db.getRoleMappings).toHaveBeenCalledTimes(2);
    expect(engine.evaluateRole).toHaveBeenCalledTimes(3);
    for (const call of engine.evaluateRole.mock.calls) expect(call[4]).toEqual([{ id: `rule-${call[1]}`, server_id: call[1] }]);
  });

  it('checks several members at once but never more than three', async () => {
    let active = 0;
    let peak = 0;
    const users = Array.from({ length: 12 }, (_, i) => `user-${i}`);
    const { service, engine } = setup(users.map((user, i) => assignment(String(i), user)), async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active--;
    });
    await service.performScheduledReverification();
    expect(engine.evaluateRole).toHaveBeenCalledTimes(12);
    expect(peak).toBe(3);
  });

  it('keeps one member\'s roles sequential while other members run alongside', async () => {
    const running = new Map<string, number>();
    let overlapForSameMember = false;
    const { service, engine } = setup([
      assignment('1', 'a'), assignment('2', 'b'), assignment('3', 'a'), assignment('4', 'a'), assignment('5', 'b'),
    ], async userId => {
      if (running.get(userId)) overlapForSameMember = true;
      running.set(userId, (running.get(userId) || 0) + 1);
      await new Promise(resolve => setTimeout(resolve, 5));
      running.set(userId, running.get(userId)! - 1);
    });
    await service.performScheduledReverification();
    expect(overlapForSameMember).toBe(false);
    expect(engine.evaluateRole.mock.calls.filter(call => call[0] === 'a').map(call => call[2]))
      .toEqual(['role-1', 'role-3', 'role-4']);
  });

  it('treats the same user in two servers as separate members', async () => {
    const { service, discord } = setup([assignment('1', 'a', 'guild-1'), assignment('2', 'a', 'guild-2')]);
    await service.performScheduledReverification();
    expect(discord.isMember).toHaveBeenCalledWith('a', 'guild-1', expect.any(Map));
    expect(discord.isMember).toHaveBeenCalledWith('a', 'guild-2', expect.any(Map));
  });

  it('counts one member\'s failure without stopping the others', async () => {
    const { service, engine, db } = setup([assignment('1', 'a'), assignment('2', 'b'), assignment('3', 'c')], async userId => {
      if (userId === 'b') throw new Error('provider outage');
    });
    await service.performScheduledReverification();
    expect(engine.evaluateRole).toHaveBeenCalledTimes(3);
    expect(db.updateLastVerified).toHaveBeenCalledTimes(2);
    expect(Logger.log).toHaveBeenCalledWith(expect.stringContaining('2 verified, 0 revoked, 1 errors'));
  });

  it('re-reads a server\'s rules once they are older than a minute', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { service, db } = setup([assignment('1', 'a'), assignment('2', 'a'), assignment('3', 'a')], async (_user, _server, roleId) => {
      if (roleId === 'role-2') now.mockReturnValue(1_000_000 + 61_000);
    });
    await service.performScheduledReverification();
    expect(db.getRoleMappings).toHaveBeenCalledTimes(2);
  });

  it('retries the rule read for the next assignment after a failed read', async () => {
    const { service, db } = setup([assignment('1', 'a'), assignment('2', 'a')]);
    db.getRoleMappings.mockRejectedValueOnce(new Error('database outage'));
    await service.performScheduledReverification();
    expect(db.getRoleMappings).toHaveBeenCalledTimes(2);
    expect(db.updateLastVerified).toHaveBeenCalledTimes(1);
    expect(Logger.log).toHaveBeenCalledWith(expect.stringContaining('1 verified, 0 revoked, 1 errors'));
  });
});
