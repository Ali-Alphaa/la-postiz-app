import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { GrowthSettingsDto } from '@gitroom/nestjs-libraries/dtos/growth/growth.settings.dto';
import { RecycleSettingsDto } from '@gitroom/nestjs-libraries/dtos/growth/recycle.settings.dto';

@Injectable()
export class GrowthRepository {
  constructor(
    private _growthSettings: PrismaRepository<'growthSettings'>,
    private _postEngagement: PrismaRepository<'postEngagement'>,
    private _post: PrismaRepository<'post'>,
    private _recycleSettings: PrismaRepository<'recycleSettings'>,
    private _postRecycle: PrismaRepository<'postRecycle'>,
    private _abExperiment: PrismaRepository<'abExperiment'>,
    private _abVariant: PrismaRepository<'abVariant'>
  ) {}

  getSettings(orgId: string) {
    return this._growthSettings.model.growthSettings.findUnique({
      where: { organizationId: orgId },
    });
  }

  // Opening the growth page creates the row, which also opts the organization
  // into the engagement collection of the growth workflow
  getOrCreateSettings(orgId: string) {
    return this._growthSettings.model.growthSettings.upsert({
      where: { organizationId: orgId },
      update: {},
      create: { organizationId: orgId },
    });
  }

  updateSettings(orgId: string, body: GrowthSettingsDto) {
    const values = {
      utmEnabled: body.utmEnabled,
      utmSource: body.utmSource || '{{provider}}',
      utmMedium: body.utmMedium || 'social',
      utmCampaign: body.utmCampaign || null,
    };

    return this._growthSettings.model.growthSettings.upsert({
      where: { organizationId: orgId },
      update: values,
      create: { organizationId: orgId, ...values },
    });
  }

