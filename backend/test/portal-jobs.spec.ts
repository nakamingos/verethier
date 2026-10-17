import { PortalJobsService } from '../src/portal/portal-jobs.service';
import { EnvironmentConfig } from '../src/config/environment.config';

describe('Durable portal reconciliation worker', () => {
  let flag: jest.ReplaceProperty<boolean>;
  beforeEach(() => {
    flag = jest.replaceProperty(EnvironmentConfig, 'IS_TEST', false);
  });
  afterEach(() => flag.restore());
  function setup(job: any, result: any) {
    const writes: any[] = [];
    const query: any = {
      eq: jest.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resolve({ error: null })),
    };
    const db: any = {
      rpc: jest.fn().mockResolvedValue({ data: [job], error: null }),
      from: jest.fn(() => ({
        update: (value: any) => {
          writes.push(value);
          return query;
        },
      })),
    };
    const roles: any = {
      reverifyRoleChangeInServer: jest.fn().mockResolvedValue(result),
      reverifyRoleInServer: jest.fn().mockResolvedValue(result),
      reverifyUserInServer: jest.fn().mockResolvedValue(result),
    };
    const service = new PortalJobsService(db, roles, {
      getBotClient: () => ({}),
    } as any);
    return { service, roles, writes, query };
  }
  it('runs only the queued server/role scope and records completion', async () => {
    const { service, roles, writes, query } = setup(
      { id: 'job', server_id: 'server', role_id: 'role', attempts: 1 },
      { verified: 2, revoked: 1, errors: 0 },
    );
    await service.run();
    expect(roles.reverifyRoleInServer).toHaveBeenCalledWith('server', 'role');
    expect(roles.reverifyUserInServer).not.toHaveBeenCalled();
    expect(writes).toEqual([
      expect.objectContaining({
        status: 'completed',
        locked_by: null,
        result: { verified: 2, revoked: 1, errors: 0 },
      }),
    ]);
    expect(query.eq).toHaveBeenCalledWith('id', 'job');
    expect(query.eq).toHaveBeenCalledWith('locked_by', expect.any(String));
  });
  it('dispatches a saved role-change audience without broadening it', async () => {
    const { service, roles } = setup(
      {
        id: 'job',
        server_id: 'server',
        role_id: 'new-role',
        rule_id: 7,
        member_ids: ['member'],
        attempts: 1,
      },
      { verified: 1, revoked: 0, errors: 0 },
    );
    await service.run();
    expect(roles.reverifyRoleChangeInServer).toHaveBeenCalledWith(
      'server',
      'new-role',
      '7',
      ['member'],
    );
    expect(roles.reverifyRoleInServer).not.toHaveBeenCalled();
  });
  it('queues a retry for uncertain checks and leaves removals to the existing safe engine', async () => {
    const { service, roles, writes } = setup(
      { id: 'job', server_id: 'server', user_id: 'member', attempts: 1 },
      { verified: 0, revoked: 0, errors: 1 },
    );
    await service.run();
    expect(roles.reverifyUserInServer).toHaveBeenCalledWith('member', 'server');
    expect(writes[0].status).toBe('pending');
    expect(writes[0].result.revoked).toBe(0);
  });
  it('stops automatically after the final failed attempt and saves a sanitized retry message', async () => {
    const { service, roles, writes } = setup(
      { id: 'job', server_id: 'server', role_id: 'role', attempts: 3 },
      null,
    );
    roles.reverifyRoleInServer.mockRejectedValue(
      new Error('https://provider.example/private-key'),
    );
    await service.run();
    expect(writes[0].status).toBe('failed');
    expect(JSON.stringify(writes)).not.toContain('private-key');
  });
});
