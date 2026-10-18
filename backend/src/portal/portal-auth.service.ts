import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';

export interface PortalUser {
  id: string;
  name: string;
  avatar: string | null;
}
export interface PortalGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}
export interface PortalSession {
  user: PortalUser;
  guilds: PortalGuild[];
  csrf: string;
  hash: string;
}

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) =>
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
const validToken = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

@Injectable()
export class PortalAuthService {
  constructor(@Inject('SUPABASE_CLIENT') private readonly db: SupabaseClient) {}

  get origin(): string {
    try {
      const url = new URL(process.env.BASE_URL || '');
      if (
        url.protocol !== 'https:' &&
        !(
          ['localhost', '127.0.0.1'].includes(url.hostname) &&
          process.env.NODE_ENV !== 'production'
        )
      )
        throw new Error();
      return url.origin;
    } catch {
      throw new ServiceUnavailableException(
        'Portal sign-in is not configured.',
      );
    }
  }

  get configured(): boolean {
    try {
      return !!(
        process.env.DISCORD_CLIENT_ID &&
        process.env.DISCORD_CLIENT_SECRET &&
        this.origin
      );
    } catch {
      return false;
    }
  }

  private cookieName(state = false): string {
    return `${this.origin.startsWith('https:') ? '__Host-' : ''}bouncer_${state ? 'oauth' : 'session'}`;
  }

