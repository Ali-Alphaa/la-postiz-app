import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  BrandKitDto,
  ConversionDto,
} from '@gitroom/nestjs-libraries/dtos/growth/growth.tools.dto';

@Injectable()
export class GrowthToolsRepository {
  constructor(
    private _brandKit: PrismaRepository<'brandKit'>,
    private _conversion: PrismaRepository<'conversion'>,
    private _bioPage: PrismaRepository<'bioPage'>,
    private _bioClick: PrismaRepository<'bioClick'>,
    private _weeklyReview: PrismaRepository<'weeklyReview'>,
    private _postEngagement: PrismaRepository<'postEngagement'>,
    private _post: PrismaRepository<'post'>,
    private _growthSettings: PrismaRepository<'growthSettings'>
  ) {}

  getBrandKit(orgId: string) {
    return this._brandKit.model.brandKit.findUnique({
      where: { organizationId: orgId },
    });
  }

  saveBrandKit(orgId: string, body: BrandKitDto) {
    const data = {
      background: body.background,
      text: body.text,
      accent: body.accent,
      handle: body.handle || null,
    };
    return this._brandKit.model.brandKit.upsert({
      where: { organizationId: orgId },
      update: data,
      create: { ...data, organizationId: orgId },
    });
  }

  postExists(orgId: string, id: string) {
    return this._post.model.post.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: { id: true },
    });
  }

  saveConversion(orgId: string, postId: string | null, body: ConversionDto) {
    const data = {
      type: body.type,
      value: body.value || 0,
      currency: body.currency,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
      utmContent: body.utmContent,
      postId,
    };
    if (!body.externalId) {
      return this._conversion.model.conversion.create({
        data: { ...data, organizationId: orgId },
        select: { id: true },
      });
    }
    return this._conversion.model.conversion.upsert({
      where: {
        organizationId_externalId: {
          organizationId: orgId,
          externalId: body.externalId,
        },
      },
      update: {
        type: body.type,
        ...(body.value !== undefined ? { value: body.value } : {}),
        ...(body.currency ? { currency: body.currency } : {}),
        ...(body.utmSource ? { utmSource: body.utmSource } : {}),
        ...(body.utmMedium ? { utmMedium: body.utmMedium } : {}),
        ...(body.utmCampaign ? { utmCampaign: body.utmCampaign } : {}),
        ...(body.utmContent ? { utmContent: body.utmContent } : {}),
        ...(postId ? { postId } : {}),
      },
      create: { ...data, organizationId: orgId, externalId: body.externalId },
      select: { id: true },
    });
  }

  getConversions(orgId: string, since: Date, until?: Date) {
    return this._conversion.model.conversion.findMany({
      where: {
        organizationId: orgId,
        createdAt: { gte: since, ...(until ? { lt: until } : {}) },
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });
  }

  getPostsSummary(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: { organizationId: orgId, id: { in: ids } },
      select: {
        id: true,
        content: true,
        releaseURL: true,
        publishDate: true,
        integration: { select: { name: true, providerIdentifier: true } },
      },
    });
  }

  // the published posts of a period, best first
  getEngagement(orgId: string, from: Date, to: Date, take: number) {
    return this._postEngagement.model.postEngagement.findMany({
      where: {
        organizationId: orgId,
        publishDate: { gte: from, lt: to },
        post: { deletedAt: null },
      },
      orderBy: { engagement: 'desc' },
      take,
      select: {
        postId: true,
        engagement: true,
        impressions: true,
        publishDate: true,
        post: {
          select: {
            content: true,
            releaseURL: true,
            integration: { select: { name: true, providerIdentifier: true } },
          },
        },
      },
    });
  }

  getOrganizationsWithGrowth() {
    return this._growthSettings.model.growthSettings.findMany({
      where: { organization: { deletedAt: null } },
      select: { organizationId: true },
    });
  }

  getBioPage(orgId: string) {
    return this._bioPage.model.bioPage.findUnique({
      where: { organizationId: orgId },
    });
  }

  getBioPageBySlug(slug: string) {
    return this._bioPage.model.bioPage.findUnique({ where: { slug } });
  }

  // what visitors see: not the page of a deleted organization
  getPublicBioPage(slug: string) {
    return this._bioPage.model.bioPage.findFirst({
      where: { slug, enabled: true, organization: { deletedAt: null } },
    });
  }

  saveBioPage(
    orgId: string,
    body: {
      slug: string;
      title: string;
      bio: string | null;
      avatar: string | null;
      enabled: boolean;
      links: Prisma.InputJsonValue;
    }
  ) {
    return this._bioPage.model.bioPage.upsert({
      where: { organizationId: orgId },
      update: body,
      create: { ...body, organizationId: orgId },
    });
  }

  addBioClick(pageId: string, linkKey: string) {
    return this._bioClick.model.bioClick.create({
      data: { bioPageId: pageId, linkKey },
      select: { id: true },
    });
  }

  countBioClicks(pageId: string, since: Date) {
    return this._bioClick.model.bioClick.groupBy({
      by: ['linkKey'],
      where: { bioPageId: pageId, createdAt: { gte: since } },
      _count: { _all: true },
    });
  }

  getWeeklyReviews(orgId: string) {
    return this._weeklyReview.model.weeklyReview.findMany({
      where: { organizationId: orgId },
      orderBy: { weekStart: 'desc' },
      take: 8,
    });
  }

  getWeeklyReview(orgId: string, weekStart: Date) {
    return this._weeklyReview.model.weeklyReview.findUnique({
      where: {
        organizationId_weekStart: { organizationId: orgId, weekStart },
      },
      select: { id: true },
    });
  }

  saveWeeklyReview(
    orgId: string,
    weekStart: Date,
    summary: string,
    data: Prisma.InputJsonValue
  ) {
    return this._weeklyReview.model.weeklyReview.upsert({
      where: {
        organizationId_weekStart: { organizationId: orgId, weekStart },
      },
      update: { summary, data },
      create: { organizationId: orgId, weekStart, summary, data },
    });
  }
}
