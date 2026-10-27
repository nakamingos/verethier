import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseFilters,
  UseInterceptors,
  BadRequestException,
} from "@nestjs/common";
import { Request } from "express";
import { Throttle } from "@nestjs/throttler";
import { PortalAuthService } from "./portal-auth.service";
import { PortalService } from "./portal.service";
import { MemberService } from "./member.service";
import { PrivacyService } from "./privacy.service";
import { PortalErrors, PortalHeaders } from "./portal.controller";
import {
  PrivacyChoiceDto,
  PrivacySettingsDto,
  PrivacyDeletionDto,
  PrivacyReviewDto,
  WalletExportDto,
} from "./privacy.dto";
import { WalletExportService } from "./wallet-export.service";

@Controller("portal")
@UseFilters(PortalErrors)
@UseInterceptors(PortalHeaders)
@Throttle({ long: { limit: 60, ttl: 60000 } })
export class PrivacyController {
  constructor(
    private readonly auth: PortalAuthService,
    private readonly portal: PortalService,
    private readonly member: MemberService,
    private readonly privacy: PrivacyService,
    private readonly exports: WalletExportService,
  ) {}
  private async mutation(req: Request) {
    const s = await this.auth.session(req);
    this.auth.assertMutation(req, s);
    return s;
  }
  private id(id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id))
      throw new BadRequestException("Invalid request ID.");
    return id;
  }
  @Get("member/privacy/:server") async policy(
    @Req() req: Request,
    @Param("server") server: string,
  ) {
    const s = await this.auth.session(req);
    await this.member.privacyMembership(s, server);
    return this.privacy.policy(server, s.user.id);
  }
  @Post("member/privacy/:server") async choose(
    @Req() req: Request,
    @Param("server") server: string,
    @Body() body: PrivacyChoiceDto,
  ) {
    const s = await this.mutation(req);
    await this.member.privacyMembership(s, server);
    return this.privacy.choose(server, s.user.id, body);
  }
  @Get("member/deletion-requests") async requests(@Req() req: Request) {
    return this.privacy.deletions((await this.auth.session(req)).user.id);
  }
  @Post("member/deletion-requests") async deletion(
    @Req() req: Request,
    @Body() body: PrivacyDeletionDto,
  ) {
    return this.privacy.requestDeletion(
      (await this.mutation(req)).user.id,
      body.request_id,
    );
  }
  @Post("servers/:server/privacy") async settings(
    @Req() req: Request,
    @Param("server") server: string,
    @Body() body: PrivacySettingsDto,
  ) {
    const s = await this.mutation(req);
    await this.portal.access(s, server);
    return this.privacy.configure(server, s.user.id, body.sharing_enabled);
  }
  @Get("operator/deletion-requests") async allRequests(@Req() req: Request) {
    const s = await this.auth.session(req);
    await this.privacy.audit(s.user.id, null, "deletion_requests");
    return this.privacy.deletions();
  }
  @Post("operator/deletion-requests/:id") async review(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() body: PrivacyReviewDto,
  ) {
    const s = await this.mutation(req);
    return this.privacy.review(
      s.user.id,
      this.id(id),
      body.approve,
      body.outcome,
    );
  }
  @Post("servers/:server/exports") async startExport(
    @Req() req: Request,
    @Param("server") server: string,
    @Body() body: WalletExportDto,
  ) {
    return this.exports.start(await this.mutation(req), server, body);
  }
  @Get("servers/:server/exports/:id") async exportStatus(
    @Req() req: Request,
    @Param("server") server: string,
    @Param("id") id: string,
  ) {
    return this.exports.status(
      await this.auth.session(req),
      server,
      this.id(id),
    );
  }
  @Post("servers/:server/exports/:id/download") async download(
    @Req() req: Request,
    @Param("server") server: string,
    @Param("id") id: string,
  ) {
    return this.exports.download(await this.mutation(req), server, this.id(id));
  }
  @Post("servers/:server/exports/:id/retry") async retry(
    @Req() req: Request,
    @Param("server") server: string,
    @Param("id") id: string,
  ) {
    return this.exports.retry(await this.mutation(req), server, this.id(id));
  }
}
