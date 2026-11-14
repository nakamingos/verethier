import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from '../src/app.module';
import { validationPipeOptions } from '../src/config/validation.config';

/** Boots the real application module on the HTTP platform and sends real requests. */
describe('HTTP platform smoke test', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    app.use(helmet());
    app.useGlobalPipes(new ValidationPipe(validationPipeOptions()));
    app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => { await app?.close(); });

  it('serves the health route under the global prefix with security headers', async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'healthy', timestamp: expect.any(String) });
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('applies rate-limit headers', async () => {
    const response = await fetch(`${base}/api/health`);
    expect(response.headers.get('x-ratelimit-limit-short')).toBeTruthy();
  });

  it('rejects an invalid verify-signature payload with a bare 400', async () => {
    const response = await fetch(`${base}/api/verify-signature`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { userId: 'x', extra: 1 }, signature: '0x' }),
    });
    expect(response.status).toBe(400);
  });

  it('returns 404 for unknown routes and 401 for protected portal routes without a session', async () => {
    expect((await fetch(`${base}/api/not-a-route`)).status).toBe(404);
    expect((await fetch(`${base}/api/portal/servers`)).status).toBe(401);
  });

  it('passes query-string values to a route and path parameters stay intact', async () => {
    // The OAuth callback reads code and state from the query string.
    const response = await fetch(`${base}/api/portal/auth/callback?code=abc&state=def`, { redirect: 'manual' });
    expect([302, 400, 401, 503]).toContain(response.status);
    const parameter = await fetch(`${base}/api/portal/servers/123`);
    expect(parameter.status).toBe(401);
  });

  it('answers a preflight request without crashing', async () => {
    const response = await fetch(`${base}/api/health`, { method: 'OPTIONS' });
    expect(response.status).toBeLessThan(500);
  });
});
