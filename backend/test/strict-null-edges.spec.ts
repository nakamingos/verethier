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
