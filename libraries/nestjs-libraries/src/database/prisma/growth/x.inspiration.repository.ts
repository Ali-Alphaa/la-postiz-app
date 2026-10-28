import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { XLibraryQueryDto } from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';
import { XLikeSample, XVoiceSample } from '@gitroom/helpers/utils/x.library';

export interface XTweetValues {
  url: string;
  authorHandle: string;
  authorName?: string | null;
  text: string;
  likes: number;
  reposts: number;
  replies: number;
  views?: number | null;
  mediaType: string;
  postedAt?: string | null;
}

const PAGE_SIZE = 20;

const tweetSelect = {
  id: true,
  tweetId: true,
  url: true,
  authorHandle: true,
  authorName: true,
  text: true,
  likes: true,
  reposts: true,
  replies: true,
  views: true,
  mediaType: true,
  postedAt: true,
  ratio: true,
  topics: true,
  hookType: true,
  format: true,
  onNiche: true,
  analyzedAt: true,
  source: true,
  capturedAt: true,
} satisfies Prisma.XViralTweetSelect;

@Injectable()
export class XInspirationRepository {
  constructor(
    private _xAuthorBaseline: PrismaRepository<'xAuthorBaseline'>,
    private _xViralTweet: PrismaRepository<'xViralTweet'>,
    private _xVoiceProfile: PrismaRepository<'xVoiceProfile'>,
    private _xRepurpose: PrismaRepository<'xRepurpose'>
  ) {}

  getBaselines(orgId: string, handles: string[]) {
    return this._xAuthorBaseline.model.xAuthorBaseline.findMany({
      where: { organizationId: orgId, handle: { in: handles } },
      select: { handle: true, samples: true, pending: true },
    });
  }

  saveBaseline(
    orgId: string,
    handle: string,
    samples: XLikeSample[],
    pending: object[]
  ) {
    const values = {
      samples: samples as unknown as Prisma.InputJsonValue,
      pending: pending as unknown as Prisma.InputJsonValue,
    };

    return this._xAuthorBaseline.model.xAuthorBaseline.upsert({
      where: { organizationId_handle: { organizationId: orgId, handle } },
      update: values,
      create: { organizationId: orgId, handle, ...values },
      select: { id: true },
    });
  }

  async getLibraryTweetIds(orgId: string, tweetIds: string[]) {
    return (
      await this._xViralTweet.model.xViralTweet.findMany({
        where: { organizationId: orgId, tweetId: { in: tweetIds } },
        select: { tweetId: true },
      })
    ).map((p) => p.tweetId);
  }

  private counts(tweet: XTweetValues) {
    return {
      likes: tweet.likes,
      reposts: tweet.reposts,
      replies: tweet.replies,
      ...(tweet.views !== undefined && tweet.views !== null
        ? { views: tweet.views }
        : {}),
    };
  }

  // an automatic save never brings back a tweet the user hid (deletedAt),
  // a manual save does. The analysis is kept.
  upsertViralTweet(
    orgId: string,
    tweetId: string,
    tweet: XTweetValues,
    ratio: number,
    source: 'auto' | 'manual'
  ) {
    const values = {
      url: tweet.url,
      authorHandle: tweet.authorHandle,
      authorName: tweet.authorName || null,
      text: tweet.text,
      mediaType: tweet.mediaType,
      // a manual save of an author that is not known yet has no ratio
      ...(ratio ? { ratio } : {}),
      ...this.counts(tweet),
      ...(source === 'manual'
        ? { source, deletedAt: null as Date | null }
        : {}),
    };

    return this._xViralTweet.model.xViralTweet.upsert({
      where: { organizationId_tweetId: { organizationId: orgId, tweetId } },
      update: values,
      create: {
        organizationId: orgId,
        tweetId,
        source,
        postedAt: tweet.postedAt ? new Date(tweet.postedAt) : null,
        ...values,
      },
      select: { id: true },
    });
  }

  // a tweet added by its link: X only gives its text, the counts of a tweet
  // that is already known are kept
  upsertLinkedTweet(
    orgId: string,
    tweetId: string,
    tweet: Omit<XTweetValues, 'likes' | 'reposts' | 'replies' | 'views'>
  ) {
    return this._xViralTweet.model.xViralTweet.upsert({
      where: { organizationId_tweetId: { organizationId: orgId, tweetId } },
      update: { source: 'manual', deletedAt: null },
      create: {
        organizationId: orgId,
        tweetId,
        source: 'manual',
        url: tweet.url,
        authorHandle: tweet.authorHandle,
        authorName: tweet.authorName || null,
        text: tweet.text,
        mediaType: tweet.mediaType,
        postedAt: tweet.postedAt ? new Date(tweet.postedAt) : null,
      },
      select: { id: true },
    });
  }

  getTweetsByIds(orgId: string, ids: string[]) {
    return this._xViralTweet.model.xViralTweet.findMany({
      where: { organizationId: orgId, id: { in: ids }, deletedAt: null },
      select: { id: true, text: true, authorHandle: true },
    });
  }

