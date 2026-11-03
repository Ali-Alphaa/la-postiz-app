import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { InboxRemoteItem } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  DmAutomationDto,
  INBOX_STATUSES,
  InboxQueryDto,
} from '@gitroom/nestjs-libraries/dtos/inbox/inbox.dto';

@Injectable()
export class InboxRepository {
  constructor(
    private _items: PrismaRepository<'inboxItem'>,
    private _automations: PrismaRepository<'dmAutomation'>,
    private _integrations: PrismaRepository<'integration'>,
    private _posts: PrismaRepository<'post'>
  ) {}

  // holds the token: for the sync only, it never reaches a controller
  getSyncIntegrations(orgId?: string) {
    return this._integrations.model.integration.findMany({
      where: {
        ...(orgId ? { organizationId: orgId } : {}),
        type: 'social',
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        inBetweenSteps: false,
        organization: { deletedAt: null },
      },
    });
  }

  getChannels(orgId: string) {
    return this._integrations.model.integration.findMany({
      where: {
        organizationId: orgId,
        type: 'social',
        deletedAt: null,
        disabled: false,
      },
      select: {
        id: true,
        name: true,
        picture: true,
        providerIdentifier: true,
      },
    });
  }

  getRecentPosts(integrationId: string) {
    return this._posts.model.post.findMany({
      where: {
        integrationId,
        state: 'PUBLISHED',
        deletedAt: null,
        parentPostId: null,
        releaseId: { not: null },
        NOT: { releaseId: 'missing' },
        publishDate: { gte: dayjs().subtract(14, 'day').toDate() },
      },
      orderBy: { publishDate: 'desc' },
      take: 20,
      select: { id: true, releaseId: true },
    });
  }

  getPostText(orgId: string, id: string) {
    return this._posts.model.post.findFirst({
      where: { id, organizationId: orgId },
      select: { content: true },
    });
  }

  async keepNew(integrationId: string, remote: InboxRemoteItem[]) {
    const existing = await this._items.model.inboxItem.findMany({
      where: {
        integrationId,
        externalId: { in: remote.map((p) => p.externalId) },
      },
      select: { externalId: true },
    });
    const known = new Set(existing.map((p) => p.externalId));
    return remote.filter((p) => !known.has(p.externalId));
  }

  // a second sync racing this one can't create the row twice: the unique index
  // stops it, and only the sync that created the row runs the automations
  async createItem(
    orgId: string,
    integrationId: string,
    item: InboxRemoteItem
  ) {
    const { count } = await this._items.model.inboxItem.createMany({
      data: [
        {
          organizationId: orgId,
          integrationId,
          kind: item.kind,
          externalId: item.externalId,
          threadId: item.threadId,
          postId: item.postId,
          authorId: item.authorId,
          authorName: item.authorName,
          text: item.text,
          receivedAt: item.receivedAt,
        },
      ],
      skipDuplicates: true,
    });
    if (!count) {
      return null;
    }
    return this._items.model.inboxItem.findUnique({
      where: {
        integrationId_externalId: {
          integrationId,
          externalId: item.externalId,
        },
      },
      select: { id: true },
    });
  }

  getItems(orgId: string, query: InboxQueryDto) {
    return this._items.model.inboxItem.findMany({
      where: {
        organizationId: orgId,
        status: query.status || 'OPEN',
        ...(query.integrationId ? { integrationId: query.integrationId } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take: 200,
      include: {
        integration: {
          select: { id: true, name: true, providerIdentifier: true },
        },
      },
    });
  }

  countOpen(orgId: string) {
    return this._items.model.inboxItem.count({
      where: { organizationId: orgId, status: 'OPEN' },
    });
  }

  getItem(orgId: string, id: string) {
    return this._items.model.inboxItem.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  setStatus(
    orgId: string,
    id: string,
    status: (typeof INBOX_STATUSES)[number]
  ) {
    return this._items.model.inboxItem.updateMany({
      where: { id, organizationId: orgId },
      data: { status },
    });
  }

  markReplied(orgId: string, id: string, reply: string) {
    return this._items.model.inboxItem.updateMany({
      where: { id, organizationId: orgId },
      data: { status: 'REPLIED', reply, repliedAt: new Date() },
    });
  }

  getIntegration(orgId: string, id: string) {
    return this._integrations.model.integration.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  getEnabledAutomations(integrationId: string) {
    return this._automations.model.dmAutomation.findMany({
      where: { integrationId, enabled: true, deletedAt: null },
    });
  }

  // one DM per person per automation: an earlier row of the same author wins
  hasSentTo(automationId: string, authorId: string) {
    return this._items.model.inboxItem.findFirst({
      where: { automationId, authorId, dmSentAt: { not: null } },
      select: { id: true },
    });
  }

  // claimed before the DM goes out, so a retry can't send it twice
  async claimDm(id: string, automationId: string) {
    const { count } = await this._items.model.inboxItem.updateMany({
      where: { id, automationId: null },
      data: { automationId, dmSentAt: new Date() },
    });
    return count === 1;
  }

  failDm(id: string, error: string) {
    return this._items.model.inboxItem.update({
      where: { id },
      data: { dmSentAt: null, dmError: error.slice(0, 300) },
      select: { id: true },
    });
  }

  async getAutomations(orgId: string) {
    const automations = await this._automations.model.dmAutomation.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        integration: { select: { name: true, providerIdentifier: true } },
      },
    });
    const sent = await this._items.model.inboxItem.groupBy({
      by: ['automationId'],
      where: { organizationId: orgId, dmSentAt: { not: null } },
      _count: { _all: true },
    });
    const failed = await this._items.model.inboxItem.groupBy({
      by: ['automationId'],
      where: {
        organizationId: orgId,
        automationId: { not: null },
        dmSentAt: null,
      },
      _count: { _all: true },
    });
    const of = (rows: typeof sent, id: string) =>
      rows.find((p) => p.automationId === id)?._count._all || 0;
    return automations.map((p) => ({
      ...p,
      sent: of(sent, p.id),
      failed: of(failed, p.id),
    }));
  }

  saveAutomation(orgId: string, body: DmAutomationDto, id?: string) {
    const data = {
      integrationId: body.integrationId,
      postId: body.postId || null,
      keyword: body.keyword.trim(),
      dmText: body.dmText,
      publicReply: body.publicReply || null,
      enabled: body.enabled,
    };
    return id
      ? this._automations.model.dmAutomation.updateMany({
          where: { id, organizationId: orgId, deletedAt: null },
          data,
        })
      : this._automations.model.dmAutomation.create({
          data: { ...data, organizationId: orgId },
          select: { id: true },
        });
  }

  deleteAutomation(orgId: string, id: string) {
    return this._automations.model.dmAutomation.updateMany({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date(), enabled: false },
    });
  }
}
