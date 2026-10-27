import { Injectable } from '@nestjs/common';
import { GrowthRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.repository';
import { GrowthSettingsDto } from '@gitroom/nestjs-libraries/dtos/growth/growth.settings.dto';
import {
  addUtmToContent,
  buildUtmParams,
} from '@gitroom/helpers/utils/utm.links';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';

// Kept apart from GrowthService because the posts service and the post
// activity use it, while GrowthService itself depends on the posts service
@Injectable()
export class GrowthSettingsService {
  constructor(private _growthRepository: GrowthRepository) {}

  async getSettings(orgId: string) {
    const settings = await this._growthRepository.getOrCreateSettings(orgId);
    return {
      utmEnabled: settings.utmEnabled,
      utmSource: settings.utmSource,
      utmMedium: settings.utmMedium,
      utmCampaign: settings.utmCampaign || '',
    };
  }

  async updateSettings(orgId: string, body: GrowthSettingsDto) {
    await this._growthRepository.updateSettings(orgId, body);
    return this.getSettings(orgId);
  }

  // Adds the organization's UTM parameters to the links of the messages.
  // Called right before the links are shortened (when saving with short
  // links) and at publish time, it never fails the caller: on any error the
  // messages are returned untouched.
  async applyUtm(
    orgId: string,
    provider: string,
    messages: string[]
  ): Promise<string[]> {
    try {
      const settings = await this._growthRepository.getSettings(orgId);
      if (!settings?.utmEnabled) {
        return messages;
      }

      const params = buildUtmParams(settings, provider);
      const shortLinkDomain = ShortLinkService.provider.shortLinkDomain;
      const skip =
        shortLinkDomain && shortLinkDomain !== 'empty' ? [shortLinkDomain] : [];

      return messages.map((message) => addUtmToContent(message, params, skip));
    } catch (err) {
      console.log(err);
      return messages;
    }
  }
}
