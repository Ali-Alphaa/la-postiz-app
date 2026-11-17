import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CampaignsRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/campaigns.repository';
import { MixService } from '@gitroom/nestjs-libraries/database/prisma/growth/mix.service';
import { GrowthToolsService } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.tools.service';
import { XVoiceService } from '@gitroom/nestjs-libraries/database/prisma/growth/x.voice.service';
import { LeadLinksRepository } from '@gitroom/nestjs-libraries/database/prisma/lead-links/lead.links.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnthropicService,
  CampaignSlot,
} from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { addUtmToUrl } from '@gitroom/helpers/utils/utm.links';
import {
  checkTradingCompliance,
  stripPostHtml,
} from '@gitroom/helpers/utils/trading.compliance';
import {
  CampaignDto,
  CampaignPostDto,
} from '@gitroom/nestjs-libraries/dtos/growth/campaign.dto';

const MAX_SLOTS = 60;
const SOON = 15 * 60000;
// from this many posts a channel gets a second offer post at the end
const SECOND_OFFER_FROM = 10;
const EDITABLE = ['DRAFT', 'NEEDS_MEDIA', 'REJECTED'];
const RISK_WORDING = /\brisk\b/i;
const NOT_ADVICE_WORDING = /\b(not (financial )?advice|educational)\b/i;

export interface CampaignFlag {
  code: string;
  severity: 'high' | 'medium';
  message: string;
}

@Injectable()
export class CampaignsService {
  constructor(
    private _repository: CampaignsRepository,
    private _mixService: MixService,
    private _growthToolsService: GrowthToolsService,
    private _xVoiceService: XVoiceService,
    private _leadLinksRepository: LeadLinksRepository,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _anthropicService: AnthropicService
  ) {}

  private baseProvider(identifier: string) {
    return identifier.split('-')[0].toLowerCase();
  }

