import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { XInspirationService } from '@gitroom/nestjs-libraries/database/prisma/growth/x.inspiration.service';
import { XCaptureDto } from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';

// Used by the Postiz browser extension: the tweets the user scrolled past on
// x.com, read from the page, feed the viral library and the voice profile
@ApiTags('Public API')
@Controller('/public/v1/x')
export class PublicXController {
  constructor(private _xInspirationService: XInspirationService) {}

  @Post('/capture')
  capture(@GetOrgFromRequest() org: Organization, @Body() body: XCaptureDto) {
    Sentry.metrics.count('public_api-request', 1);
    return this._xInspirationService.capture(org.id, body);
  }
}
