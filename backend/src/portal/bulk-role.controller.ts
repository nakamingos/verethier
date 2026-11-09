import { Body, Controller, Get, Param, Post, Query, Req, UseFilters, UseInterceptors } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { PortalAuthService } from './portal-auth.service';
import { PortalService } from './portal.service';
import { PortalErrors, PortalHeaders } from './portal.controller';
import { BulkRoleService } from './bulk-role.service';
import { BulkRoleActionDto, BulkRolePreviewDto } from './bulk-role.dto';
@Controller('portal/servers/:server/bulk-role-checks')
@UseFilters(PortalErrors)
@UseInterceptors(PortalHeaders)
@Throttle({short:{limit:5,ttl:1000},medium:{limit:25,ttl:10000},long:{limit:120,ttl:60000}})
export class BulkRoleController {
  constructor(private readonly auth:PortalAuthService,private readonly portal:PortalService,private readonly checks:BulkRoleService) {}
  @Get() async list(@Req() req:Request,@Param('server') server:string) {
    const session=await this.auth.session(req);this.checks.requireOperator(session.user.id);
    await this.portal.readAccess(session,server,'bulk_role_checks');
    return this.checks.list(server);
  }
  @Post('preview') async preview(@Req() req:Request,@Param('server') server:string,@Body() body:BulkRolePreviewDto) {
    const session=await this.auth.session(req);this.auth.assertMutation(req,session);this.checks.requireOperator(session.user.id);
    return this.checks.preview(await this.portal.access(session,server),session.user.id,body);
  }
  @Get(':id') async info(@Req() req:Request,@Param('server') server:string,@Param('id') id:string,@Query('page') page='1') {
    const session=await this.auth.session(req);this.checks.requireOperator(session.user.id);
    await this.portal.readAccess(session,server,'bulk_role_check');
    return this.checks.info(server,id,Number(page));
  }
  @Post(':id') async action(@Req() req:Request,@Param('server') server:string,@Param('id') id:string,@Body() body:BulkRoleActionDto) {
    const session=await this.auth.session(req);this.auth.assertMutation(req,session);this.checks.requireOperator(session.user.id);await this.portal.access(session,server);
    return this.checks.action(server,id,session.user.id,body.action,body.request_id);
  }
}
