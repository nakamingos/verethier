import { PortalAuthService } from '../src/portal/portal-auth.service';
import { createHash } from 'crypto';
import { PortalController } from '../src/portal/portal.controller';

describe('Portal authentication', () => {
  const original = { ...process.env };
  let db: any, query: any, auth: PortalAuthService;
  beforeEach(() => {
    process.env.BASE_URL = 'https://bouncer.example';
    process.env.DISCORD_CLIENT_ID = '111111111111111111';
    process.env.DISCORD_CLIENT_SECRET = 'test-secret';
    query = {
      insert: jest.fn().mockResolvedValue({ error: null }),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(),
    };
    db = { from: jest.fn().mockReturnValue(query) };
    auth = new PortalAuthService(db);
  });
  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
  });
  const response = () => ({ cookie: jest.fn(), redirect: jest.fn() }) as any;
  it('returns a failed member sign-in to the member portal using only validated OAuth state', async () => {
    const state = 's'.repeat(43),
      res = response();
    query.maybeSingle.mockResolvedValue({
      data: { return_to: '/member' },
      error: null,
    });
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false } as Response);
    const controller = new PortalController(auth, {} as any, { isOperator: () => false } as any);
    await controller.callback(
      { headers: { cookie: '__Host-bouncer_oauth=' + state } } as any,
      res,
      'code',
      state,
    );
    expect(res.redirect).toHaveBeenCalledWith('/member?sign_in=failed');
    expect(res.locals.portalReturnTo).toBe('/member');
  });
  it('stores only a hash of a single-use login state and sets a secure cookie', async () => {
    const res = response();
    await auth.start(res, 'https://evil.example');
    const url = new URL(res.redirect.mock.calls[0][0]);
    const state = url.searchParams.get('state');
    expect(url.origin).toBe('https://discord.com');
    expect(url.searchParams.get('scope')).toBe('identify guilds');
    expect(query.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        state_hash: createHash('sha256').update(state).digest('hex'),
        return_to: '/admin',
      }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      '__Host-bouncer_oauth',
      state,
      expect.objectContaining({
        secure: true,
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      }),
    );
  });
  it('rejects missing, mismatched and expired OAuth states before token exchange', async () => {
    const fetcher = jest.spyOn(global, 'fetch');
    await expect(
      auth.callback(
        { headers: { cookie: '' } } as any,
        response(),
        'code',
        'x'.repeat(43),
      ),
    ).rejects.toThrow();
    await expect(
      auth.callback(
        {
          headers: { cookie: '__Host-bouncer_oauth=' + 'y'.repeat(43) },
        } as any,
        response(),
        'code',
        'x'.repeat(43),
      ),
    ).rejects.toThrow();
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(
      auth.callback(
        {
          headers: { cookie: '__Host-bouncer_oauth=' + 'x'.repeat(43) },
        } as any,
        response(),
        'code',
        'x'.repeat(43),
      ),
    ).rejects.toThrow('expired');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('consumes OAuth state, discards OAuth tokens, and saves an opaque session hash', async () => {
    query.maybeSingle.mockResolvedValueOnce({
      data: { return_to: '/admin' },
      error: null,
    });
    const responses = [
      { access_token: 'private-access-token' },
      {
        id: '111111111111111111',
        username: 'admin',
        global_name: 'Admin',
        avatar: null,
      },
      [],
    ];
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => ({ ok: true, json: async () => responses.shift() }) as any,
      );
    const res = response();
    await auth.callback(
      { headers: { cookie: '__Host-bouncer_oauth=' + 'x'.repeat(43) } } as any,
      res,
      'code',
      'x'.repeat(43),
    );
    const cookie = res.cookie.mock.calls.find(
      (c) => c[0] === '__Host-bouncer_session',
    );
    const stored = query.insert.mock.calls[0][0];
    expect(stored.token_hash).toBe(
      createHash('sha256').update(cookie[1]).digest('hex'),
    );
    expect(JSON.stringify(stored)).not.toContain('private-access-token');
    expect(JSON.stringify(stored)).not.toContain(cookie[1]);
    expect(query.delete).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/admin');
  });
  it('checks exact origin and CSRF even for Unicode input, without exposing a session token', async () => {
    const session = { csrf: 'a'.repeat(64) } as any;
    expect(() =>
      auth.assertMutation(
        {
          headers: {
            origin: 'https://evil.example',
            'x-csrf-token': session.csrf,
          },
        } as any,
        session,
      ),
    ).toThrow();
    expect(() =>
      auth.assertMutation(
        {
          headers: {
            origin: 'https://bouncer.example',
            'x-csrf-token': 'é'.repeat(64),
          },
        } as any,
        session,
      ),
    ).toThrow();
    expect(() =>
      auth.assertMutation(
        {
          headers: {
            origin: 'https://bouncer.example',
            'x-csrf-token': session.csrf,
          },
        } as any,
        session,
      ),
    ).not.toThrow();
  });
  it('an absent or expired session cannot authenticate', async () => {
    expect(await auth.session({ headers: {} } as any, false)).toBeNull();
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(
      auth.session({
        headers: { cookie: '__Host-bouncer_session=' + 'x'.repeat(43) },
      } as any),
    ).rejects.toThrow('expired');
  });
});
