import { ServiceUnavailableException } from '@nestjs/common';
import { AppService } from '../src/app.service';
import { EnvironmentConfig } from '../src/config/environment.config';
import { DiscordService } from '../src/services/discord.service';

describe('Application readiness', () => {
  const discord = { isReady: jest.fn() };
  const service = new AppService(discord as unknown as DiscordService);
  let enabledFlag: jest.ReplaceProperty<number>;
  let testFlag: jest.ReplaceProperty<boolean>;

  beforeEach(() => {
    enabledFlag = jest.replaceProperty(EnvironmentConfig, 'DISCORD_ENABLED', 1);
    testFlag = jest.replaceProperty(EnvironmentConfig, 'IS_TEST', false);
    discord.isReady.mockReset().mockReturnValue(true);
  });
  afterEach(() => { enabledFlag.restore(); testFlag.restore(); });

  it('is healthy when the enabled bot can handle interactions', () => {
    expect(service.getHealth()).toEqual({ status: 'healthy', timestamp: expect.any(String) });
  });

  it('returns HTTP 503 while the bot is unavailable, then recovers with the connection', () => {
    discord.isReady.mockReturnValue(false);
    try {
      service.getHealth();
      throw new Error('Expected unavailable readiness');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect(error.getStatus()).toBe(503);
      expect(error.getResponse()).toMatchObject({ status: 'unhealthy', discord: 'unavailable' });
    }
    discord.isReady.mockReturnValue(true);
    expect(service.getHealth().status).toBe('healthy');
  });

  it('cannot claim health when Discord is enabled but its service is missing', () => {
    expect(() => new AppService().getHealth()).toThrow(ServiceUnavailableException);
  });

  it('keeps non-Discord deployments healthy when the bot is intentionally disabled', () => {
    enabledFlag.replaceValue(0);
    expect(new AppService().getHealth().status).toBe('healthy');
  });
});
