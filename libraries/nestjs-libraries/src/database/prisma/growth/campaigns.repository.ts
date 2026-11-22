import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

const POST_SELECT = {
  id: true,
  integrationId: true,
  publishAt: true,
  pillar: true,
  mediaIdea: true,
  content: true,
  variations: true,
  status: true,
  postId: true,
  note: true,
  sortOrder: true,
  integration: {
    select: {
      id: true,
      name: true,
      picture: true,
      providerIdentifier: true,
    },
  },
};

@Injectable()
export class CampaignsRepository {
  constructor(
    private _campaign: PrismaRepository<'campaign'>,
    private _campaignPost: PrismaRepository<'campaignPost'>,
    private _conversion: PrismaRepository<'conversion'>,
    private _postEngagement: PrismaRepository<'postEngagement'>,
    private _post: PrismaRepository<'post'>,
    private _growthSettings: PrismaRepository<'growthSettings'>
  ) {}

  getCampaigns(orgId: string) {
    return this._campaign.model.campaign.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        goal: true,
        startDate: true,
        days: true,
        playbook: true,
        profile: true,
        status: true,
        posts: { select: { status: true } },
      },
    });
  }

  getCampaign(orgId: string, id: string) {
    return this._campaign.model.campaign.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        name: true,
        goal: true,
        slug: true,
        leadMagnetId: true,
        startDate: true,
        days: true,
        playbook: true,
        profile: true,
        tone: true,
        notes: true,
        status: true,
        posts: { orderBy: { sortOrder: 'asc' }, select: POST_SELECT },
      },
    });
  }

  createCampaign(
    orgId: string,
    data: {
      name: string;
      goal?: string;
      slug: string;
      leadMagnetId: string;
      startDate: Date;
      days: number;
      playbook: string;
      profile: string;
      tone?: string;
      notes?: string;
    },
    posts: Array<{
      integrationId: string;
      publishAt: Date;
      pillar: string;
      mediaIdea: string | null;
      content: string;
      variations?: string[];
      sortOrder: number;
    }>
  ) {
    return this._campaign.model.campaign.create({
      data: {
        organizationId: orgId,
        ...data,
        posts: {
          create: posts.map((post) => ({ organizationId: orgId, ...post })),
        },
      },
      select: { id: true },
    });
  }

  getPost(orgId: string, id: string) {
    return this._campaignPost.model.campaignPost.findFirst({
      where: { id, organizationId: orgId },
      select: {
        ...POST_SELECT,
        campaignId: true,
        campaign: { select: { id: true, status: true, profile: true } },
      },
    });
  }

  updatePost(
    id: string,
    data: {
      content?: string;
      publishAt?: Date;
      status?: string;
      postId?: string | null;
      note?: string | null;
    }
  ) {
    return this._campaignPost.model.campaignPost.update({
      where: { id },
      data,
      select: POST_SELECT,
    });
  }

  // the sign-ups and sales that came through the links of a campaign
  getConversions(orgId: string, slug: string) {
    return this._conversion.model.conversion.findMany({
      where: { organizationId: orgId, utmCampaign: slug },
      select: {
        type: true,
        value: true,
        currency: true,
        utmSource: true,
        postId: true,
        createdAt: true,
      },
      take: 5000,
    });
  }

  countLeads(orgId: string, from: Date, to: Date) {
    return this._conversion.model.conversion.count({
      where: {
        organizationId: orgId,
        type: 'lead',
        createdAt: { gte: from, lt: to },
      },
    });
  }

  getEngagements(orgId: string, postIds: string[]) {
    return this._postEngagement.model.postEngagement.findMany({
      where: { organizationId: orgId, postId: { in: postIds } },
      select: {
        postId: true,
        engagement: true,
        impressions: true,
      },
    });
  }

  // what a normal post of these channels got before the campaign
  async getBaselineEngagement(
    orgId: string,
    integrationIds: string[],
    from: Date,
    to: Date
  ) {
    const result = await this._postEngagement.model.postEngagement.aggregate({
      where: {
        organizationId: orgId,
        integrationId: { in: integrationIds },
        publishDate: { gte: from, lt: to },
        post: { deletedAt: null },
      },
      _avg: { engagement: true, impressions: true },
      _count: { _all: true },
    });
    return {
      posts: result._count._all,
      engagement: result._avg.engagement || 0,
      impressions: result._avg.impressions || 0,
    };
  }

  getPostStates(orgId: string, ids: string[]) {
    return this._post.model.post.findMany({
      where: { organizationId: orgId, id: { in: ids } },
      select: { id: true, state: true, releaseURL: true },
    });
  }

  async isUtmEnabled(orgId: string) {
    return !!(
      await this._growthSettings.model.growthSettings.findUnique({
        where: { organizationId: orgId },
        select: { utmEnabled: true },
      })
    )?.utmEnabled;
  }

  // only a campaign of the organization is changed
  async setCampaignStatus(orgId: string, id: string, status: string) {
    const { count } = await this._campaign.model.campaign.updateMany({
      where: { id, organizationId: orgId },
      data: { status },
    });
    return count > 0;
  }

  activateCampaign(id: string) {
    return this._campaign.model.campaign.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: { id: true },
    });
  }
}
