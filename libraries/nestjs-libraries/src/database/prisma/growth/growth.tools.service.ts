import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import isoWeek from 'dayjs/plugin/isoWeek';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { GrowthToolsRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.tools.repository';
import { GrowthRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.repository';
import { LeadLinksRepository } from '@gitroom/nestjs-libraries/database/prisma/lead-links/lead.links.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AnthropicService } from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import {
  BioPageDto,
  BrandKitDto,
  BulkScheduleDto,
  ConversionDto,
} from '@gitroom/nestjs-libraries/dtos/growth/growth.tools.dto';
import { stripPostHtml } from '@gitroom/helpers/utils/trading.compliance';

dayjs.extend(utc);
dayjs.extend(isoWeek);

const DEFAULT_BRAND = {
  background: '#0B0B0F',
  text: '#FFFFFF',
  accent: '#612BD3',
  handle: '',
};

// what a post said must not carry over to the next one (a YouTube or Reddit title)
const withoutTitles = (value: any): any =>
  Array.isArray(value)
    ? value.map(withoutTitles)
    : value && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => key !== 'title')
          .map(([key, inner]) => [key, withoutTitles(inner)])
      )
    : value;

const textToParagraphs = (text: string) =>
  text
    .split('\n')
    .map((line) =>
      line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    )
    .map((line) => `<p>${line}</p>`)
    .join('');

@Injectable()
export class GrowthToolsService {
  constructor(
    private _repository: GrowthToolsRepository,
    private _growthRepository: GrowthRepository,
    private _leadLinksRepository: LeadLinksRepository,
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _notificationService: NotificationService,
    private _anthropicService: AnthropicService
  ) {}

  async getBrandKit(orgId: string) {
    return (await this._repository.getBrandKit(orgId)) || DEFAULT_BRAND;
  }

  saveBrandKit(orgId: string, body: BrandKitDto) {
    return this._repository.saveBrandKit(orgId, body);
  }

  // Every row is handled on its own: a bad row is reported, the rest go through
  async bulkSchedule(orgId: string, body: BulkScheduleDto) {
    const results: Array<{ row: number; ok: boolean; error?: string }> = [];
    for (const [index, row] of body.rows.entries()) {
      try {
        await this.bulkRow(orgId, body.type, row);
        results.push({ row: index + 1, ok: true });
      } catch (err) {
        results.push({
          row: index + 1,
          ok: false,
          error: (err as Error).message || 'Could not create the post',
        });
      }
    }
    return { created: results.filter((p) => p.ok).length, results };
  }

  private async bulkRow(
    orgId: string,
    type: 'draft' | 'schedule',
    row: BulkScheduleDto['rows'][number]
  ) {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      row.integrationId
    );
    if (!integration || integration.deletedAt || integration.disabled) {
      throw new NotFoundException('Channel not found');
    }

    const date = dayjs.utc(row.date);
    if (!date.isValid()) {
      throw new BadRequestException('The date is not valid');
    }
    if (type === 'schedule' && !date.isAfter(dayjs.utc())) {
      throw new BadRequestException('The date must be in the future');
    }

    // the settings of the last post of the channel, like the A/B tests
    let lastSettings = {};
    try {
      lastSettings = JSON.parse(
        (
          await this._growthRepository.getLastPostSettings(
            orgId,
            integration.id
          )
        )?.settings || '{}'
      );
    } catch (err) {}
    const settings = {
      ...withoutTitles(lastSettings),
      __type: integration.providerIdentifier,
    };
    const value = [
      {
        content: textToParagraphs(row.content.trim()),
        delay: 0,
        image: [] as any[],
      },
    ];

    if (type === 'schedule') {
      const [validation] = await this._postsService.validatePosts(orgId, [
        { integration: { id: integration.id }, settings, value },
      ]);
      if (!validation.valid) {
        throw new BadRequestException(
          validation.settingsError ||
            'Post to this channel once from the composer first, or import as drafts'
        );
      }
      if (validation.errors !== true) {
        throw new BadRequestException(validation.errors);
      }
      if (validation.tooLong) {
        throw new BadRequestException(
          `The maximum characters is ${validation.maximumCharacters}`
        );
      }
    }

