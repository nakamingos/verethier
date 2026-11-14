import { Inject, Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { isIP } from 'net';
import { EnvironmentConfig } from '@/config/environment.config';
import { PortalAuthService } from './portal-auth.service';

let warnedMissingHeader = false;

/**
 * The address used to rate-limit anonymous requests.
 *
 * Behind a hosting edge, the socket address is the edge proxy shared by every
 * caller. CLIENT_IP_HEADER names a header that the edge overwrites with the
 * caller's address (Railway: X-Real-IP). Only a single valid IP is accepted;
 * anything else falls back to the socket address rather than trusting a value
 * the caller may have supplied.
 */
export function clientAddress(
  req: { ip?: string; headers?: Record<string, string | string[] | undefined> },
  header: string | undefined = EnvironmentConfig.CLIENT_IP_HEADER,
): string {
  const name = header?.trim().toLowerCase();
  if (name && /^[a-z0-9-]+$/.test(name)) {
    const raw = req.headers?.[name];
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (isIP(value)) return value;
    if (!warnedMissingHeader) {
      warnedMissingHeader = true;
      Logger.warn(
        `CLIENT_IP_HEADER (${name}) was missing or not a single IP address; rate limits are using the connection address.`,
        'PortalThrottleGuard',
      );
    }
  }
  return req.ip;
}

@Injectable()
export class PortalThrottleGuard extends ThrottlerGuard {
  @Inject(PortalAuthService) private readonly portalAuth: PortalAuthService;
  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (String(req.path || req.url || '').startsWith('/api/portal/')) {
      const session = await this.portalAuth.session(req as any, false);
      if (session) return 'portal-user:' + session.user.id;
    }
    // Anonymous requests (wallet verification, sign-in) are limited per caller
    // address. Arbitrary forwarding headers are never trusted; see clientAddress.
    return clientAddress(req);
  }
}