  private cookie(req: Request, state = false): string {
    const name = this.cookieName(state);
    return (
      (req.headers.cookie || '')
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(name + '='))
        ?.slice(name.length + 1) || ''
    );
  }

  private setCookie(
    res: Response,
    value: string,
    state: boolean,
    maxAge: number,
  ): void {
    res.cookie(this.cookieName(state), value, {
      httpOnly: true,
      secure: this.origin.startsWith('https:'),
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
  }

  async start(res: Response, destination: string): Promise<void> {
    if (!this.configured)
      throw new ServiceUnavailableException(
        'Discord sign-in is not configured.',
      );
    const state = randomBytes(32).toString('base64url');
    const returnTo = destination === '/member' ? '/member' : '/admin';
    const { error } = await this.db.from('verifier_oauth_states').insert({
      state_hash: hash(state),
      return_to: returnTo,
      expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
    });
    if (error)
      throw new ServiceUnavailableException(
        'Could not start sign-in. Please try again.',
      );
    this.setCookie(res, state, true, 10 * 60000);
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      redirect_uri: `${this.origin}/api/portal/auth/callback`,
      response_type: 'code',
      scope: 'identify guilds',
      state,
    }).toString();
    res.redirect(url.toString());
  }

  async callback(
    req: Request,
    res: Response,
    code: string,
    state: string,
  ): Promise<void> {
    const cookie = this.cookie(req, true);
    this.setCookie(res, '', true, 0);
    if (
      !validToken(state) ||
      !validToken(cookie) ||
      !equal(state, cookie) ||
      typeof code !== 'string' ||
      !code ||
      code.length > 4096
    ) {
      throw new UnauthorizedException(
        'Discord sign-in could not be confirmed. Please try again.',
      );
    }
    // DELETE RETURNING makes callback state single-use, including concurrent callbacks.
    const { data: attempt, error } = await this.db
      .from('verifier_oauth_states')
      .delete()
      .eq('state_hash', hash(state))
      .gt('expires_at', new Date().toISOString())
      .select('return_to')
      .maybeSingle();
    if (error || !attempt)
      throw new UnauthorizedException(
        'Discord sign-in expired. Please try again.',
      );
    res.locals = res.locals || {};
    res.locals.portalReturnTo =
      attempt.return_to === '/member' ? '/member' : '/admin';
    const token = await this.discord('/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${this.origin}/api/portal/auth/callback`,
      }).toString(),
    });
    if (typeof token.access_token !== 'string')
      throw new UnauthorizedException(
        'Discord sign-in failed. Please try again.',
      );
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const account = await this.discord('/users/@me', { headers });
    if (!/^\d{17,22}$/.test(account.id || ''))
      throw new UnauthorizedException(
        'Discord sign-in failed. Please try again.',
      );
    const guilds: PortalGuild[] = [];
    let after = '';
    for (let page = 0; page < 5; page++) {
      const batch = await this.discord(
        `/users/@me/guilds?limit=200${after ? '&after=' + after : ''}`,
        { headers },
      );
      if (!Array.isArray(batch))
        throw new UnauthorizedException('Could not load your Discord servers.');
      guilds.push(
        ...batch
          .filter((g) => /^\d{17,22}$/.test(g.id))
          .map((g) => ({
            id: g.id,
            name: g.name,
            icon: g.icon || null,
            owner: !!g.owner,
            permissions: String(g.permissions || '0'),
          })),
      );
      if (batch.length < 200) break;
      after = batch[batch.length - 1].id;
      if (page === 4)
        throw new ServiceUnavailableException(
          'Could not load your complete server list.',
        );
    }
    // OAuth tokens are used only for this login, and are never stored or returned.
    const sessionToken = randomBytes(32).toString('base64url');
    const user: PortalUser = {
      id: account.id,
      name: account.global_name || account.username,
      avatar:
        account.avatar && /^[a-zA-Z0-9_]+$/.test(account.avatar)
          ? `https://cdn.discordapp.com/avatars/${account.id}/${account.avatar}.png?size=128`
          : null,
    };
    const result = await this.db.from('verifier_web_sessions').insert({
      token_hash: hash(sessionToken),
      user_id: user.id,
      profile: user,
      guilds,
      expires_at: new Date(Date.now() + 8 * 3600000).toISOString(),
    });
    if (result.error)
      throw new ServiceUnavailableException(
        'Could not save your sign-in. Please try again.',
      );
    this.setCookie(res, sessionToken, false, 8 * 3600000);
    res.redirect(attempt.return_to === '/member' ? '/member' : '/admin');
  }

  async session(req: Request, required = true): Promise<PortalSession | null> {
    const token = this.cookie(req);
    if (!validToken(token)) {
      if (required)
        throw new UnauthorizedException('Please sign in with Discord.');
      return null;
    }
    const { data, error } = await this.db
      .from('verifier_web_sessions')
      .select('token_hash,profile,guilds')
      .eq('token_hash', hash(token))
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (error)
      throw new ServiceUnavailableException(
        'Could not check your sign-in. Please try again.',
      );
    if (!data) {
      if (required)
        throw new UnauthorizedException(
          'Your sign-in expired. Please sign in again.',
        );
      return null;
    }
    return {
      user: data.profile,
      guilds: data.guilds,
      hash: data.token_hash,
      csrf: createHmac('sha256', token)
        .update('bouncer-portal-csrf')
        .digest('hex'),
    };
  }

  assertMutation(req: Request, session: PortalSession): void {
    const csrf = req.headers['x-csrf-token'];
    if (
      req.headers.origin !== this.origin ||
      typeof csrf !== 'string' ||
      !equal(csrf, session.csrf)
    ) {
      throw new ForbiddenException(
        'This request could not be confirmed. Refresh the page and try again.',
      );
    }
  }

  async logout(req: Request, res: Response): Promise<void> {
    const session = await this.session(req);
    this.assertMutation(req, session);
    const { error } = await this.db
      .from('verifier_web_sessions')
      .delete()
      .eq('token_hash', session.hash);
    if (error)
      throw new ServiceUnavailableException(
        'Could not sign out. Please try again.',
      );
    this.setCookie(res, '', false, 0);
  }

  private async discord(path: string, init: RequestInit): Promise<any> {
    try {
      const response = await fetch(`https://discord.com/api/v10${path}`, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error();
      return await response.json();
    } catch {
      throw new UnauthorizedException(
        'Could not complete Discord sign-in. Please try again.',
      );
    }
  }
}
