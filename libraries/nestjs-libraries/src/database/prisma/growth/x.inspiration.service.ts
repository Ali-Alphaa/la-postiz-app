import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { XInspirationRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/x.inspiration.repository';
import { AnthropicService } from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import {
  XCaptureDto,
  XCapturedTweetDto,
  XLibraryQueryDto,
} from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';
import {
  bestVoiceSamples,
  evaluateAuthor,
  mergeVoiceSamples,
  XLikeSample,
  XVoiceSample,
} from '@gitroom/helpers/utils/x.library';

const ANALYZE_BATCH = 20;
const ANALYZE_MAX_BATCHES = 5;
const MIN_VOICE_SAMPLES = 5;

// what is kept of a tweet that waits for a bigger author baseline
const pendingPayload = (tweet: XCapturedTweetDto) => ({
  id: tweet.id,
  url: tweet.url,
  authorHandle: tweet.authorHandle,
  authorName: tweet.authorName || null,
  text: tweet.text,
  likes: tweet.likes,
  reposts: tweet.reposts,
  replies: tweet.replies,
  views: tweet.views ?? null,
  mediaType: tweet.mediaType,
  postedAt: tweet.postedAt || null,
});

type PendingTweet = ReturnType<typeof pendingPayload>;

// midnight of the browser of the user, in UTC
const startOfToday = (utcOffset = 0) => {
  const local = new Date(Date.now() - utcOffset * 60000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() + utcOffset * 60000);
};

@Injectable()
export class XInspirationService {
  private readonly _logger = new Logger(XInspirationService.name);
  // organizations with an analysis running in this process
  private _analyzing = new Set<string>();

  constructor(
    private _xInspirationRepository: XInspirationRepository,
    private _anthropicService: AnthropicService
  ) {}

  async capture(orgId: string, body: XCaptureDto) {
    // the latest copy of a tweet wins
    const tweets = [
      ...new Map(body.tweets.map((p) => [p.id, p] as const)).values(),
    ];
    const ownHandle = body.ownHandle?.toLowerCase();
    const isOwn = (tweet: XCapturedTweetDto) =>
      !!tweet.own ||
      (!!ownHandle && tweet.authorHandle.toLowerCase() === ownHandle);

    const own = tweets.filter(isOwn);
    if (own.length) {
      await this.saveOwnTweets(
        orgId,
        body.ownHandle || own[0].authorHandle,
        own
      );
    }

    const others = tweets.filter((p) => !isOwn(p));
    const byAuthor = new Map<string, XCapturedTweetDto[]>();
    for (const tweet of others) {
      const handle = tweet.authorHandle.toLowerCase();
      byAuthor.set(handle, [...(byAuthor.get(handle) || []), tweet]);
    }

    const baselines = new Map(
      (
        await this._xInspirationRepository.getBaselines(orgId, [
          ...byAuthor.keys(),
        ])
      ).map((p) => [p.handle, p] as const)
    );
    const inLibrary = new Set(
      await this._xInspirationRepository.getLibraryTweetIds(
        orgId,
        others.map((p) => p.id)
      )
    );

    let saved = 0;
    for (const [handle, list] of byAuthor) {
      const baseline = baselines.get(handle);
      const result = evaluateAuthor<PendingTweet>(
        {
          samples: (baseline?.samples || []) as unknown as XLikeSample[],
          pending: (baseline?.pending || []) as unknown as PendingTweet[],
        },
        list.map(pendingPayload)
      );

      await this._xInspirationRepository.saveBaseline(
        orgId,
        handle,
        result.samples,
        result.pending
      );

      const viralIds = new Set<string>();
      for (const { tweet, ratio } of result.viral) {
        viralIds.add(tweet.id);
        await this._xInspirationRepository.upsertViralTweet(
          orgId,
          tweet.id,
          tweet,
          ratio
        );
        if (!inLibrary.has(tweet.id)) {
          saved++;
        }
      }

      // fresher counts of a tweet that was saved before
      for (const tweet of list) {
        if (inLibrary.has(tweet.id) && !viralIds.has(tweet.id)) {
          await this._xInspirationRepository.updateTweetCounts(
            orgId,
            tweet.id,
            tweet
          );
        }
      }
    }

    if (saved) {
      this.analyzeInBackground(orgId);
    }

    return {
      saved,
      savedToday: await this._xInspirationRepository.countSavedSince(
        orgId,
        startOfToday(body.utcOffset)
      ),
    };
  }

  private async saveOwnTweets(
    orgId: string,
    handle: string,
    tweets: XCapturedTweetDto[]
  ) {
    const profile = await this._xInspirationRepository.getVoiceProfile(orgId);
    const samples = mergeVoiceSamples(
      (profile?.samples || []) as unknown as XVoiceSample[],
      tweets.map((p) => ({
        id: p.id,
        text: p.text,
        likes: p.likes,
        postedAt: p.postedAt || null,
      }))
    );
    await this._xInspirationRepository.saveVoiceSamples(
      orgId,
      handle,
      samples
    );
  }

  // the capture request doesn't wait for Claude
  private analyzeInBackground(orgId: string) {
    if (!this._anthropicService.isAvailable() || this._analyzing.has(orgId)) {
      return;
    }

    this._analyzing.add(orgId);
    this.analyzePending(orgId)
      .catch((err) => this._logger.error(err))
      .finally(() => this._analyzing.delete(orgId));
  }

  private async analyzePending(orgId: string) {
    let analyzed = 0;
    for (let batch = 0; batch < ANALYZE_MAX_BATCHES; batch++) {
      const tweets = await this._xInspirationRepository.getTweetsToAnalyze(
        orgId,
        ANALYZE_BATCH
      );
      if (!tweets.length) {
        break;
      }

      const result = await this._anthropicService.analyzeViralTweets(tweets);
      if (result.status !== 'ok') {
        return { analyzed, error: result.status };
      }

      const byId = new Map(result.data.map((p) => [p.id, p] as const));
      for (const tweet of tweets) {
        const analysis = byId.get(tweet.id);
        // a tweet the model skipped is marked as analyzed without tags, so
        // it doesn't block the next ones
        await this._xInspirationRepository.saveAnalysis(orgId, tweet.id, {
          topics: (analysis?.topics || [])
            .map((p) => p.trim().toLowerCase())
            .filter((p) => p)
            .slice(0, 3),
          hookType: analysis?.hookType || null,
          format: analysis?.format || null,
          onNiche: analysis ? analysis.onNiche : null,
        });
        analyzed++;
      }
    }

    return { analyzed, error: null };
  }

  async analyzeNow(orgId: string) {
    if (!this._anthropicService.isAvailable()) {
      return { available: false, running: false, analyzed: 0, error: null };
    }

    if (this._analyzing.has(orgId)) {
      return { available: true, running: true, analyzed: 0, error: null };
    }

    this._analyzing.add(orgId);
    try {
      const { analyzed, error } = await this.analyzePending(orgId);
      return { available: true, running: false, analyzed, error };
    } finally {
      this._analyzing.delete(orgId);
    }
  }

  async getStatus(orgId: string) {
    const [total, toAnalyze, topics] = await Promise.all([
      this._xInspirationRepository.countTweets(orgId, false),
      this._xInspirationRepository.countTweets(orgId, true),
      this._xInspirationRepository.getTopics(orgId),
    ]);

    const count = new Map<string, number>();
    for (const topic of topics.flatMap((p) => p.topics)) {
      count.set(topic, (count.get(topic) || 0) + 1);
    }

    return {
      aiAvailable: this._anthropicService.isAvailable(),
      analyzing: this._analyzing.has(orgId),
      total,
      toAnalyze,
      topics: [...count.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 30)
        .map(([topic]) => topic),
    };
  }

  getLibrary(orgId: string, query: XLibraryQueryDto) {
    return this._xInspirationRepository.getLibrary(orgId, query);
  }

  async hideTweet(orgId: string, id: string) {
    await this._xInspirationRepository.hideTweet(orgId, id);
    return { id };
  }

  async getVoice(orgId: string) {
    const profile = await this._xInspirationRepository.getVoiceProfile(orgId);
    const samples = (profile?.samples || []) as unknown as XVoiceSample[];
    return {
      aiAvailable: this._anthropicService.isAvailable(),
      handle: profile?.handle || null,
      sampleCount: samples.length,
      styleGuide: profile?.styleGuide || '',
      generatedAt: profile?.generatedAt || null,
      best: bestVoiceSamples(samples, 5),
    };
  }

  async updateVoice(orgId: string, styleGuide: string) {
    await this._xInspirationRepository.saveStyleGuide(orgId, styleGuide, false);
    return { styleGuide };
  }

  async generateVoice(orgId: string) {
    if (!this._anthropicService.isAvailable()) {
      return { available: false, styleGuide: '', error: null };
    }

    const profile = await this._xInspirationRepository.getVoiceProfile(orgId);
    const samples = bestVoiceSamples(
      (profile?.samples || []) as unknown as XVoiceSample[]
    );
    if (samples.length < MIN_VOICE_SAMPLES) {
      throw new BadRequestException(
        `At least ${MIN_VOICE_SAMPLES} of your tweets are needed: open your X profile with the extension installed`
      );
    }

    const result = await this._anthropicService.generateVoiceGuide(samples);
    if (result.status !== 'ok') {
      return { available: true, styleGuide: '', error: result.status };
    }

    await this._xInspirationRepository.saveStyleGuide(orgId, result.data, true);
    return { available: true, styleGuide: result.data, error: null };
  }

  async rewrite(orgId: string, id: string, format: 'single' | 'thread') {
    if (!this._anthropicService.isAvailable()) {
      return { available: false, drafts: [] as string[][], error: null };
    }

    const tweet = await this._xInspirationRepository.getTweet(orgId, id);
    if (!tweet) {
      throw new NotFoundException('Tweet not found');
    }

    const profile = await this._xInspirationRepository.getVoiceProfile(orgId);
    const result = await this._anthropicService.rewriteInVoice(
      tweet.text,
      profile?.styleGuide || '',
      { format }
    );
    if (result.status !== 'ok') {
      return { available: true, drafts: [] as string[][], error: result.status };
    }

    return { available: true, drafts: result.data, error: null };
  }
}
