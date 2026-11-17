import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

const POST_SELECT = {
  id: true,
  integrationId: true,
  publishAt: true,
  pillar: true,
  mediaIdea: true,
  content: true,
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
    private _campaignPost: PrismaRepository<'campaignPost'>
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
      tone?: string;
      notes?: string;
    },
    posts: Array<{
      integrationId: string;
      publishAt: Date;
      pillar: string;
      mediaIdea: string | null;
      content: string;
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
        campaign: { select: { id: true, status: true } },
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

  activateCampaign(id: string) {
    return this._campaign.model.campaign.update({
      where: { id },
      data: { status: 'ACTIVE' },
      select: { id: true },
    });
  }
}
