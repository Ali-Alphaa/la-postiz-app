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
import { SwipeService } from '@gitroom/nestjs-libraries/database/prisma/swipe/swipe.service';
import {
  ImportSwipeDto,
  SwipeEntryDto,
  SwipeFindDto,
  SwipeLinkDto,
  SwipeQueryDto,
  SwipeRepurposeDto,
  SwipeSourceDto,
  SwipeStarDto,
  SwipeStatusDto,
} from '@gitroom/nestjs-libraries/dtos/swipe/swipe.dto';

@ApiTags('Swipe')
@Controller('/swipe')
export class SwipeController {
  constructor(private _swipeService: SwipeService) {}

  @Get('/')
  getEntries(
    @GetOrgFromRequest() org: Organization,
    @Query() query: SwipeQueryDto
  ) {
    return this._swipeService.getEntries(org.id, query);
  }

  @Get('/techniques')
  getTechniques() {
    return this._swipeService.getTechniques();
  }

  @Get('/runs')
  getRuns(@GetOrgFromRequest() org: Organization) {
    return this._swipeService.getRuns(org.id);
  }

  @Post('/')
  createEntry(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SwipeEntryDto
  ) {
    return this._swipeService.createEntry(org.id, body);
  }

  @Post('/import')
  importEntries(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ImportSwipeDto
  ) {
    return this._swipeService.importEntries(org.id, body.entries);
  }

  @Post('/link')
  addLink(@GetOrgFromRequest() org: Organization, @Body() body: SwipeLinkDto) {
    return this._swipeService.addLink(org.id, body);
  }

  @Post('/find')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  findExamples(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SwipeFindDto
  ) {
    return this._swipeService.findExamples(org.id, body);
  }

  @Post('/pack')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  contentPack(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SwipeSourceDto
  ) {
    return this._swipeService.contentPack(org.id, body);
  }

  @Post('/carousel')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  carousel(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SwipeSourceDto
  ) {
    return this._swipeService.carousel(org.id, body);
  }

  @Get('/insights')
  getInsights(@GetOrgFromRequest() org: Organization) {
    return this._swipeService.getInsights(org.id);
  }

  @Post('/import-own')
  importOwnBestPosts(@GetOrgFromRequest() org: Organization) {
    return this._swipeService.importOwnBestPosts(org.id);
  }

  @Put('/:id')
  updateEntry(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: SwipeEntryDto
  ) {
    return this._swipeService.updateEntry(org.id, id, body);
  }

  @Put('/:id/status')
  setStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: SwipeStatusDto
  ) {
    return this._swipeService.setStatus(org.id, id, body.status);
  }

  @Put('/:id/star')
  setStarred(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: SwipeStarDto
  ) {
    return this._swipeService.setStarred(org.id, id, body.starred);
  }

  @Post('/:id/repurpose')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  repurpose(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: SwipeRepurposeDto
  ) {
    return this._swipeService.repurpose(org.id, id, body);
  }

  @Delete('/:id')
  deleteEntry(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._swipeService.deleteEntry(org.id, id);
  }
}