  private ukToday() {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
    }).format(new Date());
  }

  private slug(name: string) {
    const base = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `${base || 'campaign'}-${makeId(4).toLowerCase()}`;
  }

  private provider(identifier: string) {
    return this._integrationManager.getSocialIntegration(identifier);
  }

  private maxLength(identifier: string) {
    try {
      return this.provider(identifier)?.maxLength?.() || 2200;
    } catch (err) {
      return 2200;
    }
  }

  // A channel that asks for media has no way to post text only. This asks the
  // provider itself, a throw means it has no opinion on an empty post.
  private async needsMedia(identifier: string) {
    try {
      const result = await this.provider(identifier)?.checkValidity?.(
        [[]],
        {},
        undefined as any
      );
      return typeof result === 'string';
    } catch (err) {
      return false;
    }
  }

  // the role of every slot of one channel: a teaser first, the offer at about
  // 40%, a last reminder at the end when there are enough posts, value and
  // proof in between
  private roles(count: number) {
    const offer = count >= 3 ? Math.max(1, Math.round(0.4 * (count - 1))) : -1;
    const proof = Math.round(0.7 * (count - 1));
    return [...Array(count)].map((_, index) => {
      if (count >= 3 && index === 0) {
        return { role: 'teaser', pillar: 'risk_psychology' };
      }
      if (index === offer) {
        return { role: 'offer', pillar: 'offer' };
      }
      if (count >= SECOND_OFFER_FROM && index === count - 1) {
        return { role: 'last', pillar: 'offer' };
      }
      if (index === proof && index !== offer) {
        return { role: 'proof', pillar: 'behind_scenes' };
      }
      return {
        role: 'value',
        pillar: index % 2 ? 'risk_psychology' : 'rulebook',
      };
    });
  }

  flags(content: string, pillar: string, maxLength: number): CampaignFlag[] {
    const text = stripPostHtml(content);
    const flags: CampaignFlag[] = [];

    if (!text) {
      flags.push({
        code: 'empty',
        severity: 'high',
        message: 'The post is empty',
      });
    }
    if (text.length > maxLength) {
      flags.push({
        code: 'too_long',
        severity: 'high',
        message: `${text.length} characters, the channel takes ${maxLength}`,
      });
    }
    for (const flag of checkTradingCompliance(content)) {
      flags.push({
        code: 'claims',
        severity: flag.severity,
        message: `"${flag.phrase}": ${flag.reason}`,
      });
    }
    if (
      pillar === 'receipts' &&
      (!RISK_WORDING.test(text) || !NOT_ADVICE_WORDING.test(text))
    ) {
      flags.push({
        code: 'results_risk_line',
        severity: 'high',
        message:
          'Results post without the risk line (risk of loss and educational, not financial advice)',
      });
    }
    if (/\{\{link\}\}/.test(text)) {
      flags.push({
        code: 'link_token',
        severity: 'high',
        message: 'The link token was not replaced',
      });
    }

    return flags;
  }

  async getCampaigns(orgId: string) {
    return (await this._repository.getCampaigns(orgId)).map((campaign) => {
      const counts: Record<string, number> = {};
      for (const post of campaign.posts) {
        counts[post.status] = (counts[post.status] || 0) + 1;
      }
      return {
        id: campaign.id,
        name: campaign.name,
        goal: campaign.goal,
        startDate: campaign.startDate,
        days: campaign.days,
        status: campaign.status,
        total: campaign.posts.length,
        counts,
      };
    });
  }

  async getCampaign(orgId: string, id: string) {
    const campaign = await this._repository.getCampaign(orgId, id);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const magnet = await this._leadLinksRepository.getMagnet(
      orgId,
      campaign.leadMagnetId || ''
    );

    return {
      id: campaign.id,
      name: campaign.name,
      goal: campaign.goal,
      slug: campaign.slug,
      startDate: campaign.startDate,
      days: campaign.days,
      tone: campaign.tone,
      notes: campaign.notes,
      status: campaign.status,
      magnet: magnet ? { id: magnet.id, title: magnet.title } : null,
      posts: campaign.posts.map((post) => {
        const flags = this.flags(
          post.content,
          post.pillar,
          this.maxLength(post.integration.providerIdentifier)
        );
        return {
          id: post.id,
          integrationId: post.integrationId,
          channel: post.integration.name,
          picture: post.integration.picture,
          provider: post.integration.providerIdentifier,
          publishAt: post.publishAt.toISOString(),
          pillar: post.pillar,
          mediaIdea: post.mediaIdea,
          content: post.content,
          status: post.status,
          postId: post.postId,
          note: post.note,
          flags,
          blocked: flags.some((p) => p.severity === 'high'),
        };
      }),
    };
  }

  async createCampaign(orgId: string, body: CampaignDto) {
    if (!this._anthropicService.isAvailable()) {
      throw new BadRequestException(
        'Claude is not set up on this server (ANTHROPIC_API_KEY)'
      );
    }
    if (body.startDate < this.ukToday()) {
      throw new BadRequestException('The start date is in the past');
    }

    const magnet = await this._leadLinksRepository.getMagnet(
      orgId,
      body.leadMagnetId
    );
    if (!magnet) {
      throw new NotFoundException('Lead magnet not found');
    }

    const integrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter(
      (p) => body.integrationIds.includes(p.id) && !p.disabled && !p.deletedAt
    );
    if (integrations.length !== body.integrationIds.length) {
      throw new NotFoundException('A channel was not found or is disabled');
    }

    // the skeleton: when each post goes out and what it is for
    const now = Date.now();
    const skeleton: Array<
      CampaignSlot & { integrationId: string; date: Date; time: string }
    > = [];
    for (const integration of integrations) {
      const slots = this._mixService
        .planSlots(integration.providerIdentifier, body.startDate, body.days)
        .filter((p) => p.date.getTime() > now + SOON);
      const roles = this.roles(slots.length);
      const needsMedia = await this.needsMedia(integration.providerIdentifier);
      slots.forEach((slot, index) => {
        skeleton.push({
          slot: skeleton.length,
          platform: this.baseProvider(integration.providerIdentifier),
          maxLength: this.maxLength(integration.providerIdentifier),
          needsMedia,
          day: slot.day + 1,
          role: roles[index].role,
          pillar: roles[index].pillar,
          integrationId: integration.id,
          date: slot.date,
          time: slot.time,
        });
      });
    }

    if (!skeleton.length) {
      throw new BadRequestException(
        'No posting times are left in that period, pick a later start date'
      );
    }
    if (skeleton.length > MAX_SLOTS) {
      throw new BadRequestException(
        `That is ${skeleton.length} posts, the most for one campaign is ${MAX_SLOTS}. Use fewer channels or days.`
      );
    }

    const voice = await this._xVoiceService.resolve(orgId, {});
    const draft = await this._anthropicService.draftCampaign(
      {
        name: body.name,
        goal: body.goal,
        tone: body.tone,
        notes: body.notes,
        magnetTitle: magnet.title,
        magnetDescription: magnet.description || undefined,
        voice: voice?.styleGuide || undefined,
      },
      skeleton.map(
        ({ slot, platform, maxLength, needsMedia, day, role, pillar }) => ({
          slot,
          platform,
          maxLength,
          needsMedia,
          day,
          role,
          pillar,
        })
      )
    );
    if (draft.status !== 'ok') {
      throw new BadRequestException(
        draft.status === 'rate_limited'
          ? 'Claude is busy, try again in a minute'
          : 'Claude could not draft the campaign, try again'
      );
    }
    const drafts = new Map(draft.data.map((p) => [p.slot, p]));
    if (skeleton.some((p) => !drafts.has(p.slot))) {
      throw new BadRequestException(
        'Claude did not write every post, try again'
      );
    }

    const slug = this.slug(body.name);
    const posts = skeleton.map((item) => {
      const written = drafts.get(item.slot)!;
      const integration = integrations.find((p) => p.id === item.integrationId)!;
      const withLink = ['offer', 'last'].includes(item.role);
      const link = addUtmToUrl(magnet.url, {
        utm_source: this.baseProvider(integration.providerIdentifier),
        utm_medium: 'social',
        utm_campaign: slug,
      });
      let content = written.content.trim();
      if (withLink) {
        content = content.includes('{{link}}')
          ? content.replace(/\{\{link\}\}/g, link)
          : `${content}\n${link}`;
      } else {
        content = content.replace(/\{\{link\}\}/g, '').trim();
      }
      return {
        integrationId: item.integrationId,
        publishAt: item.date,
        pillar: item.pillar,
        mediaIdea: item.needsMedia ? written.mediaIdea.trim() || null : null,
        content,
        sortOrder: item.slot,
      };
    });

    return this._repository.createCampaign(
      orgId,
      {
        name: body.name,
        goal: body.goal,
        slug,
        leadMagnetId: magnet.id,
        startDate: new Date(`${body.startDate}T00:00:00Z`),
        days: body.days,
        tone: body.tone,
        notes: body.notes,
      },
      posts
    );
  }

  private async postOrFail(orgId: string, id: string) {
    const post = await this._repository.getPost(orgId, id);
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  async updatePost(orgId: string, id: string, body: CampaignPostDto) {
    const post = await this.postOrFail(orgId, id);
    if (!EDITABLE.includes(post.status)) {
      throw new BadRequestException(
        'This post is already approved, change it in the calendar'
      );
    }

    let publishAt: Date | undefined;
    if (body.publishAt) {
      publishAt = new Date(body.publishAt);
      if (isNaN(publishAt.getTime()) || publishAt.getTime() < Date.now()) {
        throw new BadRequestException('Pick a time in the future');
      }
    }

    await this._repository.updatePost(id, {
      ...(typeof body.content === 'string' ? { content: body.content } : {}),
      ...(publishAt ? { publishAt } : {}),
    });
    return { saved: true };
  }

  async rejectPost(orgId: string, id: string) {
    const post = await this.postOrFail(orgId, id);
    if (!EDITABLE.includes(post.status)) {
      throw new BadRequestException(
        'This post is already approved, delete it in the calendar'
      );
    }
    await this._repository.updatePost(id, { status: 'REJECTED' });
    return { status: 'REJECTED' };
  }

  // Approving is the only way a campaign post reaches the calendar. The
  // compliance check has to pass first. A channel that needs media gets a
  // calendar draft to add it to, everything else is scheduled.
  async approvePost(orgId: string, id: string) {
    const post = await this.postOrFail(orgId, id);
    if (!EDITABLE.includes(post.status)) {
      throw new BadRequestException('This post is already approved');
    }

    const blocking = this.flags(
      post.content,
      post.pillar,
      this.maxLength(post.integration.providerIdentifier)
    ).filter((p) => p.severity === 'high');
    if (blocking.length) {
      throw new BadRequestException(
        `Fix this before approving: ${blocking.map((p) => p.message).join('; ')}`
      );
    }
    if (post.publishAt.getTime() < Date.now() + SOON) {
      throw new BadRequestException('The time has passed, pick a later time');
    }

    const row = {
      integrationId: post.integrationId,
      date: post.publishAt.toISOString(),
      content: post.content,
    };
    const scheduled = await this._growthToolsService.bulkSchedule(orgId, {
      type: 'schedule',
      rows: [row],
    });
    let status = 'APPROVED';
    let note: string | null = null;
    let result = scheduled.results[0];

    if (!result.ok) {
      // the channel could not take it as it is, keep it as a calendar draft
      const draft = await this._growthToolsService.bulkSchedule(orgId, {
        type: 'draft',
        rows: [row],
      });
      result = draft.results[0];
      if (!result.ok) {
        throw new BadRequestException(
          result.error || 'The post could not be created'
        );
      }
      status = 'NEEDS_MEDIA';
      note =
        scheduled.results[0].error ||
        'Saved as a draft in the calendar, add what it needs and schedule it there';
    }

    await this._repository.updatePost(id, {
      status,
      postId: result.postId || null,
      note,
    });
    await this._repository.activateCampaign(post.campaignId);
    return { status, note };
  }
}
