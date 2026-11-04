import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GrowthToolsService } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.tools.service';
import { ConversionDto } from '@gitroom/nestjs-libraries/dtos/growth/growth.tools.dto';

// Called from the server of the user's own website, never from a browser: the
// API key can do everything. A lead or sale, with the UTM tags of the visit.
@ApiTags('Public API')
@Controller('/public/v1/conversions')
export class PublicConversionsController {
  constructor(private _growthToolsService: GrowthToolsService) {}

  @Post('/')
  record(@GetOrgFromRequest() org: Organization, @Body() body: ConversionDto) {
    Sentry.metrics.count('public_api-request', 1);
    return this._growthToolsService.recordConversion(org.id, body);
  }
}
