import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PortalAuthService } from './portal-auth.service';

@Injectable()
export class PortalThrottleGuard extends ThrottlerGuard {
  @Inject(PortalAuthService) private readonly portalAuth: PortalAuthService;
  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (String(req.path || req.url || '').startsWith('/api/portal/')) {
      const session = await this.portalAuth.session(req as any, false);
      if (session) return 'portal-user:' + session.user.id;
    }
    // Do not trust arbitrary forwarding headers. Direct verification keeps its existing limits;
    // signed-in portal users get individual limits behind the frontend's reverse proxy.
    return req.ip;
  }
}
