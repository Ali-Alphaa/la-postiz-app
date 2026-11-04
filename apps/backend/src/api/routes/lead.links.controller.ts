import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { LeadLinksService } from '@gitroom/nestjs-libraries/database/prisma/lead-links/lead.links.service';
import {
  LeadMagnetDto,
  LeadMessageDto,
} from '@gitroom/nestjs-libraries/dtos/lead-links/lead.links.dto';

@ApiTags('Lead Links')
@Controller('/lead-links')
export class LeadLinksController {
  constructor(private _leadLinksService: LeadLinksService) {}

  @Get('/')
  getMagnets(@GetOrgFromRequest() org: Organization) {
    return this._leadLinksService.getMagnets(org.id);
  }

  @Post('/magnets')
  createMagnet(
    @GetOrgFromRequest() org: Organization,
    @Body() body: LeadMagnetDto
  ) {
    return this._leadLinksService.createMagnet(org.id, body);
  }

  @Put('/magnets/:id')
  updateMagnet(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: LeadMagnetDto
  ) {
    return this._leadLinksService.updateMagnet(org.id, id, body);
  }

  @Post('/magnets/:id/cover-media')
  coverMedia(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._leadLinksService.coverMedia(org.id, id);
  }

  @Post('/magnets/:id/draft')
  draftMagnet(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._leadLinksService.draftMagnet(org.id, id);
  }

  @Put('/messages/:id')
  updateMessage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: LeadMessageDto
  ) {
    return this._leadLinksService.updateMessage(org.id, id, body);
  }

  @Post('/messages/:id/redraft')
  redraftMessage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._leadLinksService.redraftMessage(org.id, id);
  }
}