  createRepurpose(
    orgId: string,
    sourceTweetIds: string[],
    variations: string[][]
  ) {
    return this._xRepurpose.model.xRepurpose.create({
      data: {
        organizationId: orgId,
        sourceTweetIds,
        variations: variations as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  }

  getRepurpose(orgId: string, id: string) {
    return this._xRepurpose.model.xRepurpose.findFirst({
      where: { organizationId: orgId, id },
      select: { id: true, variations: true },
    });
  }

  setRepurposePost(
    orgId: string,
    id: string,
    chosenIndex: number,
    // with the chosen one as the user edited it
    variations: string[][],
    postId: string
  ) {
    return this._xRepurpose.model.xRepurpose.updateMany({
      where: { organizationId: orgId, id },
      data: {
        chosenIndex,
        postId,
        variations: variations as unknown as Prisma.InputJsonValue,
      },
    });
  }

  updateTweetCounts(orgId: string, tweetId: string, tweet: XTweetValues) {
    return this._xViralTweet.model.xViralTweet.updateMany({
      where: { organizationId: orgId, tweetId },
      data: this.counts(tweet),
    });
  }

  countSavedSince(orgId: string, since: Date) {
    return this._xViralTweet.model.xViralTweet.count({
      where: { organizationId: orgId, capturedAt: { gte: since } },
    });
  }

  async getLibrary(orgId: string, query: XLibraryQueryDto) {
    const search = query.search?.trim();
    const and: Prisma.XViralTweetWhereInput[] = [];

    if (search) {
      and.push({
        OR: [
          { text: { contains: search, mode: 'insensitive' } },
          { authorHandle: { contains: search, mode: 'insensitive' } },
          { authorName: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    // the library defaults to the niche, tweets not analyzed yet included
    if (query.niche === 'on' || !query.niche) {
      and.push({ OR: [{ onNiche: true }, { onNiche: null }] });
    } else if (query.niche === 'off') {
      and.push({ onNiche: false });
    }

    const where: Prisma.XViralTweetWhereInput = {
      organizationId: orgId,
      deletedAt: null,
      ...(query.topic ? { topics: { has: query.topic } } : {}),
      ...(query.hookType ? { hookType: query.hookType } : {}),
      ...(query.format ? { format: query.format } : {}),
      ...(query.minRatio ? { ratio: { gte: query.minRatio } } : {}),
      ...(query.source ? { source: query.source } : {}),
      AND: and,
    };

    const orderBy: Prisma.XViralTweetOrderByWithRelationInput[] =
      query.sort === 'likes'
        ? [{ likes: 'desc' }, { capturedAt: 'desc' }]
        : query.sort === 'recent'
        ? [{ capturedAt: 'desc' }]
        : [{ ratio: 'desc' }, { capturedAt: 'desc' }];

    const page = Math.max(query.page || 1, 1);
    const [total, results] = await Promise.all([
      this._xViralTweet.model.xViralTweet.count({ where }),
      this._xViralTweet.model.xViralTweet.findMany({
        where,
        select: tweetSelect,
        orderBy,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
    ]);

    return { pages: Math.ceil(total / PAGE_SIZE), total, results };
  }

  hideTweet(orgId: string, id: string) {
    return this._xViralTweet.model.xViralTweet.updateMany({
      where: { organizationId: orgId, id },
      data: { deletedAt: new Date() },
    });
  }

  getTweet(orgId: string, id: string) {
    return this._xViralTweet.model.xViralTweet.findFirst({
      where: { organizationId: orgId, id, deletedAt: null },
      select: { id: true, text: true },
    });
  }

  getTweetsToAnalyze(orgId: string, take: number) {
    return this._xViralTweet.model.xViralTweet.findMany({
      where: { organizationId: orgId, deletedAt: null, analyzedAt: null },
      select: { id: true, text: true, mediaType: true },
      orderBy: { capturedAt: 'asc' },
      take,
    });
  }

  countTweets(orgId: string, toAnalyze: boolean) {
    return this._xViralTweet.model.xViralTweet.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(toAnalyze ? { analyzedAt: null } : {}),
      },
    });
  }

  saveAnalysis(
    orgId: string,
    id: string,
    analysis: {
      topics: string[];
      hookType: string | null;
      format: string | null;
      onNiche: boolean | null;
    }
  ) {
    return this._xViralTweet.model.xViralTweet.updateMany({
      where: { organizationId: orgId, id },
      data: { ...analysis, analyzedAt: new Date() },
    });
  }

  getTopics(orgId: string) {
    return this._xViralTweet.model.xViralTweet.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        analyzedAt: { not: null },
      },
      select: { topics: true },
      orderBy: { capturedAt: 'desc' },
      take: 500,
    });
  }

  getVoiceProfile(orgId: string) {
    return this._xVoiceProfile.model.xVoiceProfile.findUnique({
      where: { organizationId: orgId },
      select: {
        handle: true,
        samples: true,
        styleGuide: true,
        generatedAt: true,
        updatedAt: true,
      },
    });
  }

  saveVoiceSamples(orgId: string, handle: string, samples: XVoiceSample[]) {
    const values = {
      handle,
      samples: samples as unknown as Prisma.InputJsonValue,
    };
    return this._xVoiceProfile.model.xVoiceProfile.upsert({
      where: { organizationId: orgId },
      update: values,
      create: { organizationId: orgId, ...values },
      select: { id: true },
    });
  }

  saveStyleGuide(orgId: string, styleGuide: string, generated: boolean) {
    const values = {
      styleGuide,
      ...(generated ? { generatedAt: new Date() } : {}),
    };
    return this._xVoiceProfile.model.xVoiceProfile.upsert({
      where: { organizationId: orgId },
      update: values,
      create: { organizationId: orgId, ...values },
      select: { id: true },
    });
  }
}
