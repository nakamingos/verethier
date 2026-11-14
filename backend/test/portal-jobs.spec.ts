import { PortalJobsService } from '../src/portal/portal-jobs.service';
import { EnvironmentConfig } from '../src/config/environment.config';

describe('Durable portal reconciliation worker', () => {
  let flag: jest.ReplaceProperty<boolean>;
  beforeEach(() => {
    flag = jest.replaceProperty(EnvironmentConfig, 'IS_TEST', false);
  });
  afterEach(() => flag.restore());
  function setup(job: any, result: any, action: any = {kind:'edit'}) {
    const writes: any[] = [];
    const claims = [true];
    const query: any = {
      eq: jest.fn().mockReturnThis(),
      then: (resolve: any) => Promise.resolve(resolve({ error: null })),
    };
    const db: any = {
      // Each pass claims the job once, then finds the queue empty.
      rpc: jest.fn(async () => ({ data: claims.shift() ? [job] : [], error: null })),
      from: jest.fn(() => ({
        select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({data:action,error:null}) }),
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
      reverifyUserRolesInServer: jest.fn().mockResolvedValue(result),
    };
    const service = new PortalJobsService(db, roles, {
      getBotClient: () => ({}),
    } as any);
    return { service, roles, writes, query, db, claims };
  }
  it('passes the persisted ord.net-only policy through automatic role rechecks', async () => {
    const { service, roles } = setup({ id:'job',server_id:'server',role_id:'role',attempts:1,ordinal_provider_policy:'ordnet-only' }, {verified:0,revoked:0,errors:0});
    await service.run();
    expect(roles.reverifyRoleInServer).toHaveBeenCalledWith('server','role',expect.objectContaining({ordinalProviderPolicy:'ordnet-only',ordinalMode:'scheduled'}));
  });
  it('restricts legacy rule-save jobs and role-move audiences without rewriting their saved progress', async () => {
    const { service, roles, db } = setup({ id:'job',server_id:'server',role_id:'role',action_id:'action',rule_id:1,member_ids:['member'],attempts:1 }, {verified:0,revoked:0,errors:0});
    await service.run();
    expect(db.from).toHaveBeenCalledWith('verifier_portal_actions');
    expect(roles.reverifyRoleChangeInServer).toHaveBeenCalledWith('server','role','1',['member'],expect.objectContaining({ordinalProviderPolicy:'ordnet-only'}));
  });
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
  it('dispatches role-action jobs separately from ownership reconciliation', async () => {
    const { service, roles, writes } = setup(
      {
        id: 'job',
        server_id: 'server',
        user_id: 'user',
        role_action_role_id: 'trigger',
        attempts: 1,
      },
      null,
    );
    const guild = { id: 'server' };
    (service as any).discord = {
      getBotClient: () => ({ guilds: { fetch: async () => guild } }),
    };
    const enforce = jest
      .fn()
      .mockResolvedValue({ checked: 1, removed: 1, errors: 0 });
    (service as any).roleActions = { enforce };
    await service.run();
    expect(enforce).toHaveBeenCalledWith(guild, 'user', 'trigger');
    expect(roles.reverifyUserInServer).not.toHaveBeenCalled();
    expect(writes[0].status).toBe('completed');
  });
  it.each(['role_action_set','role_action_delete'])('narrows already queued %s member jobs to the prior/new targets', async kind => {
    const old='111111111111111111', added='222222222222222222';
    const {service,roles,writes}=setup({id:'job',server_id:'server',user_id:'member',action_id:'receipt',attempts:1},
      {verified:1,revoked:0,errors:0},{kind,before_rule:{remove_role_ids:[old]},after_rule:kind==='role_action_set'?{remove_role_ids:[old,added]}:null});
    await service.run();
    expect(roles.reverifyUserRolesInServer).toHaveBeenCalledWith('member','server',kind==='role_action_set'?[old,added]:[old]);
    expect(roles.reverifyUserInServer).not.toHaveBeenCalled();
    expect(writes[0].status).toBe('completed');
  });
  it('never broadens a malformed or missing role-action receipt into an all-role recheck', async () => {
    for (const action of [null,{kind:'role_action_set',after_rule:{remove_role_ids:'bad'}}]) {
      const {service,roles,writes}=setup({id:'job',server_id:'server',user_id:'member',action_id:'receipt',attempts:1},{errors:0},action);
      await service.run();
      expect(roles.reverifyUserInServer).not.toHaveBeenCalled();
      expect(roles.reverifyUserRolesInServer).not.toHaveBeenCalled();
      expect(writes[0].status).toBe('pending');
    }
  });
  it('preserves full member reconciliation for a wallet restriction change', async () => {
    const {service,roles}=setup({id:'job',server_id:'server',user_id:'member',action_id:'receipt',attempts:1},{errors:0},{kind:'wallet_block'});
    await service.run();
    expect(roles.reverifyUserInServer).toHaveBeenCalledWith('member','server');
    expect(roles.reverifyUserRolesInServer).not.toHaveBeenCalled();
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
  it('drains every waiting job in one pass and then stops', async () => {
    const { service, roles, writes, db, claims } = setup(
      { id: 'job', server_id: 'server', role_id: 'role', attempts: 1 },
      { verified: 1, revoked: 0, errors: 0 },
    );
    claims.push(true, true);
    await service.run();
    expect(roles.reverifyRoleInServer).toHaveBeenCalledTimes(3);
    expect(writes.map(write => write.status)).toEqual(['completed', 'completed', 'completed']);
    // Three claimed jobs, then one empty claim that ends the pass.
    expect(db.rpc).toHaveBeenCalledTimes(4);
  });
  it('keeps draining after a job is queued for retry, because its checks ran', async () => {
    const { service, roles, claims } = setup(
      { id: 'job', server_id: 'server', role_id: 'role', attempts: 1 },
      { verified: 0, revoked: 0, errors: 1 },
    );
    claims.push(true);
    await service.run();
    expect(roles.reverifyRoleInServer).toHaveBeenCalledTimes(2);
  });
  it('ends the pass when a job cannot finish, leaving the rest for the next tick', async () => {
    const { service, roles, db, claims } = setup(
      { id: 'job', server_id: 'server', role_id: 'role', attempts: 1 },
      null,
    );
    claims.push(true, true);
    roles.reverifyRoleInServer.mockRejectedValue(new Error('outage'));
    await service.run();
    expect(roles.reverifyRoleInServer).toHaveBeenCalledTimes(1);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    // The worker is free again for the next tick.
    roles.reverifyRoleInServer.mockResolvedValue({ verified: 1, revoked: 0, errors: 0 });
    await service.run();
    expect(roles.reverifyRoleInServer).toHaveBeenCalledTimes(3);
  });
  it('ends the pass when claiming fails', async () => {
    const { service, roles, db } = setup({ id: 'job', server_id: 'server', role_id: 'role', attempts: 1 }, null);
    db.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    await service.run();
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(roles.reverifyRoleInServer).not.toHaveBeenCalled();
  });
});
