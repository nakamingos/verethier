import { EnvironmentConfig } from '../src/config/environment.config';
import { clientAddress } from '../src/portal/portal-throttle.guard';
import { RefreshCollectionHandler } from '../src/services/discord-commands/handlers/refresh-collection.handler';

describe('edge cases made explicit by strict null checks', () => {
  afterEach(() => jest.restoreAllMocks());

  it('refuses to bind wallet proofs to a missing BASE_URL', () => {
    const base = jest.replaceProperty(EnvironmentConfig, 'BASE_URL', undefined);
    try {
      expect(() => EnvironmentConfig.requireBaseUrl()).toThrow('BASE_URL is not configured');
    } finally { base.restore(); }
    const set = jest.replaceProperty(EnvironmentConfig, 'BASE_URL', 'https://bouncer.example');
    try {
      expect(EnvironmentConfig.requireBaseUrl()).toBe('https://bouncer.example');
    } finally { set.restore(); }
  });

  it('keys an anonymous caller with no usable address as "unknown", never "undefined"', () => {
    expect(clientAddress({ headers: {} }, undefined)).toBe('unknown');
    expect(clientAddress({ ip: '203.0.113.7', headers: {} }, undefined)).toBe('203.0.113.7');
  });

  it('answers the collection refresh command outside a server without reading rules', async () => {
    const db: any = { getRoleMappings: jest.fn() };
    const ordinals: any = { refreshCollection: jest.fn() };
    const interaction: any = {
      guildId: null,
      deferReply: jest.fn(),
      editReply: jest.fn(),
      options: { getString: () => 'example' },
    };
    await new RefreshCollectionHandler(db, ordinals).handle(interaction);
    expect(db.getRoleMappings).not.toHaveBeenCalled();
    expect(ordinals.refreshCollection).not.toHaveBeenCalled();
    expect(JSON.stringify(interaction.editReply.mock.calls.at(-1))).toContain('Run this command in a server.');
  });
});

import { requireGuild, requireGuildId, OUTSIDE_SERVER } from '../src/services/discord-commands/utils/guild.util';
import { PortalJobsService } from '../src/portal/portal-jobs.service';

describe('server-only Discord commands', () => {
  it('refuses with one clear message outside a server', () => {
    expect(() => requireGuildId({ guildId: null })).toThrow(OUTSIDE_SERVER);
    expect(() => requireGuild({ guild: null })).toThrow(OUTSIDE_SERVER);
    expect(requireGuildId({ guildId: '123' })).toBe('123');
  });
});

describe('portal role-action job when Discord disconnects mid-pass', () => {
  it('records the job for retry instead of crashing', async () => {
    const flag = jest.replaceProperty(EnvironmentConfig, 'IS_TEST', false);
    try {
      const writes: any[] = [];
      const query: any = { eq: jest.fn().mockReturnThis(), then: (resolve: any) => Promise.resolve(resolve({ error: null })) };
      let claimed = false;
      const db: any = {
        rpc: jest.fn(async () => ({ data: claimed ? [] : (claimed = true, [{ id: 'job', server_id: 's', user_id: 'u', role_action_role_id: 'r', attempts: 1 }]), error: null })),
        from: jest.fn(() => ({ update: (value: any) => { writes.push(value); return query; } })),
      };
      let connected = true;
      const discord: any = { getBotClient: () => (connected ? (connected = false, {}) : null) };
      const roleActions: any = { enforce: jest.fn() };
      await new PortalJobsService(db, {} as any, discord, roleActions).run();
      expect(roleActions.enforce).not.toHaveBeenCalled();
      expect(writes[0]).toMatchObject({ status: 'pending', locked_by: null });
    } finally { flag.restore(); }
  });
});
