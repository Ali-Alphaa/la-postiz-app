import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { GrowthToolsService } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.tools.service';
import {
  BioPageDto,
  BrandKitDto,
  BulkScheduleDto,
  RevenueQueryDto,
} from '@gitroom/nestjs-libraries/dtos/growth/growth.tools.dto';

@ApiTags('Growth tools')
@Controller('/growth-tools')
export class GrowthToolsController {
  constructor(private _growthToolsService: GrowthToolsService) {}

  @Post('/bulk')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  bulkSchedule(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BulkScheduleDto
  ) {
    return this._growthToolsService.bulkSchedule(org.id, body);
  }

  @Get('/brand')
  getBrandKit(@GetOrgFromRequest() org: Organization) {
    return this._growthToolsService.getBrandKit(org.id);
  }

  @Put('/brand')
  saveBrandKit(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BrandKitDto
  ) {
    return this._growthToolsService.saveBrandKit(org.id, body);
  }

  @Get('/revenue')
  getRevenue(
    @GetOrgFromRequest() org: Organization,
    @Query() query: RevenueQueryDto
  ) {
    return this._growthToolsService.getRevenue(org.id, query.days);
  }

  @Get('/bio')
  async getBioPage(@GetOrgFromRequest() org: Organization) {
    return (await this._growthToolsService.getBioPage(org.id)) || {};
  }

  @Put('/bio')
  saveBioPage(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BioPageDto
  ) {
    return this._growthToolsService.saveBioPage(org.id, body);
  }

  @Get('/weekly-reviews')
  getWeeklyReviews(@GetOrgFromRequest() org: Organization) {
    return this._growthToolsService.getWeeklyReviews(org.id);
  }

  @Post('/weekly-reviews')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  generateWeeklyReview(@GetOrgFromRequest() org: Organization) {
    return this._growthToolsService.generateWeeklyReview(org.id, true);
  }
}