    const [created] = await this._postsService.createPost(
      orgId,
      {
        date: date.format('YYYY-MM-DDTHH:mm:ss') + 'Z',
        type,
        shortLink: false,
        tags: [],
        posts: [
          {
            integration: { id: integration.id },
            group: makeId(10),
            settings,
            value,
          },
        ],
      } as any,
      'WEB'
    );
    if (!created?.postId) {
      throw new BadRequestException('The post could not be created');
    }
  }

  // utm_content holds the id of the post the visitor came from
  async recordConversion(orgId: string, body: ConversionDto) {
    const post = body.utmContent
      ? await this._repository.postExists(orgId, body.utmContent)
      : null;
    await this._repository.saveConversion(orgId, post?.id || null, body);
    return { recorded: true, attributed: !!post };
  }

  async getRevenue(orgId: string, days = 30) {
    const conversions = await this._repository.getConversions(
      orgId,
      dayjs.utc().subtract(days, 'day').toDate()
    );

    const add = (
      map: Map<string, { leads: number; sales: number; value: number }>,
      key: string,
      p: (typeof conversions)[number]
    ) => {
      const row = map.get(key) || { leads: 0, sales: 0, value: 0 };
      if (p.type === 'lead') {
        row.leads++;
      } else {
        row.sales++;
        row.value += p.value;
      }
      map.set(key, row);
    };

    const byPost = new Map<
      string,
      { leads: number; sales: number; value: number }
    >();
    const bySource = new Map<
      string,
      { leads: number; sales: number; value: number }
    >();
    const byMessage = new Map<
      string,
      { leads: number; sales: number; value: number }
    >();
    for (const p of conversions) {
      add(bySource, p.utmSource || 'unknown', p);
      if (p.postId) {
        add(byPost, p.postId, p);
      }
      if (p.messageTag) {
        add(byMessage, p.messageTag, p);
      }
    }

    const posts = await this._repository.getPostsSummary(orgId, [
      ...byPost.keys(),
    ]);

    // a tag is platform-code-position, like x-bt-08
    const leadMessages = byMessage.size
      ? await this._leadLinksRepository.getReportMessages(orgId)
      : [];
    const messages = [...byMessage.entries()].flatMap(([tag, row]) => {
      const [, platform, code, position] =
        tag.match(/^([a-z]+)-([a-z0-9]{2,8})-(\d{2})$/) || [];
      const message = leadMessages.find(
        (p) => p.magnet.code === code && p.position === Number(position)
      );
      return message
        ? [
            {
              tag,
              platform,
              magnet: message.magnet.title,
              position: message.position,
              label: message.label,
              tone: message.tone,
              ...row,
            },
          ]
        : [];
    });

    return {
      days,
      // values are added up as they are: more than one means the total mixes them
      currencies: [
        ...new Set(
          conversions
            .filter((p) => p.type === 'sale' && p.currency)
            .map((p) => p.currency!.toUpperCase())
        ),
      ],
      totals: {
        leads: conversions.filter((p) => p.type === 'lead').length,
        sales: conversions.filter((p) => p.type === 'sale').length,
        value: conversions.reduce(
          (all, p) => all + (p.type === 'sale' ? p.value : 0),
          0
        ),
        attributed: conversions.filter((p) => p.postId).length,
      },
      sources: [...bySource.entries()]
        .map(([source, row]) => ({ source, ...row }))
        .sort((a, b) => b.value - a.value || b.leads - a.leads),
      posts: posts
        .map((p) => ({
          id: p.id,
          text: stripPostHtml(p.content).slice(0, 160),
          url: p.releaseURL,
          publishDate: p.publishDate,
          channel: p.integration?.name,
          ...byPost.get(p.id)!,
        }))
        .sort((a, b) => b.value - a.value || b.leads - a.leads)
        .slice(0, 25),
      messages: messages.sort((a, b) => b.leads - a.leads || b.value - a.value),
    };
  }

  async getBioPage(orgId: string) {
    const page = await this._repository.getBioPage(orgId);
    if (!page) {
      return null;
    }
    const clicks = await this._repository.countBioClicks(
      page.id,
      dayjs.utc().subtract(30, 'day').toDate()
    );
    return {
      ...page,
      clicks: Object.fromEntries(clicks.map((p) => [p.linkKey, p._count._all])),
    };
  }

  async saveBioPage(orgId: string, body: BioPageDto) {
    const taken = await this._repository.getBioPageBySlug(body.slug);
    if (taken && taken.organizationId !== orgId) {
      throw new ConflictException('This address is already taken');
    }
    return this._repository.saveBioPage(orgId, {
      slug: body.slug,
      title: body.title,
      bio: body.bio || null,
      avatar: body.avatar || null,
      enabled: body.enabled,
      links: body.links.map((p) => ({
        key: p.key || makeId(10),
        title: p.title,
        url: p.url,
      })),
    });
  }

  async getPublicBioPage(slug: string) {
    const page = await this._repository.getPublicBioPage(slug);
    if (!page) {
      throw new NotFoundException('Page not found');
    }
    return {
      slug: page.slug,
      title: page.title,
      bio: page.bio,
      avatar: page.avatar,
      links: (page.links as Array<{ key: string; title: string }>).map((p) => ({
        key: p.key,
        title: p.title,
      })),
    };
  }

  // Only a link stored on the page can be the target, so this is no open redirect
  async bioRedirect(slug: string, key: string) {
    const page = await this._repository.getPublicBioPage(slug);
    const link = page
      ? (page.links as Array<{ key: string; url: string }>).find(
          (p) => p.key === key
        )
      : null;
    if (!page || !link) {
      throw new NotFoundException('Link not found');
    }

    await this._repository.addBioClick(page.id, key);

    const url = new URL(link.url);
    if (!url.searchParams.has('utm_source')) {
      url.searchParams.set('utm_source', 'bio');
      url.searchParams.set('utm_medium', 'link_in_bio');
    }
    return url.toString();
  }

  getWeeklyReviews(orgId: string) {
    return this._repository.getWeeklyReviews(orgId);
  }

  // The week that just ended. An existing review is only replaced when asked.
  async generateWeeklyReview(orgId: string, force = false) {
    if (!this._anthropicService.isAvailable()) {
      return { available: false, created: false, error: null };
    }

    const weekStart = dayjs.utc().startOf('isoWeek').subtract(1, 'week');
    const weekEnd = weekStart.add(1, 'week');
    if (
      !force &&
      (await this._repository.getWeeklyReview(orgId, weekStart.toDate()))
    ) {
      return { available: true, created: false, error: null };
    }

    const posts = await this._repository.getEngagement(
      orgId,
      weekStart.toDate(),
      weekEnd.toDate(),
      100
    );
    if (!posts.length) {
      return { available: true, created: false, error: 'no_data' };
    }

    const previous = await this._repository.getEngagement(
      orgId,
      weekStart.subtract(1, 'week').toDate(),
      weekStart.toDate(),
      100
    );
    const conversions = await this._repository.getConversions(
      orgId,
      weekStart.toDate(),
      weekEnd.toDate()
    );
    const row = (p: (typeof posts)[number]) => ({
      channel: p.post?.integration?.name,
      text: stripPostHtml(p.post?.content || '').slice(0, 280),
      engagement: p.engagement,
      impressions: p.impressions,
    });
    const data = {
      posts: posts.length,
      engagement: posts.reduce((all, p) => all + p.engagement, 0),
      previousPosts: previous.length,
      previousEngagement: previous.reduce((all, p) => all + p.engagement, 0),
      leads: conversions.filter((p) => p.type === 'lead').length,
      sales: conversions.filter((p) => p.type === 'sale').length,
      best: posts.slice(0, 5).map(row),
      worst: posts.slice(-3).reverse().map(row),
    };

    const summary = await this._anthropicService.writeWeeklyReview(data);
    if (summary.status !== 'ok') {
      return { available: true, created: false, error: summary.status };
    }

    await this._repository.saveWeeklyReview(
      orgId,
      weekStart.toDate(),
      summary.data,
      data
    );
    await this._notificationService.inAppNotification(
      orgId,
      'Your weekly review is ready',
      'Your weekly content review is ready under Growth, Weekly review.'
    );
    return { available: true, created: true, error: null };
  }

  // the hourly job: one review per organization per week, skipped once it exists
  async generateDueReviews() {
    for (const {
      organizationId,
    } of await this._repository.getOrganizationsWithGrowth()) {
      try {
        await this.generateWeeklyReview(organizationId);
      } catch (err) {
        console.log(err);
      }
    }
  }

  organizationsWithGrowth() {
    return this._repository.getOrganizationsWithGrowth();
  }

  bestPosts(orgId: string, days: number, take: number) {
    return this._repository.getEngagement(
      orgId,
      dayjs.utc().subtract(days, 'day').toDate(),
      dayjs.utc().toDate(),
      take
    );
  }
}
