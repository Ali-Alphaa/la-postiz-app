import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { XInspirationRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/x.inspiration.repository';
import { AnthropicService } from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import { GrowthRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.repository';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  XCaptureDto,
  XCapturedTweetDto,
  XLibraryQueryDto,
  XRepurposeDto,
  XRepurposePostDto,
  XSaveUrlDto,
} from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';
import {
  bestVoiceSamples,
  evaluateAuthor,
  likesRatio,
  mergeVoiceSamples,
  oembedHtmlToTweet,
  parseTweetUrl,
  XLikeSample,
  XVoiceSample,
} from '@gitroom/helpers/utils/x.library';

dayjs.extend(utc);

const ANALYZE_BATCH = 20;
const OEMBED_TIMEOUT = 8000;
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

// the editor keeps a post as html paragraphs
const textToHtml = (text: string) =>
  text
    .split('\n')
    .map(
      (line) =>
        `<p>${line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</p>`
    )
    .join('');

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
    private _anthropicService: AnthropicService,
    private _growthRepository: GrowthRepository,
    private _postsService: PostsService,
    private _integrationService: IntegrationService
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
    const samplesOf = new Map<string, XLikeSample[]>();
    for (const [handle, list] of byAuthor) {
      const baseline = baselines.get(handle);
      const result = evaluateAuthor<PendingTweet>(
        {
          samples: (baseline?.samples || []) as unknown as XLikeSample[],
          pending: (baseline?.pending || []) as unknown as PendingTweet[],
        },
        list.map(pendingPayload)
      );
      samplesOf.set(handle, result.samples);

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
          ratio,
          list.some((p) => p.id === tweet.id && p.manual) ? 'manual' : 'auto'
        );
        if (!inLibrary.has(tweet.id)) {
          inLibrary.add(tweet.id);
          saved++;
        }
      }

      // fresher counts of a tweet that was saved before
      for (const tweet of list) {
        if (
          inLibrary.has(tweet.id) &&
          !viralIds.has(tweet.id) &&
          !tweet.manual
        ) {
          await this._xInspirationRepository.updateTweetCounts(
            orgId,
            tweet.id,
            tweet
          );
        }
      }
    }

    // saved with the button of the extension: kept whatever its likes, the
    // user's own tweets included
    const manual: string[] = [];
    for (const tweet of tweets.filter((p) => p.manual)) {
      if (!manual.includes(tweet.id)) {
        await this._xInspirationRepository.upsertViralTweet(
          orgId,
          tweet.id,
          pendingPayload(tweet),
          likesRatio(
            tweet,
            samplesOf.get(tweet.authorHandle.toLowerCase()) || []
          ),
          'manual'
        );
        if (!inLibrary.has(tweet.id)) {
          inLibrary.add(tweet.id);
          saved++;
        }
      }
      manual.push(tweet.id);
    }

    if (saved) {
      this.analyzeInBackground(orgId);
    }

    return {
      saved,
      manual,
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
    await this._xInspirationRepository.saveVoiceSamples(orgId, handle, samples);
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
      return {
        available: true,
        drafts: [] as string[][],
        error: result.status,
      };
    }

    return { available: true, drafts: result.data, error: null };
  }

  // The free oEmbed endpoint of X (no API key, no cost). Only the id and the
  // handle of the pasted link are used, the host is fixed.
  private async readTweet(parsed: { id: string; handle: string | null }) {
    try {
      const response = await fetch(
        `https://publish.twitter.com/oembed?url=${encodeURIComponent(
          `https://twitter.com/${parsed.handle || 'i'}/status/${parsed.id}`
        )}&omit_script=true&dnt=true`,
        { signal: AbortSignal.timeout(OEMBED_TIMEOUT), redirect: 'error' }
      );
      if (!response.ok) {
        return null;
      }

      const body = await response.json();
      const handle =
        String(body?.author_url || '').match(
          /^https:\/\/(?:twitter|x)\.com\/([A-Za-z0-9_]{1,15})$/
        )?.[1] || parsed.handle;
      const tweet = oembedHtmlToTweet(String(body?.html || ''));
      if (!handle || !tweet.text) {
        return null;
      }

      return {
        ...tweet,
        authorHandle: handle,
        authorName: String(body?.author_name || '').slice(0, 100) || null,
      };
    } catch (err) {
      this._logger.warn(
        `oEmbed failed for ${parsed.id}: ${(err as Error).message}`
      );
      return null;
    }
  }

  async saveFromUrl(orgId: string, body: XSaveUrlDto) {
    const parsed = parseTweetUrl(body.url);
    if (!parsed) {
      throw new BadRequestException(
        'This is not a link to a tweet (https://x.com/user/status/123)'
      );
    }

    const fromX = await this.readTweet(parsed);
    const text = body.text?.trim();
    if (!fromX && (!text || !parsed.handle)) {
      throw new BadRequestException(
        'X did not answer for this tweet, paste its text and try again'
      );
    }

    const tweet = fromX || {
      text: text!,
      authorHandle: parsed.handle!,
      authorName: null,
      mediaType: 'none' as const,
      postedAt: null,
    };

    const { id } = await this._xInspirationRepository.upsertLinkedTweet(
      orgId,
      parsed.id,
      {
        ...tweet,
        url: `https://x.com/${tweet.authorHandle}/status/${parsed.id}`,
      }
    );
    this.analyzeInBackground(orgId);

    return { id, fromX: !!fromX };
  }

  async repurpose(orgId: string, body: XRepurposeDto) {
    if (!this._anthropicService.isAvailable()) {
      return {
        available: false,
        id: null,
        variations: [] as string[][],
        error: null,
      };
    }

    const ids = [...new Set(body.tweetIds)];
    const tweets = await this._xInspirationRepository.getTweetsByIds(
      orgId,
      ids
    );
    if (tweets.length !== ids.length) {
      throw new NotFoundException('Tweet not found');
    }

    let styleGuide: string | undefined;
    if (body.useMyVoice) {
      styleGuide =
        (await this._xInspirationRepository.getVoiceProfile(orgId))
          ?.styleGuide || '';
      if (!styleGuide.trim()) {
        throw new BadRequestException(
          'Write or generate your style guide in "My voice" first'
        );
      }
    }

    const result = await this._anthropicService.repurposeTweets(
      ids.map((id) => tweets.find((p) => p.id === id)!),
      { format: body.format, styleGuide }
    );
    if (result.status !== 'ok') {
      return {
        available: true,
        id: null,
        variations: [] as string[][],
        error: result.status,
      };
    }

    const { id } = await this._xInspirationRepository.createRepurpose(
      orgId,
      ids,
      result.data
    );
    return { available: true, id, variations: result.data, error: null };
  }

  // Goes through the same path as the editor and the public API
  // (PostsService.createPost), so the post is published by the usual workflow
  async postRepurpose(orgId: string, id: string, body: XRepurposePostDto) {
    const repurpose = await this._xInspirationRepository.getRepurpose(
      orgId,
      id
    );
    if (!repurpose) {
      throw new NotFoundException('Variations not found');
    }
    const variations = repurpose.variations as unknown as string[][];
    if (body.index >= variations.length) {
      throw new BadRequestException('Variation not found');
    }

    const posts = body.posts.map((p) => p.trim()).filter((p) => p);
    if (!posts.length) {
      throw new BadRequestException('The variation is empty');
    }

    const integration = await this._integrationService.getIntegrationById(
      orgId,
      body.integrationId
    );
    if (!integration || integration.deletedAt || integration.disabled) {
      throw new NotFoundException('Channel not found');
    }
    if (integration.providerIdentifier !== 'x') {
      throw new BadRequestException('Pick an X channel');
    }

    const date = body.type === 'now' ? dayjs.utc() : dayjs.utc(body.date);
    if (body.type === 'schedule' && !date.isAfter(dayjs.utc())) {
      throw new BadRequestException('Pick a date in the future');
    }

    // the settings of the last post of the channel, like the A/B tests
    let lastSettings = {};
    try {
      lastSettings = JSON.parse(
        (
          await this._growthRepository.getLastPostSettings(
            orgId,
            integration.id
          )
        )?.settings || '{}'
      );
    } catch (err) {}
    const settings = {
      who_can_reply_post: 'everyone',
      ...lastSettings,
      __type: integration.providerIdentifier,
    };
    const value = posts.map((p) => ({
      content: textToHtml(p),
      delay: 0,
      image: [] as any[],
    }));

    const [validation] = await this._postsService.validatePosts(orgId, [
      { integration: { id: integration.id }, settings, value },
    ]);
    if (!validation.valid) {
      throw new BadRequestException(
        validation.settingsError || 'Please check the settings of this channel'
      );
    }
    if (validation.errors !== true) {
      throw new BadRequestException(validation.errors);
    }
    if (validation.tooLong) {
      throw new BadRequestException(
        `The maximum characters is ${validation.maximumCharacters}`
      );
    }

    const [created] = await this._postsService.createPost(
      orgId,
      {
        date: date.format('YYYY-MM-DDTHH:mm:ss') + 'Z',
        type: body.type,
        shortLink: false,
        tags: [],
        posts: [
          {
            integration: { id: integration.id },
            group: makeId(10),
            settings,
            value,
          },
        ],
      } as any,
      'WEB'
    );
    if (!created?.postId) {
      throw new BadRequestException('The post could not be created');
    }

    await this._xInspirationRepository.setRepurposePost(
      orgId,
      id,
      body.index,
      variations.map((p, index) => (index === body.index ? posts : p)),
      created.postId
    );

    return { postId: created.postId, date: date.toISOString() };
  }
}
