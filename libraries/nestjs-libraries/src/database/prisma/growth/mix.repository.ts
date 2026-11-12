import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { MixTargetDto } from '@gitroom/nestjs-libraries/dtos/growth/mix.dto';

const LABEL_SELECT = {
  format: true,
  pillar: true,
  cta: true,
  source: true,
};

@Injectable()
export class MixRepository {
  constructor(
    private _post: PrismaRepository<'post'>,
    private _postLabel: PrismaRepository<'postLabel'>,
    private _mixTarget: PrismaRepository<'mixTarget'>
  ) {}

  // the first post of every group on a channel, with its label and thread
  getPosts(orgId: string, from: Date, to: Date, states: Array<'QUEUE' | 'PUBLISHED' | 'ERROR'>) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        parentPostId: null,
        state: { in: states },
        publishDate: { gte: from, lt: to },
        integration: { deletedAt: null },
      },
      orderBy: { publishDate: 'asc' },
      select: {
        id: true,
        state: true,
        publishDate: true,
        createdAt: true,
        content: true,
        image: true,
        integrationId: true,
        integration: {
          select: {
            id: true,
            name: true,
            picture: true,
            providerIdentifier: true,
          },
        },
        childrenPost: { where: { deletedAt: null }, select: { id: true } },
        label: { select: LABEL_SELECT },
      },
    });
  }

  // posts of a channel that are still going to be sent, to keep suggestions apart from them
  getUpcomingDates(orgId: string, integrationId: string, from: Date) {
    return this._post.model.post.findMany({
      where: {
        organizationId: orgId,
        integrationId,
        deletedAt: null,
        parentPostId: null,
        state: 'QUEUE',
        publishDate: { gte: from },
      },
      select: { publishDate: true },
    });
  }

  // when the channel first published, the best hours of its own results need weeks of history
  async getFirstPublished(orgId: string, integrationId: string) {
    return (
      await this._post.model.post.findFirst({
        where: {
          organizationId: orgId,
          integrationId,
          deletedAt: null,
          parentPostId: null,
          state: 'PUBLISHED',
        },
        orderBy: { publishDate: 'asc' },
        select: { publishDate: true },
      })
    )?.publishDate;
  }

  upsertLabel(
    orgId: string,
    postId: string,
    body: { format: string; pillar: string; cta: string; source: string }
  ) {
    return this._postLabel.model.postLabel.upsert({
      where: { postId },
      update: body,
      create: { organizationId: orgId, postId, ...body },
      select: LABEL_SELECT,
    });
  }

  getPost(orgId: string, postId: string) {
    return this._post.model.post.findFirst({
      where: { id: postId, organizationId: orgId, deletedAt: null },
      select: {
        id: true,
        state: true,
        image: true,
        content: true,
        integration: { select: { providerIdentifier: true } },
        childrenPost: { where: { deletedAt: null }, select: { id: true } },
        label: { select: LABEL_SELECT },
      },
    });
  }

  getTargets(orgId: string) {
    return this._mixTarget.model.mixTarget.findMany({
      where: { organizationId: orgId, integration: { deletedAt: null } },
      select: {
        integrationId: true,
        kind: true,
        value: true,
        perWeek: true,
      },
    });
  }

  async replaceTargets(
    orgId: string,
    integrationId: string,
    targets: MixTargetDto[]
  ) {
    await this._mixTarget.model.mixTarget.deleteMany({
      where: { organizationId: orgId, integrationId },
    });

    const filled = targets.filter((p) => p.perWeek > 0);
    if (filled.length) {
      await this._mixTarget.model.mixTarget.createMany({
        data: filled.map((p) => ({
          organizationId: orgId,
          integrationId,
          kind: p.kind,
          value: p.value,
          perWeek: p.perWeek,
        })),
      });
    }
  }
}
