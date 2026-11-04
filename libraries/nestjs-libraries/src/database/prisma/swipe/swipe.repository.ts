import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma, SwipeOrigin, SwipeStatus } from '@prisma/client';
import {
  SwipeEntryDto,
  SwipeQueryDto,
} from '@gitroom/nestjs-libraries/dtos/swipe/swipe.dto';

@Injectable()
export class SwipeRepository {
  constructor(
    private _entries: PrismaRepository<'swipeEntry'>,
    private _runs: PrismaRepository<'swipeRun'>
  ) {}

  // a field left out stays as it is, null clears it
  private values(entry: SwipeEntryDto) {
    return {
      content: entry.content,
      author: entry.author,
      sourceUrl: entry.sourceUrl,
      formatTag: entry.formatTag,
      whyItWorks: entry.whyItWorks,
      collection: entry.collection,
      imagePath: entry.imagePath,
      ...(entry.platform ? { platform: entry.platform } : {}),
      ...(entry.topicTags ? { topicTags: entry.topicTags } : {}),
      ...(entry.starred !== undefined ? { starred: entry.starred } : {}),
      ...(entry.threadParts !== undefined
        ? { threadParts: entry.threadParts ?? Prisma.JsonNull }
        : {}),
    };
  }

  getEntries(orgId: string, query: SwipeQueryDto) {
    return this._entries.model.swipeEntry.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: query.status || SwipeStatus.LIBRARY,
        ...(query.formatTag ? { formatTag: query.formatTag } : {}),
        ...(query.collection ? { collection: query.collection } : {}),
        ...(query.starred === 'true' ? { starred: true } : {}),
        ...(query.q
          ? {
              OR: [
                { content: { contains: query.q, mode: 'insensitive' } },
                { author: { contains: query.q, mode: 'insensitive' } },
                { topicTags: { has: query.q.toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  getEntry(orgId: string, id: string) {
    return this._entries.model.swipeEntry.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  // with deleted rows too: a post the user rejected stays rejected
  getBySourceUrl(orgId: string, sourceUrl: string, withDeleted = false) {
    return this._entries.model.swipeEntry.findFirst({
      where: {
        organizationId: orgId,
        sourceUrl,
        ...(withDeleted ? {} : { deletedAt: null }),
      },
    });
  }

  createEntry(
    orgId: string,
    entry: SwipeEntryDto,
    status: SwipeStatus,
    origin: SwipeOrigin,
    metrics?: Prisma.InputJsonValue
  ) {
    return this._entries.model.swipeEntry.create({
      data: {
        ...this.values(entry),
        organizationId: orgId,
        status,
        origin,
        ...(metrics ? { metrics } : {}),
      },
    });
  }

  updateEntry(orgId: string, id: string, entry: SwipeEntryDto) {
    return this._entries.model.swipeEntry.update({
      where: { id, organizationId: orgId, deletedAt: null },
      data: this.values(entry),
    });
  }

  setStatus(orgId: string, id: string, status: SwipeStatus) {
    return this._entries.model.swipeEntry.update({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { status },
      select: { id: true },
    });
  }

  setStarred(orgId: string, id: string, starred: boolean) {
    return this._entries.model.swipeEntry.update({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { starred },
      select: { id: true },
    });
  }

  setTags(orgId: string, id: string, formatTag: string, topicTags: string[]) {
    return this._entries.model.swipeEntry.update({
      where: { id, organizationId: orgId },
      data: { formatTag, topicTags },
      select: { id: true },
    });
  }

  getOwnEntries(orgId: string) {
    return this._entries.model.swipeEntry.findMany({
      where: {
        organizationId: orgId,
        origin: SwipeOrigin.OWN,
        deletedAt: null,
      },
      select: { formatTag: true, metrics: true },
    });
  }

  markRepurposed(orgId: string, id: string) {
    return this._entries.model.swipeEntry.update({
      where: { id, organizationId: orgId },
      data: { lastRepurposedAt: new Date() },
      select: { id: true },
    });
  }

  deleteEntry(orgId: string, id: string) {
    return this._entries.model.swipeEntry.update({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
      select: { id: true },
    });
  }

  // Running the same import again updates the rows instead of duplicating them
  async importEntries(orgId: string, entries: SwipeEntryDto[]) {
    for (const entry of entries) {
      if (!entry.notionBlockId) {
        if (
          entry.sourceUrl &&
          (await this.getBySourceUrl(orgId, entry.sourceUrl, true))
        ) {
          continue;
        }
        await this.createEntry(
          orgId,
          entry,
          SwipeStatus.LIBRARY,
          SwipeOrigin.NOTION
        );
        continue;
      }

      await this._entries.model.swipeEntry.upsert({
        where: {
          organizationId_notionBlockId: {
            organizationId: orgId,
            notionBlockId: entry.notionBlockId,
          },
        },
        update: this.values(entry),
        create: {
          ...this.values(entry),
          organizationId: orgId,
          notionBlockId: entry.notionBlockId,
          origin: SwipeOrigin.NOTION,
        },
        select: { id: true },
      });
    }

    return { imported: entries.length };
  }

  createRun(
    orgId: string,
    run: {
      topic: string;
      searches: number;
      found: number;
      inputTokens: number;
      outputTokens: number;
    }
  ) {
    return this._runs.model.swipeRun.create({
      data: { ...run, organizationId: orgId },
      select: { id: true },
    });
  }

  getRuns(orgId: string) {
    return this._runs.model.swipeRun.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
