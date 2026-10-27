import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { chunk } from 'lodash';
import { GrowthRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import {
  bestTimeToPost,
  engagementFromAnalytics,
  extractHashtags,
  isValidTimezone,
  localHourToUtcMinutes,
  pickAbWinner,
  rankHashtags,
  selectRecycleCandidates,
} from '@gitroom/helpers/utils/growth.metrics';
import { RecycleSettingsDto } from '@gitroom/nestjs-libraries/dtos/growth/recycle.settings.dto';
import { AiHashtagsDto } from '@gitroom/nestjs-libraries/dtos/growth/hashtags.dto';
import { AbExperimentDto } from '@gitroom/nestjs-libraries/dtos/growth/ab.experiment.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
dayjs.extend(utc);

// How many published posts the hourly collection reads from the providers,
// and how often the engagement of a post is refreshed (posts stop being
// refreshed after ENGAGEMENT_DAYS, their engagement is final by then)
const ENGAGEMENT_BATCH = 200;
const ENGAGEMENT_STALE_HOURS = 12;
const ENGAGEMENT_DAYS = 30;
const ANALYTICS_CONCURRENCY = 5;

@Injectable()
export class GrowthService {
  constructor(
    private _growthRepository: GrowthRepository,
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _integrationManager: IntegrationManager,
    private _openaiService: OpenaiService,
    private _notificationService: NotificationService
  ) {}

  private analyticsProviders() {
    return socialIntegrationList
      .filter((p) => !!p.postAnalytics)
      .map((p) => p.identifier);
  }

  private async checkIntegration(orgId: string, integrationId: string) {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );

    if (!integration || integration.deletedAt) {
      throw new NotFoundException('Channel not found');
    }

    return integration;
  }

  // Reads the analytics of the posts from their provider and stores the
  // engagement. A post without analytics gets an empty snapshot (metrics
  // "{}"), so it isn't read again before it is stale, and is left out of
  // the scoring.
  private async storeEngagement(
    posts: Array<{
      id: string;
      organizationId: string;
      integrationId: string;
      publishDate: Date;
    }>
  ) {
    let stored = 0;
    for (const list of chunk(posts, ANALYTICS_CONCURRENCY)) {
      await Promise.all(
        list.map(async (post) => {
          try {
            const analytics = await this._postsService.checkPostAnalytics(
              post.organizationId,
              post.id,
              ENGAGEMENT_DAYS
            );

            if (!Array.isArray(analytics)) {
              return;
            }

            const { engagement, impressions, metrics } =
              engagementFromAnalytics(analytics);

            await this._growthRepository.saveEngagement({
              organizationId: post.organizationId,
              integrationId: post.integrationId,
              postId: post.id,
              publishDate: post.publishDate,
              engagement,
              impressions,
              metrics,
            });
            stored++;
          } catch (err) {
            console.log(err);
          }
        })
      );
    }

    return stored;
  }

  async collectEngagement() {
    const posts = await this._growthRepository.getPostsForEngagement({
      providers: this.analyticsProviders(),
      limit: ENGAGEMENT_BATCH,
      staleHours: ENGAGEMENT_STALE_HOURS,
      days: ENGAGEMENT_DAYS,
    });

    return this.storeEngagement(posts);
  }

  async refreshEngagement(orgId: string, integrationId: string) {
    await this.checkIntegration(orgId, integrationId);
    const posts = await this._growthRepository.getPostsForEngagement({
      providers: this.analyticsProviders(),
      limit: 30,
      staleHours: 1,
      days: 90,
      orgId,
      integrationId,
    });

    return { refreshed: await this.storeEngagement(posts) };
  }

  private async getScoredEngagements(orgId: string, integrationId?: string) {
    return (
      await this._growthRepository.getEngagements(orgId, integrationId)
    ).filter((p) => p.metrics !== '{}');
  }

  async getBestTime(orgId: string, integrationId: string, timezone: string) {
    const integration = await this.checkIntegration(orgId, integrationId);
    const tz = isValidTimezone(timezone) ? timezone : 'UTC';
    const engagements = await this.getScoredEngagements(orgId, integrationId);
    const result = bestTimeToPost(engagements, tz);

    return {
      ...result,
      timezone: tz,
      supported: !!this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      )?.postAnalytics,
      postingTimes: result.topSlots.map((slot) => ({
        time: localHourToUtcMinutes(slot.hour, tz),
      })),
    };
  }

  // Replaces the posting times of the channel with its best slots, through
  // the same path as the "Preferences > Time slots" modal
  async applyBestTime(orgId: string, integrationId: string, timezone: string) {
    const { postingTimes } = await this.getBestTime(
      orgId,
      integrationId,
      timezone
    );

    await this._integrationService.setTimes(orgId, integrationId, {
      time: postingTimes,
    });

    return { postingTimes };
  }

  async getHashtags(orgId: string, integrationId?: string) {
    if (integrationId) {
      await this.checkIntegration(orgId, integrationId);
    }

    const engagements = await this.getScoredEngagements(orgId, integrationId);
    const { baseline, hashtags } = rankHashtags(
      engagements.map((p) => ({
        content: p.post.content,
        engagement: p.engagement,
      }))
    );

    return {
      baseline,
      posts: engagements.length,
      hashtags: hashtags.slice(0, 30),
    };
  }

  async aiHashtags(orgId: string, body: AiHashtagsDto) {
    if (!this._openaiService.isAvailable()) {
      return { available: false, hashtags: [] as string[] };
    }

    const integration = body.integrationId
      ? await this.checkIntegration(orgId, body.integrationId)
      : undefined;
    const platform = integration
      ? this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        )?.name || integration.providerIdentifier
      : 'social media';

    try {
      const existing = extractHashtags(body.content);
      const hashtags = (
        await this._openaiService.generateHashtags(body.content, platform)
      )
        .map((p) => p.replace(/^#/, '').replace(/\s+/g, ''))
        .filter((p) => !!p && !existing.includes(p.toLowerCase()));

      return { available: true, hashtags: [...new Set(hashtags)] };
    } catch (err) {
      console.log(err);
      return { available: true, hashtags: [] as string[] };
    }
  }

  async getRecycle(orgId: string) {
    const [settings, recycles] = await Promise.all([
      this._growthRepository.getRecycleSettings(orgId),
      this._growthRepository.getRecentRecycles(orgId),
    ]);

    return {
      settings: settings.map((p) => ({
        integrationId: p.integrationId,
        enabled: p.enabled,
        minAgeDays: p.minAgeDays,
        minGapDays: p.minGapDays,
        postsPerWeek: p.postsPerWeek,
        percentile: p.percentile,
      })),
      recycles,
    };
  }

  async updateRecycle(
    orgId: string,
    integrationId: string,
    body: RecycleSettingsDto
  ) {
    await this.checkIntegration(orgId, integrationId);
    return this._growthRepository.upsertRecycleSettings(
      orgId,
      integrationId,
      body
    );
  }

  // Schedules a copy of a post (with its comments) into the next free
  // posting slot of its channel
  async copyToNextSlot(orgId: string, postId: string) {
    const chain = await this._postsService.getPostsRecursively(
      postId,
      true,
      orgId,
      true
    );
    const [root] = chain;
    if (!root || root.deletedAt || !root.integration) {
      throw new NotFoundException('Post not found');
    }

    const date = await this._postsService.findFreeDateTime(
      orgId,
      root.integrationId
    );

    const [created] = await this._postsService.createPost(
      orgId,
      {
        date: date + 'Z',
        type: 'schedule',
        shortLink: false,
        tags: [],
        posts: [
          {
            integration: { id: root.integrationId },
            group: makeId(10),
            settings: {
              ...JSON.parse(root.settings || '{}'),
              __type: root.integration.providerIdentifier,
            },
            value: chain.map((p) => ({
              content: p.content,
              delay: p.delay || 0,
              image: JSON.parse(p.image || '[]'),
            })),
          },
        ],
      } as any,
      'AUTOPOST'
    );

    if (!created?.postId) {
      throw new BadRequestException('Could not schedule the post');
    }

    return { postId: created.postId as string, date: date + 'Z' };
  }

  async recycleTopPosts() {
    const now = new Date();
    const enabled = await this._growthRepository.getEnabledRecycleSettings();
    let recycled = 0;

    for (const settings of enabled) {
      try {
        // spread the recycles over the week instead of bursting them
        const last = await this._growthRepository.getLastRecycle(
          settings.integrationId
        );
        const spacing = (7 * 24 * 60) / settings.postsPerWeek;
        if (last && dayjs(now).diff(last.createdAt, 'minute') < spacing) {
          continue;
        }

        const lastWeek = await this._growthRepository.countRecyclesSince(
          settings.integrationId,
          dayjs(now).subtract(7, 'day').toDate()
        );
        if (lastWeek >= settings.postsPerWeek) {
          continue;
        }

        const candidates = (
          await this._growthRepository.getRecycleCandidates(
            settings.organizationId,
            settings.integrationId
          )
        ).map((p) => ({
          id: p.postId,
          publishDate: p.publishDate,
          engagement: p.engagement,
          lastRecycledAt: p.post.recycledAs[0]?.createdAt || null,
        }));

        const [pick] = selectRecycleCandidates(candidates, {
          now,
          minAgeDays: settings.minAgeDays,
          minGapDays: settings.minGapDays,
          percentile: settings.percentile,
          limit: 1,
        });

        if (!pick) {
          continue;
        }

        const { postId } = await this.copyToNextSlot(
          settings.organizationId,
          pick.id
        );

        await this._growthRepository.createRecycle({
          organizationId: settings.organizationId,
          integrationId: settings.integrationId,
          sourcePostId: pick.id,
          recycledPostId: postId,
        });
        recycled++;
      } catch (err) {
        console.log(err);
      }
    }

    return recycled;
  }

  async createExperiment(orgId: string, body: AbExperimentDto) {
    const integration = await this.checkIntegration(orgId, body.integrationId);
    const lastPost = await this._growthRepository.getLastPostSettings(
      orgId,
      integration.id
    );
    let lastSettings = {};
    try {
      lastSettings = JSON.parse(lastPost?.settings || '{}');
    } catch (err) {}
    const settings = {
      ...lastSettings,
      __type: integration.providerIdentifier,
    };

    // the variants are checked like the editor checks a post, before any is created
    const validations = await this._postsService.validatePosts(
      orgId,
      body.variants.map((variant) => ({
        integration: { id: integration.id },
        settings,
        value: [{ content: variant.content, image: [] }],
      }))
    );

    for (const validation of validations) {
      if (validation.emptyContent) {
        throw new BadRequestException('A variant has no content');
      }
      if (!validation.valid) {
        throw new BadRequestException(
          `The variants use the settings of the last post of this channel: ${
            validation.settingsError ||
            'they are missing, create a post for this channel from the calendar first'
          }`
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

    const variants: { postId: string; label: string }[] = [];
    for (const [index, variant] of body.variants.entries()) {
      const date = variant.date
        ? dayjs.utc(variant.date).format('YYYY-MM-DDTHH:mm:ss') + 'Z'
        : (await this._postsService.findFreeDateTime(orgId, integration.id)) +
          'Z';

      const [created] = await this._postsService.createPost(
        orgId,
        {
          date,
          type: 'schedule',
          shortLink: false,
          tags: [],
          posts: [
            {
              integration: { id: integration.id },
              group: makeId(10),
              settings,
              value: [{ content: variant.content, delay: 0, image: [] }],
            },
          ],
        } as any,
        'WEB'
      );

      variants.push({
        postId: created.postId,
        label: String.fromCharCode(65 + index),
      });
    }

    return this._growthRepository.createExperiment({
      organizationId: orgId,
      integrationId: integration.id,
      name: body.name,
      evaluationHours: body.evaluationHours,
      variants,
    });
  }

  private mapExperiment(
    experiment: Awaited<ReturnType<GrowthRepository['getExperiments']>>[0]
  ) {
    const dates = experiment.variants.map((p) => dayjs(p.post.publishDate));
    const last = dates.length
      ? dates.reduce((all, current) => (current.isAfter(all) ? current : all))
      : dayjs();

    return {
      id: experiment.id,
      name: experiment.name,
      status: experiment.status,
      evaluationHours: experiment.evaluationHours,
      winnerVariantId: experiment.winnerVariantId,
      completedAt: experiment.completedAt,
      createdAt: experiment.createdAt,
      evaluateAt: last.add(experiment.evaluationHours, 'hour').toDate(),
      integration: experiment.integration,
      variants: experiment.variants.map((p) => ({
        id: p.id,
        label: p.label,
        engagement: p.engagement,
        impressions: p.impressions,
        postId: p.post.id,
        content: p.post.content,
        publishDate: p.post.publishDate,
        state: p.post.deletedAt ? 'DELETED' : p.post.state,
        releaseURL: p.post.releaseURL,
      })),
    };
  }

  async getExperiments(orgId: string) {
    return (await this._growthRepository.getExperiments(orgId)).map((p) =>
      this.mapExperiment(p)
    );
  }

  async cancelExperiment(orgId: string, id: string) {
    await this._growthRepository.cancelExperiment(orgId, id);
    return { id };
  }

  async deleteExperiment(orgId: string, id: string) {
    await this._growthRepository.deleteExperiment(orgId, id);
    return { id };
  }

  async recycleWinner(orgId: string, id: string) {
    const experiment = await this._growthRepository.getExperiment(orgId, id);
    const winner = experiment?.variants.find(
      (p) => p.id === experiment.winnerVariantId
    );
    if (!experiment || !winner) {
      throw new NotFoundException('This experiment has no winner');
    }

    const { postId, date } = await this.copyToNextSlot(orgId, winner.post.id);
    await this._growthRepository.createRecycle({
      organizationId: orgId,
      integrationId: experiment.integrationId,
      sourcePostId: winner.post.id,
      recycledPostId: postId,
    });

    return { postId, date };
  }

  // Picks the winner of the experiments whose variants are all done (published,
  // failed or deleted) for longer than the evaluation window
  async evaluateExperiments() {
    let evaluated = 0;
    for (const experiment of await this._growthRepository.getRunningExperiments()) {
      try {
        const mapped = this.mapExperiment(experiment);
        const done = mapped.variants.every((p) =>
          ['PUBLISHED', 'ERROR', 'DELETED'].includes(p.state)
        );

        if (!done || dayjs().isBefore(mapped.evaluateAt)) {
          continue;
        }

        const results = await Promise.all(
          mapped.variants.map(async (variant) => {
            if (variant.state !== 'PUBLISHED') {
              return { id: variant.id, engagement: null, impressions: null };
            }

            const analytics = await this._postsService.checkPostAnalytics(
              experiment.organizationId,
              variant.postId,
              ENGAGEMENT_DAYS
            );

            if (!Array.isArray(analytics) || !analytics.length) {
              return { id: variant.id, engagement: null, impressions: null };
            }

            const { engagement, impressions } =
              engagementFromAnalytics(analytics);
            return { id: variant.id, engagement, impressions };
          })
        );

        for (const result of results) {
          await this._growthRepository.updateVariantResult(
            result.id,
            result.engagement,
            result.impressions
          );
        }

        const { winnerId } = pickAbWinner(results);
        await this._growthRepository.completeExperiment(
          experiment.id,
          winnerId
        );

        const winner = mapped.variants.find((p) => p.id === winnerId);
        await this._notificationService.inAppNotification(
          experiment.organizationId,
          `A/B test "${experiment.name}" is complete`,
          winner
            ? `A/B test "${experiment.name}" is complete, variant ${winner.label} won`
            : `A/B test "${experiment.name}" is complete, no variant won (not enough analytics or a tie)`,
          false,
          false,
          'info'
        );
        evaluated++;
      } catch (err) {
        console.log(err);
      }
    }

    return evaluated;
  }
}
