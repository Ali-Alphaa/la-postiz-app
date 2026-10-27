import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import {
  PublicPost,
  PublicProfile,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

@Injectable()
export class CompetitorsRepository {
  constructor(
    private _competitor: PrismaRepository<'competitor'>,
    private _competitorSnapshot: PrismaRepository<'competitorSnapshot'>,
    private _competitorPost: PrismaRepository<'competitorPost'>
  ) {}

  getCompetitors(orgId: string) {
    return this._competitor.model.competitor.findMany({
      where: { organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        provider: true,
        handle: true,
        name: true,
        picture: true,
        profileUrl: true,
        lastSyncedAt: true,
        createdAt: true,
        snapshots: {
          where: { createdAt: { gte: dayjs().subtract(31, 'day').toDate() } },
          select: {
            followers: true,
            following: true,
            postsCount: true,
            avgEngagement: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  getCompetitor(orgId: string, id: string) {
    return this._competitor.model.competitor.findFirst({
      where: { organizationId: orgId, id, deletedAt: null },
    });
  }

  countCompetitors(orgId: string) {
    return this._competitor.model.competitor.count({
      where: { organizationId: orgId, deletedAt: null },
    });
  }

  // a competitor that was deleted before is brought back
  upsertCompetitor(orgId: string, provider: string, profile: PublicProfile) {
    const values = {
      name: profile.name,
      picture: profile.picture,
      profileUrl: profile.url,
      deletedAt: null as Date | null,
    };

    return this._competitor.model.competitor.upsert({
      where: {
        organizationId_provider_handle: {
          organizationId: orgId,
          provider,
          handle: profile.handle,
        },
      },
      update: values,
      create: {
        organizationId: orgId,
        provider,
        handle: profile.handle,
        ...values,
      },
    });
  }

  deleteCompetitor(orgId: string, id: string) {
    return this._competitor.model.competitor.updateMany({
      where: { organizationId: orgId, id },
      data: { deletedAt: new Date() },
    });
  }

  getCompetitorsToSync(hours: number, limit: number) {
    return this._competitor.model.competitor.findMany({
      where: {
        deletedAt: null,
        organization: { deletedAt: null },
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: dayjs().subtract(hours, 'hour').toDate() } },
        ],
      },
      orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
      take: limit,
    });
  }

  async saveSync(
    id: string,
    profile: PublicProfile,
    posts: PublicPost[],
    avgEngagement: number
  ) {
    await this._competitorSnapshot.model.competitorSnapshot.create({
      data: {
        competitorId: id,
        followers: profile.followers,
        following: profile.following,
        postsCount: profile.posts,
        avgEngagement,
      },
    });

    for (const post of posts) {
      const values = {
        url: post.url,
        content: post.content,
        publishedAt: dayjs(post.publishedAt).toDate(),
        likes: post.likes,
        reposts: post.reposts,
        replies: post.replies,
        engagement: post.likes + post.reposts + post.replies,
      };

      await this._competitorPost.model.competitorPost.upsert({
        where: {
          competitorId_externalId: { competitorId: id, externalId: post.id },
        },
        update: values,
        create: { competitorId: id, externalId: post.id, ...values },
      });
    }

    return this._competitor.model.competitor.update({
      where: { id },
      data: {
        name: profile.name,
        picture: profile.picture,
        profileUrl: profile.url,
        lastSyncedAt: new Date(),
      },
      select: { id: true },
    });
  }

  markSynced(id: string) {
    return this._competitor.model.competitor.update({
      where: { id },
      data: { lastSyncedAt: new Date() },
      select: { id: true },
    });
  }

  getInspiration(orgId: string, days: number, provider?: string) {
    return this._competitorPost.model.competitorPost.findMany({
      where: {
        publishedAt: { gte: dayjs().subtract(days, 'day').toDate() },
        competitor: {
          organizationId: orgId,
          deletedAt: null,
          ...(provider ? { provider } : {}),
        },
      },
      select: {
        id: true,
        url: true,
        content: true,
        publishedAt: true,
        likes: true,
        reposts: true,
        replies: true,
        engagement: true,
        competitor: {
          select: {
            id: true,
            provider: true,
            handle: true,
            name: true,
            picture: true,
          },
        },
      },
      orderBy: { engagement: 'desc' },
      take: 50,
    });
  }

  getCompetitorPost(orgId: string, id: string) {
    return this._competitorPost.model.competitorPost.findFirst({
      where: { id, competitor: { organizationId: orgId, deletedAt: null } },
      select: { content: true },
    });
  }
}