  // Root posts that were published, whose engagement was never stored or is
  // older than `staleHours`
  getPostsForEngagement(options: {
    providers: string[];
    limit: number;
    staleHours: number;
    days: number;
    orgId?: string;
    integrationId?: string;
  }) {
    return this._post.model.post.findMany({
      where: {
        ...(options.orgId ? { organizationId: options.orgId } : {}),
        ...(options.integrationId
          ? { integrationId: options.integrationId }
          : {}),
        state: 'PUBLISHED',
        deletedAt: null,
        parentPostId: null,
        releaseId: { not: null },
        NOT: { releaseId: 'missing' },
        publishDate: {
          gte: dayjs().subtract(options.days, 'day').toDate(),
          lte: dayjs().subtract(1, 'hour').toDate(),
        },
        integration: {
          providerIdentifier: { in: options.providers },
          deletedAt: null,
          disabled: false,
          refreshNeeded: false,
          inBetweenSteps: false,
        },
        organization: {
          deletedAt: null,
          ...(options.orgId ? {} : { growthSettings: { isNot: null } }),
        },
        OR: [
          { engagement: { is: null } },
          {
            engagement: {
              is: {
                updatedAt: {
                  lt: dayjs().subtract(options.staleHours, 'hour').toDate(),
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        organizationId: true,
        integrationId: true,
        publishDate: true,
      },
      orderBy: { publishDate: 'desc' },
      take: options.limit,
    });
  }

  saveEngagement(data: {
    organizationId: string;
    integrationId: string;
    postId: string;
    publishDate: Date;
    engagement: number;
    impressions: number;
    metrics: Record<string, number>;
  }) {
    const values = {
      publishDate: data.publishDate,
      engagement: data.engagement,
      impressions: data.impressions,
      metrics: JSON.stringify(data.metrics),
    };

    return this._postEngagement.model.postEngagement.upsert({
      where: { postId: data.postId },
      update: values,
      create: {
        organizationId: data.organizationId,
        integrationId: data.integrationId,
        postId: data.postId,
        ...values,
      },
    });
  }

  getEngagements(orgId: string, integrationId?: string, days = 180) {
    return this._postEngagement.model.postEngagement.findMany({
      where: {
        organizationId: orgId,
        ...(integrationId ? { integrationId } : {}),
        publishDate: { gte: dayjs().subtract(days, 'day').toDate() },
        post: { deletedAt: null },
        integration: { deletedAt: null },
      },
      select: {
        postId: true,
        integrationId: true,
        publishDate: true,
        engagement: true,
        impressions: true,
        metrics: true,
        post: {
          select: {
            content: true,
          },
        },
      },
      orderBy: { publishDate: 'desc' },
      take: 1000,
    });
  }

  getRecycleSettings(orgId: string) {
    return this._recycleSettings.model.recycleSettings.findMany({
      where: { organizationId: orgId },
    });
  }

  upsertRecycleSettings(
    orgId: string,
    integrationId: string,
    body: RecycleSettingsDto
  ) {
    const values = {
      enabled: body.enabled,
      minAgeDays: body.minAgeDays,
      minGapDays: body.minGapDays,
      postsPerWeek: body.postsPerWeek,
      percentile: body.percentile,
    };

    return this._recycleSettings.model.recycleSettings.upsert({
      where: { integrationId },
      update: values,
      create: { organizationId: orgId, integrationId, ...values },
      select: { id: true },
    });
  }

  getEnabledRecycleSettings() {
    return this._recycleSettings.model.recycleSettings.findMany({
      where: {
        enabled: true,
        organization: { deletedAt: null },
        integration: {
          deletedAt: null,
          disabled: false,
          refreshNeeded: false,
          inBetweenSteps: false,
        },
      },
    });
  }

  getLastRecycle(integrationId: string) {
    return this._postRecycle.model.postRecycle.findFirst({
      where: { integrationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  countRecyclesSince(integrationId: string, since: Date) {
    return this._postRecycle.model.postRecycle.count({
      where: { integrationId, createdAt: { gte: since } },
    });
  }

  // Engagement of the original posts of a channel (recycled copies are left
  // out, so the same content can't snowball) with their last recycle date
  getRecycleCandidates(orgId: string, integrationId: string) {
    return this._postEngagement.model.postEngagement.findMany({
      where: {
        organizationId: orgId,
        integrationId,
        NOT: { metrics: '{}' },
        post: {
          deletedAt: null,
          state: 'PUBLISHED',
          recycledFrom: { none: {} },
        },
      },
      select: {
        postId: true,
        publishDate: true,
        engagement: true,
        post: {
          select: {
            recycledAs: {
              select: { createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: { engagement: 'desc' },
      take: 1000,
    });
  }

  createRecycle(data: {
    organizationId: string;
    integrationId: string;
    sourcePostId: string;
    recycledPostId: string;
  }) {
    return this._postRecycle.model.postRecycle.create({
      data,
      select: { id: true },
    });
  }

  getRecentRecycles(orgId: string) {
    return this._postRecycle.model.postRecycle.findMany({
      where: { organizationId: orgId },
      select: {
        id: true,
        integrationId: true,
        createdAt: true,
        sourcePost: {
          select: { id: true, content: true, publishDate: true },
        },
        recycledPost: {
          select: {
            id: true,
            publishDate: true,
            state: true,
            deletedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  // the provider settings of the last post of a channel, reused by the A/B
  // test variants (some providers require settings, like who can reply on X)
  getLastPostSettings(orgId: string, integrationId: string) {
    return this._post.model.post.findFirst({
      where: {
        organizationId: orgId,
        integrationId,
        parentPostId: null,
        deletedAt: null,
        settings: { not: null },
      },
      select: { settings: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  createExperiment(data: {
    organizationId: string;
    integrationId: string;
    name: string;
    evaluationHours: number;
    variants: { postId: string; label: string }[];
  }) {
    return this._abExperiment.model.abExperiment.create({
      data: {
        organizationId: data.organizationId,
        integrationId: data.integrationId,
        name: data.name,
        evaluationHours: data.evaluationHours,
        variants: {
          create: data.variants,
        },
      },
      select: { id: true },
    });
  }

  private experimentSelect = {
    id: true,
    name: true,
    status: true,
    evaluationHours: true,
    winnerVariantId: true,
    completedAt: true,
    createdAt: true,
    organizationId: true,
    integrationId: true,
    integration: {
      select: {
        id: true,
        name: true,
        picture: true,
        providerIdentifier: true,
      },
    },
    variants: {
      select: {
        id: true,
        label: true,
        engagement: true,
        impressions: true,
        post: {
          select: {
            id: true,
            content: true,
            publishDate: true,
            state: true,
            releaseURL: true,
            deletedAt: true,
          },
        },
      },
      orderBy: { label: 'asc' as const },
    },
  };

  getExperiments(orgId: string) {
    return this._abExperiment.model.abExperiment.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: this.experimentSelect,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  getExperiment(orgId: string, id: string) {
    return this._abExperiment.model.abExperiment.findFirst({
      where: { organizationId: orgId, id, deletedAt: null },
      select: this.experimentSelect,
    });
  }

  getRunningExperiments() {
    return this._abExperiment.model.abExperiment.findMany({
      where: {
        status: 'RUNNING',
        deletedAt: null,
        organization: { deletedAt: null },
      },
      select: this.experimentSelect,
      take: 200,
    });
  }

  updateVariantResult(
    id: string,
    engagement: number | null,
    impressions: number | null
  ) {
    return this._abVariant.model.abVariant.update({
      where: { id },
      data: { engagement, impressions },
      select: { id: true },
    });
  }

  completeExperiment(id: string, winnerVariantId: string | null) {
    return this._abExperiment.model.abExperiment.update({
      where: { id },
      data: { status: 'COMPLETED', winnerVariantId, completedAt: new Date() },
      select: { id: true },
    });
  }

  cancelExperiment(orgId: string, id: string) {
    return this._abExperiment.model.abExperiment.updateMany({
      where: { organizationId: orgId, id, status: 'RUNNING' },
      data: { status: 'CANCELED', completedAt: new Date() },
    });
  }

  deleteExperiment(orgId: string, id: string) {
    return this._abExperiment.model.abExperiment.updateMany({
      where: { organizationId: orgId, id },
      data: { deletedAt: new Date() },
    });
  }
}
