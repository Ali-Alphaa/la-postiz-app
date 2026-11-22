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
import { countLength } from '@gitroom/helpers/utils/count.length';
import {
  checkTradingCompliance,
  stripPostHtml,
} from '@gitroom/helpers/utils/trading.compliance';
import {
  CampaignDto,
  CampaignDuplicateDto,
  CampaignPostDto,
} from '@gitroom/nestjs-libraries/dtos/growth/campaign.dto';

const MAX_SLOTS = 90;
// slots written by Claude in one call, longer campaigns are drafted in parallel batches
const DRAFT_BATCH = 45;
// how long a playbook runs
const PLAYBOOK_DAYS: Record<string, number> = {
  lead_magnet_7: 7,
  lead_magnet_14: 14,
};
const DAY = 86400000;
// a normal stretch is measured over the 4 weeks before the campaign
const BASELINE_DAYS = 28;
// sign-ups that still come in after the last post count for the campaign
const TAIL_DAYS = 3;
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
  private roles(slots: Array<{ day: number }>, playbook: string) {
    if (playbook !== 'lead_magnet_14') {
      return this.singleWeekRoles(slots.length);
    }

    // the first week warms up with a teaser, value and proof, the second week
    // pushes the offer on its first post, with a last reminder at the end
    const roles: Array<{ role: string; pillar: string }> = [];
    const value = (position: number) => ({
      role: 'value',
      pillar: position % 2 ? 'risk_psychology' : 'rulebook',
    });
    const indexes = (from: number, to: number) =>
      slots.flatMap((slot, index) =>
        slot.day >= from && slot.day < to ? [index] : []
      );

    const one = indexes(0, 7);
    one.forEach((slot, position) => {
      roles[slot] =
        position === 0 && one.length >= 2
          ? { role: 'teaser', pillar: 'risk_psychology' }
          : position === Math.round(0.6 * (one.length - 1)) && one.length >= 4
          ? { role: 'proof', pillar: 'behind_scenes' }
          : value(position);
    });

    const two = indexes(7, 1000);
    two.forEach((slot, position) => {
      roles[slot] =
        position === 0 && two.length >= 2
          ? { role: 'offer', pillar: 'offer' }
          : position === two.length - 1 && two.length >= 4
          ? { role: 'last', pillar: 'offer' }
          : position === Math.round(0.5 * (two.length - 1)) && two.length >= 5
          ? { role: 'proof', pillar: 'behind_scenes' }
          : value(position);
    });

    return roles;
  }

  private singleWeekRoles(count: number) {
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

  // The length is counted the way the channel counts it (X counts a link as
  // 23 characters, so the long tracking link does not make a post too long).
  flags(
    content: string,
    pillar: string,
    maxLength: number,
    provider = '',
    profile = 'trading'
  ): CampaignFlag[] {
    const text = stripPostHtml(content);
    const length = countLength(this.baseProvider(provider), text);
    const flags: CampaignFlag[] = [];

    if (!text) {
      flags.push({
        code: 'empty',
        severity: 'high',
        message: 'The post is empty',
      });
    }
    if (length > maxLength) {
      flags.push({
        code: 'too_long',
        severity: 'high',
        message: `${length} characters, the channel takes ${maxLength}`,
      });
    }
    for (const flag of profile === 'trading'
      ? checkTradingCompliance(content)
      : []) {
      flags.push({
        code: 'claims',
        severity: flag.severity,
        message: `"${flag.phrase}": ${flag.reason}`,
      });
    }
    if (
      profile === 'trading' &&
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
    if (/\[NEED:/i.test(text)) {
      flags.push({
        code: 'needs_story',
        severity: 'high',
        message: 'Replace the [NEED: ...] placeholder with your real story',
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
        playbook: campaign.playbook,
        profile: campaign.profile,
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
      playbook: campaign.playbook,
      profile: campaign.profile,
      tone: campaign.tone,
      notes: campaign.notes,
      status: campaign.status,
      magnet: magnet ? { id: magnet.id, title: magnet.title } : null,
      posts: campaign.posts.map((post) => {
        const flags = this.flags(
          post.content,
          post.pillar,
          this.maxLength(post.integration.providerIdentifier),
          post.integration.providerIdentifier,
          campaign.profile
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
          variations: Array.isArray(post.variations)
            ? (post.variations as string[])
            : [],
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
    const playbook =
      body.playbook || (body.days === 14 ? 'lead_magnet_14' : 'lead_magnet_7');
    const days = PLAYBOOK_DAYS[playbook];
    const now = Date.now();
    const skeleton: Array<
      CampaignSlot & { integrationId: string; date: Date; time: string }
    > = [];
    for (const integration of integrations) {
      const slots = this._mixService
        .planSlots(integration.providerIdentifier, body.startDate, days)
        .filter((p) => p.date.getTime() > now + SOON);
      const roles = this.roles(slots, playbook);
      const needsMedia = await this.needsMedia(integration.providerIdentifier);
      slots.forEach((slot, index) => {
        skeleton.push({
          slot: skeleton.length,
          platform: this.baseProvider(integration.providerIdentifier),
          maxLength: this.maxLength(integration.providerIdentifier),
          needsMedia,
          day: slot.day + 1,
          role: roles[index].role,
          // risk and psychology posts only exist for trading
          pillar:
            body.profile === 'web_studio' && roles[index].pillar === 'risk_psychology'
              ? 'rulebook'
              : roles[index].pillar,
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

    const profile = body.profile || 'trading';
    // the saved X voice is the trading voice
    const voice =
      profile === 'trading'
        ? await this._xVoiceService.resolve(orgId, {})
        : undefined;
    const brief = {
      name: body.name,
      goal: body.goal,
      tone: body.tone,
      notes: body.notes,
      magnetTitle: magnet.title,
      magnetDescription: magnet.description || undefined,
      voice: voice?.styleGuide || undefined,
      profile,
    };
    // About half of the X posts close on a question: statement, pure question,
    // statement, question with a stance. Offer and last posts keep their call
    // to action.
    const closings = ['statement', 'question_pure', 'statement', 'question_stance'];
    const closingCount: Record<string, number> = {};
    const aiSlots = skeleton.map(
      ({ slot, platform, maxLength, needsMedia, day, role, pillar, integrationId }) => {
        let closing: string | undefined;
        if (platform === 'x') {
          if (['offer', 'last'].includes(role)) {
            closing = 'cta';
          } else {
            const index = closingCount[integrationId] || 0;
            closingCount[integrationId] = index + 1;
            closing = closings[index % closings.length];
          }
        }
        return {
          slot,
          platform,
          maxLength,
          needsMedia,
          day,
          role,
          pillar,
          ...(closing ? { closing } : {}),
        };
      }
    );
    const batches: CampaignSlot[][] = [];
    for (let index = 0; index < aiSlots.length; index += DRAFT_BATCH) {
      batches.push(aiSlots.slice(index, index + DRAFT_BATCH));
    }
    const written = await Promise.all(
      batches.map((batch) =>
        this._anthropicService.draftCampaign(brief, batch)
      )
    );
    const failed = written.find((p) => p.status !== 'ok');
    if (failed) {
      throw new BadRequestException(
        failed.status === 'rate_limited'
          ? 'Claude is busy, try again in a minute'
          : 'Claude could not draft the campaign, try again'
      );
    }
    const drafts = new Map(
      written.flatMap((p) => (p.status === 'ok' ? p.data : [])).map((p) => [p.slot, p])
    );
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
      const fill = (text: string) => {
        let filled = text.trim();
        if (withLink) {
          filled = filled.includes('{{link}}')
            ? filled.replace(/\{\{link\}\}/g, link)
            : `${filled}\n${link}`;
        } else {
          filled = filled.replace(/\{\{link\}\}/g, '').trim();
        }
        return filled;
      };
      const content = fill(written.content);
      // the other layouts of an X post, the chosen one is content
      const versions = [
        content,
        ...(written.variations || []).map(fill).filter((p) => p),
      ].filter((p, index, all) => all.indexOf(p) === index);
      return {
        integrationId: item.integrationId,
        publishAt: item.date,
        pillar: item.pillar,
        mediaIdea: item.needsMedia ? written.mediaIdea.trim() || null : null,
        content,
        ...(versions.length > 1 ? { variations: versions } : {}),
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
        days,
        playbook,
        profile,
        tone: body.tone,
        notes: body.notes,
      },
      posts
    );
  }

  private ukDay(date: Date) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London',
    }).format(date);
  }

  // How a campaign did: sign-ups credited to it (through utm_campaign, and to a
  // post through utm_content), reach and engagement of its posts, and the
  // comparison with a normal stretch before it started
  async getResults(orgId: string, id: string) {
    const campaign = await this._repository.getCampaign(orgId, id);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }

    const now = Date.now();
    const start = campaign.startDate;
    const end = new Date(start.getTime() + campaign.days * DAY);
    const before = new Date(start.getTime() - BASELINE_DAYS * DAY);
    const posts = campaign.posts.filter((p) => !!p.postId);
    const postIds = posts.map((p) => p.postId as string);
    const integrationIds = [
      ...new Set(campaign.posts.map((p) => p.integrationId)),
    ];

    // all sign-ups of the same length so far, whatever brought them
    const windowEnd = new Date(Math.min(now, end.getTime()));
    const [
      conversions,
      engagements,
      states,
      utmEnabled,
      baselineLeads,
      windowLeads,
      baseline,
    ] = await Promise.all([
        this._repository.getConversions(orgId, campaign.slug),
        postIds.length
          ? this._repository.getEngagements(orgId, postIds)
          : Promise.resolve([]),
        postIds.length
          ? this._repository.getPostStates(orgId, postIds)
          : Promise.resolve([]),
        this._repository.isUtmEnabled(orgId),
        this._repository.countLeads(orgId, before, start),
        this._repository.countLeads(orgId, start, windowEnd),
        this._repository.getBaselineEngagement(
          orgId,
          integrationIds,
          before,
          start
        ),
      ]);

    const stateOf = new Map(states.map((p) => [p.id, p]));
    const engagementOf = new Map(engagements.map((p) => [p.postId, p]));
    const leads = conversions.filter((p) => p.type === 'lead');
    const sales = conversions.filter((p) => p.type === 'sale');

    const byPost = campaign.posts.map((post) => {
      const state = post.postId ? stateOf.get(post.postId) : undefined;
      const engagement = post.postId ? engagementOf.get(post.postId) : undefined;
      return {
        id: post.id,
        channel: post.integration.name,
        provider: this.baseProvider(post.integration.providerIdentifier),
        pillar: post.pillar,
        publishAt: post.publishAt.toISOString(),
        preview: stripPostHtml(post.content).slice(0, 90),
        state: state?.state || 'QUEUE',
        scheduled: !!post.postId,
        releaseURL: state?.releaseURL || null,
        leads: post.postId
          ? leads.filter((p) => p.postId === post.postId).length
          : 0,
        impressions: engagement?.impressions || 0,
        engagement: engagement?.engagement || 0,
      };
    });

    // one row for every platform of the campaign
    const platforms = new Map<
      string,
      {
        platform: string;
        posts: number;
        sent: number;
        failed: number;
        leads: number;
        impressions: number;
        engagement: number;
      }
    >();
    for (const post of byPost) {
      const row = platforms.get(post.provider) || {
        platform: post.provider,
        posts: 0,
        sent: 0,
        failed: 0,
        leads: leads.filter((p) => p.utmSource === post.provider).length,
        impressions: 0,
        engagement: 0,
      };
      row.posts++;
      if (post.scheduled && post.state === 'PUBLISHED') row.sent++;
      if (post.scheduled && post.state === 'ERROR') row.failed++;
      row.impressions += post.impressions;
      row.engagement += post.engagement;
      platforms.set(post.provider, row);
    }

    // sign-ups a day, in UK time, from the first day to a few days after the last
    const first = new Date(`${start.toISOString().slice(0, 10)}T12:00:00Z`);
    const daily = [...Array(campaign.days + TAIL_DAYS)].map((_, index) => {
      const day = this.ukDay(new Date(first.getTime() + index * DAY));
      return {
        date: day,
        leads: leads.filter((p) => this.ukDay(p.createdAt) === day).length,
      };
    });

    // against a normal stretch: per day for sign-ups, per post for reach
    const elapsed = Math.min(
      campaign.days,
      Math.max(
        0,
        Math.ceil((Math.min(now, end.getTime()) - start.getTime()) / DAY)
      )
    );
    const baselinePerDay = baselineLeads / BASELINE_DAYS;
    // every sign-up in the campaign days against every sign-up in a normal day,
    // the ones this campaign's links brought are in totals.leads
    const campaignPerDay = elapsed ? windowLeads / elapsed : null;
    const measured = engagements.length;
    const total = (key: 'engagement' | 'impressions') =>
      engagements.reduce((all, p) => all + p[key], 0);
    const perPost = (key: 'engagement' | 'impressions') =>
      measured ? total(key) / measured : null;
    const lift = (value: number | null, normal: number) =>
      value !== null && normal > 0 ? value / normal - 1 : null;

    const currencies = [
      ...new Set(
        sales.filter((p) => p.currency).map((p) => p.currency!.toUpperCase())
      ),
    ];

    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        slug: campaign.slug,
        startDate: campaign.startDate,
        days: campaign.days,
        status: !postIds.length
          ? 'NOT_SCHEDULED'
          : now < start.getTime()
          ? 'NOT_STARTED'
          : now < end.getTime()
          ? 'RUNNING'
          : 'ENDED',
      },
      totals: {
        posts: campaign.posts.length,
        sent: byPost.filter((p) => p.scheduled && p.state === 'PUBLISHED').length,
        failed: byPost.filter((p) => p.scheduled && p.state === 'ERROR').length,
        leads: leads.length,
        sales: sales.length,
        salesValue: sales.reduce((all, p) => all + p.value, 0),
        currencies,
        impressions: total('impressions'),
        engagement: total('engagement'),
        measuredPosts: measured,
      },
      baseline: {
        days: BASELINE_DAYS,
        leadsPerDay: baselinePerDay,
        campaignLeadsPerDay: campaignPerDay,
        leadsLift: lift(campaignPerDay, baselinePerDay),
        engagementPerPost: baseline.engagement,
        campaignEngagementPerPost: perPost('engagement'),
        engagementLift: lift(perPost('engagement'), baseline.engagement),
        impressionsPerPost: baseline.impressions,
        campaignImpressionsPerPost: perPost('impressions'),
        baselinePosts: baseline.posts,
      },
      platforms: [...platforms.values()],
      posts: byPost
        .filter((p) => p.scheduled && (p.state === 'PUBLISHED' || p.leads))
        .sort((a, b) => b.leads - a.leads || b.engagement - a.engagement)
        .slice(0, 10),
      daily,
      tracking: {
        // a sign-up is credited to its post only when the post link carries utm_content
        utmEnabled,
        unattributed: leads.filter((p) => !p.postId).length,
      },
    };
  }

  // Puts a finished campaign away. Its posts and results stay, and posts that
  // are already scheduled in the calendar are not touched.
  async archiveCampaign(orgId: string, id: string) {
    if (!(await this._repository.setCampaignStatus(orgId, id, 'ARCHIVED'))) {
      throw new NotFoundException('Campaign not found');
    }
    return { status: 'ARCHIVED' };
  }

  async unarchiveCampaign(orgId: string, id: string) {
    const campaign = await this._repository.getCampaign(orgId, id);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    const status = campaign.posts.some((p) =>
      ['APPROVED', 'NEEDS_MEDIA'].includes(p.status)
    )
      ? 'ACTIVE'
      : 'DRAFT';
    await this._repository.setCampaignStatus(orgId, id, status);
    return { status };
  }

  // A new campaign with the brief, playbook and channels of an earlier one, on a
  // new start date. Claude writes new posts, nothing is copied from the old ones.
  async duplicateCampaign(
    orgId: string,
    id: string,
    body: CampaignDuplicateDto
  ) {
    const campaign = await this._repository.getCampaign(orgId, id);
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return this.createCampaign(orgId, {
      name: body.name || `${campaign.name} (again)`,
      goal: campaign.goal || undefined,
      leadMagnetId: campaign.leadMagnetId || '',
      startDate: body.startDate,
      playbook: campaign.playbook,
      profile: campaign.profile,
      integrationIds: [...new Set(campaign.posts.map((p) => p.integrationId))],
      tone: campaign.tone || undefined,
      notes: campaign.notes || undefined,
    });
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
      this.maxLength(post.integration.providerIdentifier),
      post.integration.providerIdentifier,
      post.campaign.profile
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
