import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { InboxService } from '@gitroom/nestjs-libraries/database/prisma/inbox/inbox.service';
import {
  DmAutomationDto,
  InboxQueryDto,
  InboxReplyDto,
  InboxStatusDto,
} from '@gitroom/nestjs-libraries/dtos/inbox/inbox.dto';

@ApiTags('Inbox')
@Controller('/inbox')
export class InboxController {
  constructor(private _inboxService: InboxService) {}

  @Get('/')
  getItems(
    @GetOrgFromRequest() org: Organization,
    @Query() query: InboxQueryDto
  ) {
    return this._inboxService.getItems(org.id, query);
  }

  @Get('/channels')
  getChannels(@GetOrgFromRequest() org: Organization) {
    return this._inboxService.getChannels(org.id);
  }

  @Post('/sync')
  syncNow(@GetOrgFromRequest() org: Organization) {
    return this._inboxService.syncNow(org.id);
  }

  @Get('/automations')
  getAutomations(@GetOrgFromRequest() org: Organization) {
    return this._inboxService.getAutomations(org.id);
  }

  @Post('/automations')
  createAutomation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: DmAutomationDto
  ) {
    return this._inboxService.saveAutomation(org.id, body);
  }

  @Put('/automations/:id')
  updateAutomation(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: DmAutomationDto
  ) {
    return this._inboxService.saveAutomation(org.id, body, id);
  }

  @Delete('/automations/:id')
  deleteAutomation(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._inboxService.deleteAutomation(org.id, id);
  }

  @Post('/:id/draft')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  draftReply(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._inboxService.draftReply(org.id, id);
  }

  @Post('/:id/reply')
  reply(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: InboxReplyDto
  ) {
    return this._inboxService.reply(org.id, id, body.text);
  }

  @Put('/:id/status')
  setStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: InboxStatusDto
  ) {
    return this._inboxService.setStatus(org.id, id, body.status);
  }
}
