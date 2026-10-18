import {
  ArgumentsHost,
  BadRequestException,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  HttpException,
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UseInterceptors,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { PortalAuthService } from './portal-auth.service';
import { PortalService } from './portal.service';
import {
  PortalActionDto,
  PortalDeleteDto,
  PortalEditDto,
  PortalMessageDto,
  PortalRuleDto,
  PortalSettingsDto,
} from './portal.dto';

@Catch()
export class PortalErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    // Provider/database errors may include URLs or credentials. Never return their raw messages.
    const status = error instanceof HttpException ? error.getStatus() : 503;
    const body =
      error instanceof HttpException
        ? error.getResponse()
        : {
            message:
              'Could not complete this action. Check the inputs and try again. Provider checks may be temporarily unavailable.',
          };
    response
      .status(status)
      .json(typeof body === 'string' ? { message: body } : body);
  }
}
@Injectable()
export class PortalHeaders implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().set({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    return next.handle();
  }
}
@Controller('portal')
@UseInterceptors(PortalHeaders)
@UseFilters(PortalErrors)
@Throttle({
  short: { limit: 12, ttl: 1000 },
  medium: { limit: 60, ttl: 10000 },
  long: { limit: 180, ttl: 60000 },
})
export class PortalController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
  ) {}
  @Get('session') async session(@Req() req: Request) {
    const session = await this.auth.session(req, false);
    return {
      user: session?.user || null,
      csrf: session?.csrf || null,
      configured: this.auth.configured,
    };
  }
  @Get('auth/login') login(
    @Res() res: Response,
    @Query('return_to') destination: string,
  ) {
    return this.auth.start(res, destination);
  }
  @Get('auth/callback') async callback(
    @Req() req: Request,
    @Res() res: Response,
    @Query('code') code: string,
    @Query('state') state: string,
  ) {
    try {
      await this.auth.callback(req, res, code, state);
    } catch {
      res.redirect(
        `${res.locals?.portalReturnTo === '/member' ? '/member' : '/admin'}?sign_in=failed`,
      );
    }
  }
  @Post('auth/logout') async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(req, res);
    return { ok: true };
  }
  @Get('servers') async servers(@Req() req: Request) {
    return this.portal.servers(await this.auth.session(req));
  }
  @Get('servers/:server') async server(
    @Req() req: Request,
    @Param('server') server: string,
  ) {
    return this.portal.overview(await this.auth.session(req), server);
  }
  @Get('servers/:server/suggestions') async suggestions(
    @Req() req: Request,
    @Param('server') server: string,
    @Query('asset') asset: string,
    @Query('field') field: string,
    @Query('slug') slug = '',
    @Query('key') key = '',
    @Query('contract') contract = '',
    @Query('network') network = 'ethereum',
  ) {
    return this.portal.suggestions(
      await this.auth.session(req),
      server,
      asset,
      field,
      slug,
      key,
      contract,
      network,
    );
  }
  @Post('servers/:server/rules') async create(
    @Req() req: Request,
    @Param('server') server: string,
    @Body() body: PortalRuleDto,
  ) {
    return this.portal.create(await this.mutation(req), server, body);
  }
  @Post('servers/:server/rules/:id/edit') async edit(
    @Req() req: Request,
    @Param('server') server: string,
    @Param('id') id: string,
    @Body() body: PortalEditDto,
  ) {
    return this.portal.edit(await this.mutation(req), server, id, body);
  }
  @Post('servers/:server/rules/:id/delete') async remove(
    @Req() req: Request,
    @Param('server') server: string,
    @Param('id') id: string,
    @Body() body: PortalDeleteDto,
  ) {
    return this.portal.remove(
      await this.mutation(req),
      server,
      id,
      body.version,
      body.request_id,
    );
  }
  @Post('servers/:server/actions/:id/reverse') async reverse(
    @Req() req: Request,
    @Param('server') server: string,
    @Param('id') id: string,
    @Body() body: PortalActionDto,
  ) {
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw new BadRequestException('Invalid action ID.');
    return this.portal.reverse(
      await this.mutation(req),
      server,
      id,
      body.request_id,
    );
  }
  @Post('servers/:server/settings') async settings(
    @Req() req: Request,
    @Param('server') server: string,
    @Body() body: PortalSettingsDto,
  ) {
    return this.portal.saveSettings(await this.mutation(req), server, body);
  }
  @Post('servers/:server/message') async message(
    @Req() req: Request,
    @Param('server') server: string,
    @Body() body: PortalMessageDto,
  ) {
    return this.portal.message(await this.mutation(req), server, body);
  }
  @Get('servers/:server/activity') async activity(
    @Req() req: Request,
    @Param('server') server: string,
    @Query('page') page = '1',
    @Query('kind') kind = 'roles',
    @Query('sort') sort = 'desc',
    @Query('limit') limit = '20',
  ) {
    if (
      !/^\d+$/.test(page) ||
      Number(page) < 1 ||
      Number(page) > 10000 ||
      !['roles', 'changes', 'jobs'].includes(kind) ||
      !['asc', 'desc'].includes(sort) ||
      !['10', '20', '50', '100'].includes(limit)
    )
      throw new BadRequestException('Invalid page.');
    return this.portal.activity(
      await this.auth.session(req),
      server,
      Number(page),
      kind,
      sort as 'asc' | 'desc',
      Number(limit),
    );
  }
  @Get('servers/:server/members') async members(
    @Req() req: Request,
    @Param('server') server: string,
    @Query('query') query = '',
  ) {
    return this.portal.memberSuggestions(
      await this.auth.session(req),
      server,
      query,
    );
  }
  @Get('servers/:server/members/:id') async member(
    @Req() req: Request,
    @Param('server') server: string,
    @Param('id') id: string,
  ) {
    return this.portal.member(await this.auth.session(req), server, id, false);
  }
  @Post('servers/:server/members/:id/check') async check(
    @Req() req: Request,
    @Param('server') server: string,
    @Param('id') id: string,
    @Body() body: PortalActionDto,
  ) {
    return this.portal.member(await this.mutation(req), server, id, true);
  }
  @Post('servers/:server/members/:id/fix') async fix(
    @Req() req: Request,
    @Param('server') server: string,
    @Param('id') id: string,
    @Body() body: PortalActionDto,
  ) {
    return this.portal.fix(
      await this.mutation(req),
      server,
      id,
      body.request_id,
    );
  }
  @Post('servers/:server/jobs/:id/retry') async retry(
    @Req() req: Request,
    @Param('server') server: string,
    @Param('id') id: string,
    @Body() body: PortalActionDto,
  ) {
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw new BadRequestException('Invalid job ID.');
    return this.portal.retryJob(
      await this.mutation(req),
      server,
      id,
      body.request_id,
    );
  }
  private async mutation(req: Request) {
    const session = await this.auth.session(req);
    this.auth.assertMutation(req, session);
    return session;
  }
}
