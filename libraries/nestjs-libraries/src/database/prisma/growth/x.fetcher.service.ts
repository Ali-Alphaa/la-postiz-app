import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { XInspirationRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/x.inspiration.repository';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  guardedFetch,
  isWithinDailyLimit,
  utcDay,
  xFetcherConfig,
  XFetcherConfig,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.config';
import { XFetcherClient } from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.client';
import { XFetcherError } from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.errors';
import {
  buildSearchQuery,
  XFetchedTweet,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.parser';
import {
  likesRatio,
  mergeLikeSamples,
  viralVerdict,
  XLikeSample,
} from '@gitroom/helpers/utils/x.library';
import {
  XFetchSearchDto,
  XFetchUserDto,
} from '@gitroom/nestjs-libraries/dtos/growth/x.inspiration.dto';

// fetched tweets wait here until the user saves some of them: what is saved
// is what X returned, never what the browser sends back
const CACHE_SECONDS = 3600;
const cacheKey = (orgId: string, id: string) => `x-fetch:${orgId}:${id}`;

export type XFetchedResult = XFetchedTweet & {
  ratio: number | null;
  viral: boolean;
};

// The optional, read-only X fetcher (see x-fetcher/NOTICE.md). Off unless
// X_FETCHER_ENABLED is set on the server.
@Injectable()
export class XFetcherService {
  private readonly _logger = new Logger(XFetcherService.name);

  constructor(private _xInspirationRepository: XInspirationRepository) {}

  private config() {
    const config = xFetcherConfig();
    if (!config.enabled) {
      throw new XFetcherError('disabled');
    }
    return config;
  }

  private client(orgId: string, config: XFetcherConfig) {
    return new XFetcherClient({
      mode: config.mode,
      authToken: config.authToken,
      ct0: config.ct0,
      fetch: guardedFetch({
        // counted before the request leaves, refused over the limit
        beforeXRequest: async () => {
          const count =
            await this._xInspirationRepository.incrementFetcherUsage(
              orgId,
              utcDay()
            );
          if (!isWithinDailyLimit(count, config.dailyLimit)) {
            throw new XFetcherError('daily_limit');
          }
        },
      }),
    });
  }

  // an XFetcherError is a message for the user (400), never a crash
  private async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      if (err instanceof XFetcherError) {
        this._logger.warn(`X fetcher ${err.code}: ${err.detail || ''}`);
        throw new BadRequestException({ message: err.message, code: err.code });
      }
      this._logger.error(`X fetcher failed: ${(err as Error)?.message}`);
      throw new BadRequestException({
        message: 'The X fetcher failed, try again later',
        code: 'error',
      });
    }
  }

  async getStatus(orgId: string) {
    const config = xFetcherConfig();
    return {
      enabled: config.enabled,
      mode: config.mode,
      usedToday: Math.min(
        await this._xInspirationRepository.getFetcherUsage(orgId, utcDay()),
        config.dailyLimit
      ),
      dailyLimit: config.dailyLimit,
    };
  }

  private async cache(orgId: string, tweets: XFetchedResult[]) {
    for (const tweet of tweets) {
      await ioRedis.set(
        cacheKey(orgId, tweet.id),
        JSON.stringify(tweet),
        'EX',
        CACHE_SECONDS
      );
    }
  }

  private async withLibrary(orgId: string, tweets: XFetchedResult[]) {
    const saved = new Set(
      await this._xInspirationRepository.getLibraryTweetIds(
        orgId,
        tweets.map((p) => p.id)
      )
    );
    return {
      tweets: tweets.map((p) => ({ ...p, inLibrary: saved.has(p.id) })),
      ...(await this.getStatus(orgId)),
    };
  }

  async fetchUser(orgId: string, body: XFetchUserDto) {
    return this.run(async () => {
      const config = this.config();
      const tweets = await this.client(orgId, config).userTweets(body.handle, {
        limit: body.limit,
        includeReplies: !!body.includeReplies,
      });

      // the fetched tweets are the baseline of the author
      const samples = tweets.map((p) => ({ id: p.id, likes: p.likes }));
      const results = tweets.map((tweet) => ({
        ...tweet,
        ratio: likesRatio(tweet, samples) || null,
        viral: viralVerdict(tweet, samples).status === 'viral',
      }));
      await this.cache(orgId, results);

      // they also help the automatic capture of the extension
      if (tweets.length) {
        const handle = body.handle.toLowerCase();
        const [baseline] = await this._xInspirationRepository.getBaselines(
          orgId,
          [handle]
        );
        await this._xInspirationRepository.saveBaseline(
          orgId,
          handle,
          mergeLikeSamples(
            (baseline?.samples || []) as unknown as XLikeSample[],
            samples
          ),
          (baseline?.pending || []) as unknown as object[]
        );
      }

      return this.withLibrary(orgId, results);
    });
  }

  async fetchSearch(orgId: string, body: XFetchSearchDto) {
    return this.run(async () => {
      const config = this.config();
      const query = buildSearchQuery({
        keywords: body.query,
        minLikes: body.minLikes,
      });
      if (!query) {
        throw new BadRequestException({
          message: 'Type something to search',
          code: 'invalid',
        });
      }

      const tweets = await this.client(orgId, config).search(query, {
        mode: body.mode,
        limit: body.limit,
      });
      const results = await this.withRatio(orgId, tweets);
      await this.cache(orgId, results);
      return this.withLibrary(orgId, results);
    });
  }

  // the ratio needs what the author usually gets: known only for the authors
  // that already have a baseline
  private async withRatio(orgId: string, tweets: XFetchedTweet[]) {
    const baselines = new Map(
      (
        await this._xInspirationRepository.getBaselines(orgId, [
          ...new Set(tweets.map((p) => p.authorHandle.toLowerCase())),
        ])
      ).map((p) => [p.handle, p.samples as unknown as XLikeSample[]] as const)
    );

    return tweets.map((tweet) => {
      const samples = baselines.get(tweet.authorHandle.toLowerCase());
      return {
        ...tweet,
        ratio: samples ? likesRatio(tweet, samples) || null : null,
        viral: samples
          ? viralVerdict(tweet, samples).status === 'viral'
          : false,
      };
    });
  }

  // The fetched tweets the user picked, from the cache. A tweet that left
  // the cache is read again from X (counted in the daily limit).
  async fetchedTweets(orgId: string, ids: string[]) {
    const found: XFetchedResult[] = [];
    const missing: string[] = [];
    for (const id of [...new Set(ids)]) {
      const cached = await ioRedis.get(cacheKey(orgId, id));
      if (cached) {
        found.push(JSON.parse(cached));
      } else {
        missing.push(id);
      }
    }

    if (missing.length) {
      await this.run(async () => {
        const client = this.client(orgId, this.config());
        for (const id of missing) {
          try {
            found.push(
              ...(await this.withRatio(orgId, [await client.tweetById(id)]))
            );
          } catch (err) {
            // a deleted tweet is skipped, a limit stops the loop
            if (!(err instanceof XFetcherError) || err.code !== 'not_found') {
              throw err;
            }
          }
        }
      });
    }

    return found;
  }

  // One tweet with its real counts, for a link the user pasted. Null when
  // the fetcher is off or X didn't answer: the caller falls back to oEmbed.
  async lookupTweet(orgId: string, id: string) {
    const config = xFetcherConfig();
    if (!config.enabled) {
      return null;
    }
    try {
      const tweet = await this.client(orgId, config).tweetById(id);
      return (await this.withRatio(orgId, [tweet]))[0];
    } catch (err) {
      this._logger.warn(
        `X fetcher lookup failed: ${
          err instanceof XFetcherError
            ? `${err.code} ${err.detail || ''}`
            : (err as Error)?.message
        }`
      );
      return null;
    }
  }
}
