import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { XInspirationService } from '@gitroom/nestjs-libraries/database/prisma/growth/x.inspiration.service';
import { XNativeService } from '@gitroom/nestjs-libraries/database/prisma/growth/x.native.service';
import {
  XCaptureDto,
  XNativeQueueDto,
  XNativeResultDto,
} from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';

// Used by the Postiz browser extension: the tweets the user scrolled past on
// x.com, read from the page, feed the viral library and the voice profile;
// the X scheduler queue it puts into X's own scheduler when the user clicks
@ApiTags('Public API')
@Controller('/public/v1/x')
export class PublicXController {
  constructor(
    private _xInspirationService: XInspirationService,
    private _xNativeService: XNativeService
  ) {}

  @Post('/capture')
  capture(@GetOrgFromRequest() org: Organization, @Body() body: XCaptureDto) {
    Sentry.metrics.count('public_api-request', 1);
    return this._xInspirationService.capture(org.id, body);
  }

  @Get('/native/queue')
  nativeQueue(
    @GetOrgFromRequest() org: Organization,
    @Query() query: XNativeQueueDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._xNativeService.queue(org.id, query.days || 14);
  }

  @Post('/native/:id/result')
  nativeResult(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: XNativeResultDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._xNativeService.result(org.id, id, body);
  }
}
