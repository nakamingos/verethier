import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { PortalAuthService } from './portal-auth.service';
import { PortalErrors, PortalHeaders } from './portal.controller';
import { MemberService } from './member.service';
import {
  MemberLinkDto,
  MemberProofDto,
  MemberRemoveDto,
  MemberResumeDto,
  MemberVerifyDto,
} from './member.dto';

@Controller('portal/member')
@UseInterceptors(PortalHeaders)
@UseFilters(PortalErrors)
@Throttle({
  short: { limit: 12, ttl: 1000 },
  medium: { limit: 60, ttl: 10000 },
  long: { limit: 180, ttl: 60000 },
})
export class MemberController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly member: MemberService,
  ) {}
  private async session(req: Request) {
    const session = await this.auth.session(req);
    this.auth.assertMutation(req, session);
    return session;
  }
  @Get() async overview(@Req() req: Request) {
    return this.member.overview(await this.auth.session(req));
  }
  @Post('wallet-challenge') async challenge(
    @Req() req: Request,
    @Body() dto: MemberLinkDto,
  ) {
    return this.member.linkChallenge(await this.session(req), dto);
  }
  @Post('wallet-proof') async proof(
    @Req() req: Request,
    @Body() dto: MemberProofDto,
  ) {
    return this.member.link(await this.session(req), dto);
  }
  @Get('wallet-removal') async preview(
    @Req() req: Request,
    @Query('address') address: string,
  ) {
    return this.member.removalPreview(await this.auth.session(req), address);
  }
  @Post('wallet-removal') async remove(
    @Req() req: Request,
    @Body() dto: MemberRemoveDto,
  ) {
    return this.member.remove(
      await this.session(req),
      dto.address,
      dto.requestId,
    );
  }
  @Post('verify') async verify(
    @Req() req: Request,
    @Body() dto: MemberVerifyDto,
  ) {
    return this.member.verify(await this.session(req), dto);
  }
  @Post('resume') async resume(
    @Req() req: Request,
    @Body() dto: MemberResumeDto,
  ) {
    return this.member.resume(await this.session(req), dto.flow);
  }
  @Post('jobs/:id/retry') async retry(
    @Req() req: Request,
    @Param('id') id: string,
  ) {
    return this.member.retry(await this.session(req), id);
  }
}
