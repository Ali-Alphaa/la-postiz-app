// Portions adapted from XActions (https://github.com/nirholas/XActions),
// Copyright (c) 2024-2026 nich (@nichxbt), Licensed under the Apache License,
// Version 2.0 (src/scrapers/twitter/http/client.js, guest.js, auth.js,
// tweets.js scrapeTweets / scrapeTweetsAndReplies / scrapeTweetById /
// resolveUserId and search.js searchTweets).
// Modifications: ported to TypeScript as one read-only client: GraphQL reads
// only (no mutation, REST write, media, DM or account code), one guest token
// instead of a pool, cookie auth from two values instead of a cookie jar or a
// login flow, no proxy, no HTTP/2, no retries with back-off (an error is
// reported to the user instead), pages bounded, errors mapped to the codes of
// XFetcherError. Every network call goes through the fetch of the caller,
// which enforces the daily limit, the spacing and the timeout.

import {
  BEARER_TOKEN,
  buildGraphQLRequest,
  GUEST_ACTIVATE_URL,
  XOperationName,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.endpoints';
import {
  errorFromGraphQL,
  isStaleQueryId,
  XFetcherError,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.errors';
import {
  parseTimelineInstructions,
  parseTweetData,
  searchInstructions,
  userTimelineInstructions,
  XFetchedTweet,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.parser';
import {
  getTransactionId,
  XFetch,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.transaction';
import {
  getQueryId,
  refreshQueryIds,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.query.ids';

export const PAGE_SIZE = 20;
export const MAX_RESULTS = 100;
// pages of one timeline or search, whatever the cursor says
export const MAX_PAGES = 6;
const GUEST_TOKEN_TTL_MS = 2.5 * 60 * 60 * 1000;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

export interface XFetcherClientOptions {
  mode: 'guest' | 'cookies';
  authToken?: string;
  ct0?: string;
  fetch: XFetch;
}

// one guest token for the process, x.com gives it for ~3 hours
const guest = {
  token: null as null | { value: string; at: number },
  inflight: null as null | Promise<string>,
};

export const resetGuestToken = () => {
  guest.token = null;
  guest.inflight = null;
};

export class XFetcherClient {
  private userAgent =
    USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  constructor(private options: XFetcherClientOptions) {
    if (options.mode === 'cookies' && (!options.authToken || !options.ct0)) {
      throw new XFetcherError(
        'auth_failed',
        'cookie mode without X_FETCHER_AUTH_TOKEN / X_FETCHER_CT0'
      );
    }
  }

  private async activateGuestToken() {
    const response = await this.options.fetch(GUEST_ACTIVATE_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': this.userAgent,
      },
    });
    if (response.status === 429) {
      throw new XFetcherError('rate_limited', 'guest activation 429');
    }
    if (!response.ok) {
      throw new XFetcherError(
        'blocked',
        `guest activation answered ${response.status}`
      );
    }
    const body = await response.json().catch(() => ({}));
    if (!body?.guest_token) {
      throw new XFetcherError('schema_changed', 'no guest_token in activation');
    }
    guest.token = { value: String(body.guest_token), at: Date.now() };
    return guest.token.value;
  }

  private async guestToken() {
    if (guest.token && Date.now() - guest.token.at < GUEST_TOKEN_TTL_MS) {
      return guest.token.value;
    }
    if (!guest.inflight) {
      guest.inflight = this.activateGuestToken().finally(() => {
        guest.inflight = null;
      });
    }
    return guest.inflight;
  }

  private async headers(method: string, url: string) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
      'user-agent': this.userAgent,
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'content-type': 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
    };

    if (this.options.mode === 'cookies') {
      headers['x-csrf-token'] = this.options.ct0!;
      headers['x-twitter-auth-type'] = 'OAuth2Session';
      headers.cookie = `auth_token=${this.options.authToken}; ct0=${this.options.ct0}`;
    } else {
      headers['x-guest-token'] = await this.guestToken();
    }

    const transactionId = await getTransactionId(
      this.options.fetch,
      this.userAgent,
      method,
      url
    );
    if (transactionId) {
      headers['x-client-transaction-id'] = transactionId;
    }
    return headers;
  }

  private async graphqlOnce(
    name: XOperationName,
    variables: Record<string, unknown>
  ) {
    const request = buildGraphQLRequest(name, getQueryId(name), variables);
    let response: Response;
    try {
      response = await this.options.fetch(request.url, {
        method: request.method,
        headers: await this.headers(request.method, request.url),
        body: request.body,
      });
    } catch (err) {
      if (err instanceof XFetcherError) {
        throw err;
      }
      throw new XFetcherError('blocked', (err as Error)?.name || 'network');
    }

    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }

  // one GraphQL read; a rejected query id is looked up again once
  private async graphql(
    name: XOperationName,
    variables: Record<string, unknown>
  ): Promise<any> {
    let { status, body } = await this.graphqlOnce(name, variables);

    if (
      isStaleQueryId(status, body) &&
      (await refreshQueryIds(this.options.fetch, this.userAgent, name))
    ) {
      ({ status, body } = await this.graphqlOnce(name, variables));
    }

    // an expired guest token: one more try with a new one
    if (status === 403 && this.options.mode === 'guest') {
      resetGuestToken();
      ({ status, body } = await this.graphqlOnce(name, variables));
    }

    if (status === 429) {
      throw new XFetcherError('rate_limited', `${name} 429`);
    }
    if (status === 401 || status === 403) {
      throw new XFetcherError(
        this.options.mode === 'cookies' ? 'auth_failed' : 'blocked',
        `${name} ${status}`
      );
    }
    if (isStaleQueryId(status, body)) {
      throw new XFetcherError('schema_changed', `${name} ${status}`);
    }
    if (status >= 400 || !body) {
      throw (
        errorFromGraphQL(body?.errors) ||
        new XFetcherError(
          status >= 500 ? 'blocked' : 'schema_changed',
          `${name} ${status}`
        )
      );
    }
    if (!body.data) {
      throw (
        errorFromGraphQL(body.errors) ||
        new XFetcherError('schema_changed', `${name} without data`)
      );
    }
    return body.data;
  }

  async tweetById(id: string): Promise<XFetchedTweet> {
    const data = await this.graphql('TweetResultByRestId', {
      tweetId: id,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false,
    });
    const result = data?.tweetResult?.result;
    const tweet = result ? parseTweetData(result) : null;
    if (!tweet) {
      throw new XFetcherError('not_found', `tweet ${id}`);
    }
    return tweet;
  }

  async userId(handle: string): Promise<string> {
    const data = await this.graphql('UserByScreenName', {
      screen_name: handle,
      withSafetyModeUserFields: true,
    });
    const result = data?.user?.result;
    if (!result || result.__typename === 'UserUnavailable' || !result.rest_id) {
      throw new XFetcherError('not_found', `user ${handle}`);
    }
    return String(result.rest_id);
  }

  // pages until `limit` tweets, no cursor, an empty page or MAX_PAGES
  private async paginate(
    limit: number,
    page: (cursor: string | null) => Promise<any[]>
  ) {
    const tweets = new Map<string, XFetchedTweet>();
    let cursor: string | null = null;
    for (let index = 0; index < MAX_PAGES && tweets.size < limit; index++) {
      const parsed = parseTimelineInstructions(await page(cursor));
      const before = tweets.size;
      for (const tweet of parsed.tweets) {
        if (tweets.size < limit && !tweets.has(tweet.id)) {
          tweets.set(tweet.id, tweet);
        }
      }
      if (
        !parsed.cursor ||
        parsed.cursor === cursor ||
        tweets.size === before
      ) {
        break;
      }
      cursor = parsed.cursor;
    }
    return [...tweets.values()];
  }

  async userTweets(
    handle: string,
    options: { limit: number; includeReplies?: boolean }
  ) {
    const limit = Math.min(Math.max(options.limit, 1), MAX_RESULTS);
    const userId = await this.userId(handle);
    const name: XOperationName = options.includeReplies
      ? 'UserTweetsAndReplies'
      : 'UserTweets';

    const tweets = await this.paginate(limit, async (cursor) =>
      userTimelineInstructions(
        await this.graphql(name, {
          userId,
          count: PAGE_SIZE,
          includePromotedContent: false,
          withQuickPromoteEligibilityTweetFields: true,
          withVoice: true,
          withV2Timeline: true,
          ...(options.includeReplies ? { withCommunity: true } : {}),
          ...(cursor ? { cursor } : {}),
        })
      )
    );

    // the timeline also lists the tweets the user reposted
    return tweets.filter(
      (p) =>
        p.authorHandle.toLowerCase() === handle.toLowerCase() &&
        (options.includeReplies || !p.isReply)
    );
  }

  async search(
    rawQuery: string,
    options: { mode: 'latest' | 'top'; limit: number }
  ) {
    const limit = Math.min(Math.max(options.limit, 1), MAX_RESULTS);
    return this.paginate(limit, async (cursor) =>
      searchInstructions(
        await this.graphql('SearchTimeline', {
          rawQuery,
          count: PAGE_SIZE,
          querySource: 'typed_query',
          product: options.mode === 'top' ? 'Top' : 'Latest',
          ...(cursor ? { cursor } : {}),
        })
      )
    );
  }
}
