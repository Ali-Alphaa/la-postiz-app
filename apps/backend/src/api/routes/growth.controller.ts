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
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { GrowthService } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.service';
import { GrowthSettingsService } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.settings.service';
import { CompetitorsService } from '@gitroom/nestjs-libraries/database/prisma/growth/competitors.service';
import { GrowthSettingsDto } from '@gitroom/nestjs-libraries/dtos/growth/growth.settings.dto';
import { BestTimeDto } from '@gitroom/nestjs-libraries/dtos/growth/best.time.dto';
import {
  AiHashtagsDto,
  HashtagsQueryDto,
} from '@gitroom/nestjs-libraries/dtos/growth/hashtags.dto';
import { RecycleSettingsDto } from '@gitroom/nestjs-libraries/dtos/growth/recycle.settings.dto';
import { AbExperimentDto } from '@gitroom/nestjs-libraries/dtos/growth/ab.experiment.dto';
import {
  CompetitorDto,
  InspirationQueryDto,
} from '@gitroom/nestjs-libraries/dtos/growth/competitor.dto';

@ApiTags('Growth')
@Controller('/growth')
export class GrowthController {
  constructor(
    private _growthService: GrowthService,
    private _growthSettingsService: GrowthSettingsService,
    private _competitorsService: CompetitorsService
  ) {}

  @Get('/settings')
  getSettings(@GetOrgFromRequest() org: Organization) {
    return this._growthSettingsService.getSettings(org.id);
  }

  @Put('/settings')
  updateSettings(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GrowthSettingsDto
  ) {
    return this._growthSettingsService.updateSettings(org.id, body);
  }

  @Get('/best-time/:integrationId')
  getBestTime(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Query() query: BestTimeDto
  ) {
    return this._growthService.getBestTime(
      org.id,
      integrationId,
      query.timezone
    );
  }

  @Post('/best-time/:integrationId/apply')
  applyBestTime(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Body() body: BestTimeDto
  ) {
    return this._growthService.applyBestTime(
      org.id,
      integrationId,
      body.timezone
    );
  }

  @Post('/engagement/:integrationId/refresh')
  refreshEngagement(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string
  ) {
    return this._growthService.refreshEngagement(org.id, integrationId);
  }

  @Get('/hashtags')
  getHashtags(
    @GetOrgFromRequest() org: Organization,
    @Query() query: HashtagsQueryDto
  ) {
    return this._growthService.getHashtags(org.id, query.integrationId);
  }

  @Post('/hashtags/ai')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  aiHashtags(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AiHashtagsDto
  ) {
    return this._growthService.aiHashtags(org.id, body);
  }

  @Get('/recycle')
  getRecycle(@GetOrgFromRequest() org: Organization) {
    return this._growthService.getRecycle(org.id);
  }

  @Put('/recycle/:integrationId')
  updateRecycle(
    @GetOrgFromRequest() org: Organization,
    @Param('integrationId') integrationId: string,
    @Body() body: RecycleSettingsDto
  ) {
    return this._growthService.updateRecycle(org.id, integrationId, body);
  }

  @Get('/experiments')
  getExperiments(@GetOrgFromRequest() org: Organization) {
    return this._growthService.getExperiments(org.id);
  }

  @Post('/experiments')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  createExperiment(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AbExperimentDto
  ) {
    return this._growthService.createExperiment(org.id, body);
  }

  @Post('/experiments/:id/cancel')
  cancelExperiment(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._growthService.cancelExperiment(org.id, id);
  }

  @Post('/experiments/:id/recycle-winner')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  recycleWinner(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._growthService.recycleWinner(org.id, id);
  }

  @Delete('/experiments/:id')
  deleteExperiment(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._growthService.deleteExperiment(org.id, id);
  }

  @Get('/competitors/providers')
  getCompetitorProviders() {
    return this._competitorsService.getProviders();
  }

  @Get('/competitors')
  getCompetitors(@GetOrgFromRequest() org: Organization) {
    return this._competitorsService.getCompetitors(org.id);
  }

  @Post('/competitors')
  addCompetitor(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CompetitorDto
  ) {
    return this._competitorsService.addCompetitor(org.id, body);
  }

  @Delete('/competitors/:id')
  deleteCompetitor(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._competitorsService.deleteCompetitor(org.id, id);
  }

  @Get('/inspiration')
  getInspiration(
    @GetOrgFromRequest() org: Organization,
    @Query() query: InspirationQueryDto
  ) {
    return this._competitorsService.getInspiration(org.id, query.provider);
  }

  @Post('/inspiration/:id/rewrite')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  rewriteInspiration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._competitorsService.rewrite(org.id, id);
  }
}
