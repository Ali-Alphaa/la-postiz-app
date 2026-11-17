import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/growth/campaigns.service';
import {
  CampaignDto,
  CampaignDuplicateDto,
  CampaignPostDto,
} from '@gitroom/nestjs-libraries/dtos/growth/campaign.dto';

@ApiTags('Campaigns')
@Controller('/campaigns')
export class CampaignsController {
  constructor(private _campaignsService: CampaignsService) {}

  @Get('/')
  getCampaigns(@GetOrgFromRequest() org: Organization) {
    return this._campaignsService.getCampaigns(org.id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  createCampaign(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CampaignDto
  ) {
    return this._campaignsService.createCampaign(org.id, body);
  }

  @Get('/:id')
  getCampaign(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._campaignsService.getCampaign(org.id, id);
  }

  @Get('/:id/results')
  getResults(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._campaignsService.getResults(org.id, id);
  }

  @Post('/:id/archive')
  archiveCampaign(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._campaignsService.archiveCampaign(org.id, id);
  }

  @Post('/:id/unarchive')
  unarchiveCampaign(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._campaignsService.unarchiveCampaign(org.id, id);
  }

  @Post('/:id/duplicate')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  duplicateCampaign(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: CampaignDuplicateDto
  ) {
    return this._campaignsService.duplicateCampaign(org.id, id, body);
  }

  @Put('/posts/:id')
  updatePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: CampaignPostDto
  ) {
    return this._campaignsService.updatePost(org.id, id, body);
  }

  @Post('/posts/:id/approve')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  approvePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._campaignsService.approvePost(org.id, id);
  }

  @Post('/posts/:id/reject')
  rejectPost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._campaignsService.rejectPost(org.id, id);
  }
}
