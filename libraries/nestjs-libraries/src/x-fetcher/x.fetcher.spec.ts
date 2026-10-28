import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildSearchQuery,
  normalizeHandle,
  parseTimelineInstructions,
  parseTweetData,
  searchInstructions,
  userTimelineInstructions,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.parser';
import {
  guardedFetch,
  isWithinDailyLimit,
  utcDay,
  xFetcherConfig,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.config';
import {
  buildGraphQLRequest,
  OPERATIONS,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.endpoints';
import {
  errorFromGraphQL,
  XFetcherError,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.errors';
import {
  computeAnimationKey,
  extractAnimationPaths,
  extractKeyByteIndices,
  extractVerificationKey,
  floatToHex,
  generateTransactionId,
  normalizeSignedPath,
  parseChunkManifest,
  resetTransactionState,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.transaction';
import {
  extractOperations,
  getQueryId,
  resetQueryIdState,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.query.ids';
import {
  MAX_PAGES,
  resetGuestToken,
  XFetcherClient,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.client';

// ---------------------------------------------------------------------------
// Fixtures: the shapes x.com's GraphQL API returns (2026), fictional data
// ---------------------------------------------------------------------------

const user = (handle: string, name: string, legacyOnly = false) => ({
  result: {
    __typename: 'User',
    rest_id: '42',
    ...(legacyOnly
      ? { legacy: { screen_name: handle, name } }
      : { core: { screen_name: handle, name }, legacy: {} }),
  },
});

const tweetResult = (
  id: string,
  handle: string,
  likes: number,
  extra: { legacy?: any; tweet?: any } = {}
) => ({
  __typename: 'Tweet',
  rest_id: id,
  core: { user_results: user(handle, handle.toUpperCase()) },
  views: { count: String(likes * 20), state: 'EnabledWithCount' },
  legacy: {
    id_str: id,
    full_text: `tweet ${id} about risk`,
    created_at: 'Tue Oct 27 10:00:00 +0000 2026',
    favorite_count: likes,
    retweet_count: 3,
    reply_count: 2,
    quote_count: 1,
    ...extra.legacy,
  },
  ...extra.tweet,
});

const entry = (result: any) => ({
  entryId: `tweet-${result.rest_id || result.tweet?.rest_id}`,
  content: {
    entryType: 'TimelineTimelineItem',
    itemContent: { itemType: 'TimelineTweet', tweet_results: { result } },
  },
});

const cursor = (value: string, type = 'bottom') => ({
  entryId: `cursor-${type}-${value}`,
  content: {
    entryType: 'TimelineTimelineCursor',
    value,
    cursorType: type === 'bottom' ? 'Bottom' : 'Top',
  },
});

const timeline = (entries: any[], extra: any[] = []) => ({
  data: {
    user: {
      result: {
        __typename: 'User',
        timeline: {
          timeline: {
            instructions: [
              { type: 'TimelineClearCache' },
              ...extra,
              { type: 'TimelineAddEntries', entries },
            ],
          },
        },
      },
    },
  },
});

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('parseTweetData', () => {
  it('reads a tweet in the current shape', () => {
    expect(parseTweetData(tweetResult('100', 'alice', 450))).toEqual({
      id: '100',
      url: 'https://x.com/alice/status/100',
      authorHandle: 'alice',
      authorName: 'ALICE',
      text: 'tweet 100 about risk',
      likes: 450,
      reposts: 3,
      replies: 2,
      views: 9000,
      mediaType: 'none',
      postedAt: '2026-10-27T10:00:00.000Z',
      isReply: false,
      isRepost: false,
      isQuote: false,
    });
  });

  it('reads the legacy user shape, media, replies and quotes', () => {
    const tweet = parseTweetData({
      ...tweetResult('101', 'bob', 5, {
        legacy: {
          in_reply_to_status_id_str: '99',
          extended_entities: { media: [{ type: 'photo' }, { type: 'video' }] },
        },
        tweet: {
          quoted_status_result: { result: tweetResult('50', 'carol', 1) },
        },
      }),
      core: { user_results: user('bob', 'Bob', true) },
    });
    expect(tweet).toMatchObject({
      authorHandle: 'bob',
      authorName: 'Bob',
      mediaType: 'video',
      isReply: true,
      isQuote: true,
    });
  });

  it('uses the full text of long posts', () => {
    expect(
      parseTweetData(
        tweetResult('102', 'alice', 1, {
          tweet: {
            note_tweet: {
              note_tweet_results: { result: { text: 'the whole long post' } },
            },
          },
        })
      )?.text
    ).toBe('the whole long post');
  });

  it('unwraps visibility results and returns the original of a repost', () => {
    expect(
      parseTweetData({
        __typename: 'TweetWithVisibilityResults',
        tweet: tweetResult('103', 'alice', 7),
      })?.id
    ).toBe('103');
    expect(
      parseTweetData(
        tweetResult('104', 'dave', 0, {
          legacy: {
            retweeted_status_result: {
              result: tweetResult('105', 'erin', 900),
            },
          },
        })
      )
    ).toMatchObject({
      id: '105',
      authorHandle: 'erin',
      likes: 900,
      isRepost: true,
    });
  });

  it('skips tombstones and malformed results', () => {
    expect(parseTweetData({ __typename: 'TweetTombstone' })).toBeNull();
    expect(parseTweetData({ __typename: 'Tweet', rest_id: '1' })).toBeNull();
    expect(parseTweetData(null)).toBeNull();
  });
});

describe('parseTimelineInstructions', () => {
  it('reads tweets, modules, pinned tweets and the bottom cursor', () => {
    const data = timeline(
      [
        entry(tweetResult('1', 'alice', 10)),
        {
          entryId: 'promoted-tweet-9',
          content: entry(tweetResult('9', 'ads', 1)).content,
        },
        {
          entryId: 'profile-conversation-1',
          content: {
            items: [
              {
                item: {
                  itemContent: {
                    tweet_results: { result: tweetResult('2', 'alice', 20) },
                  },
                },
              },
            ],
          },
        },
        cursor('NEXT'),
        cursor('TOP', 'top'),
      ],
      [
        {
          type: 'TimelinePinEntry',
          entry: entry(tweetResult('3', 'alice', 30)),
        },
      ]
    ).data;
    const { tweets, cursor: next } = parseTimelineInstructions(
      userTimelineInstructions(data)
    );
    expect(tweets.map((p) => p.id).sort()).toEqual(['1', '2', '3']);
    expect(next).toBe('NEXT');
  });

  it('reads search results', () => {
    const data = {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [entry(tweetResult('7', 'zed', 1))],
              },
              {
                type: 'TimelineReplaceEntry',
                entry: cursor('MORE'),
              },
            ],
          },
        },
      },
    };
    const parsed = parseTimelineInstructions(searchInstructions(data));
    expect(parsed.tweets.map((p) => p.id)).toEqual(['7']);
    expect(parsed.cursor).toBe('MORE');
  });

  it('survives an unexpected shape', () => {
    expect(parseTimelineInstructions(undefined as any)).toEqual({
      tweets: [],
      cursor: null,
    });
    expect(userTimelineInstructions({})).toEqual([]);
  });
});

describe('query and handle validation', () => {
  it('normalizes handles', () => {
    expect(normalizeHandle('@Sigma_Trader ')).toBe('Sigma_Trader');
    expect(normalizeHandle('bad handle')).toBeNull();
    expect(normalizeHandle('waytoolonghandle1')).toBeNull();
  });

  it('builds the search query', () => {
    expect(
      buildSearchQuery({ keywords: ' forex\n risk  ', minLikes: 500 })
    ).toBe('forex risk min_faves:500');
    expect(buildSearchQuery({ keywords: 'from:alice lang:en' })).toBe(
      'from:alice lang:en'
    );
    expect(buildSearchQuery({ keywords: '  \u0000 ' })).toBeNull();
    expect(buildSearchQuery({ keywords: 'x'.repeat(400) })).toBeNull();
  });
});

describe('config and daily limit', () => {
  it('is off by default', () => {
    expect(xFetcherConfig({})).toEqual({
      enabled: false,
      mode: 'guest',
      authToken: undefined,
      ct0: undefined,
      dailyLimit: 150,
    });
    expect(
      xFetcherConfig({
        X_FETCHER_ENABLED: 'true',
        X_FETCHER_MODE: 'cookies',
        X_FETCHER_DAILY_LIMIT: '20',
      })
    ).toMatchObject({ enabled: true, mode: 'cookies', dailyLimit: 20 });
    expect(xFetcherConfig({ X_FETCHER_DAILY_LIMIT: '-3' }).dailyLimit).toBe(
      150
    );
  });

  it('counts per UTC day and allows up to the limit', () => {
    expect(utcDay(new Date('2026-10-27T23:59:59-02:00'))).toBe('2026-10-28');
    expect(isWithinDailyLimit(150, 150)).toBe(true);
    expect(isWithinDailyLimit(151, 150)).toBe(false);
  });

  it('guards the hosts and counts only x.com requests', async () => {
    let counted = 0;
    const calls: string[] = [];
    const fetch = guardedFetch({
      beforeXRequest: async () => {
        counted++;
        if (counted > 2) {
          throw new XFetcherError('daily_limit');
        }
      },
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return json({});
      }) as any,
      spacingMs: 0,
    });
    await fetch('https://x.com/i/api/graphql/a/B');
    await fetch('https://abs.twimg.com/responsive-web/client-web/main.js');
    await fetch('https://api.x.com/1.1/guest/activate.json');
    await expect(fetch('https://x.com/home')).rejects.toMatchObject({
      code: 'daily_limit',
    });
    await expect(fetch('https://evil.example/x')).rejects.toMatchObject({
      code: 'blocked',
    });
    await expect(fetch('http://x.com/home')).rejects.toMatchObject({
      code: 'blocked',
    });
    expect(counted).toBe(3);
    expect(calls).toHaveLength(3);
  });
});

describe('endpoints and errors', () => {
  it('builds GET and POST GraphQL requests', () => {
    const get = buildGraphQLRequest('UserTweets', 'QID', {
      userId: '1',
      count: 20,
    });
    expect(get.method).toBe('GET');
    const url = new URL(get.url);
    expect(url.pathname).toBe('/i/api/graphql/QID/UserTweets');
    expect(JSON.parse(url.searchParams.get('variables')!)).toEqual({
      userId: '1',
      count: 20,
    });
    expect(JSON.parse(url.searchParams.get('features')!)).toEqual(
      OPERATIONS.UserTweets.features
    );

    const post = buildGraphQLRequest('SearchTimeline', 'SID', {
      rawQuery: 'a',
    });
    expect(post.method).toBe('POST');
    expect(JSON.parse(post.body!)).toMatchObject({
      queryId: 'SID',
      variables: { rawQuery: 'a' },
    });
    expect(
      Object.keys(OPERATIONS.TweetResultByRestId.features).length
    ).toBeLessThan(Object.keys(OPERATIONS.UserTweets.features).length);
  });

  it('maps GraphQL errors', () => {
    expect(errorFromGraphQL([{ message: 'Rate limit exceeded' }])?.code).toBe(
      'rate_limited'
    );
    expect(errorFromGraphQL([{ message: 'User not found.' }])?.code).toBe(
      'not_found'
    );
    expect(
      errorFromGraphQL([
        { message: 'The following features cannot be null: x' },
      ])?.code
    ).toBe('schema_changed');
    expect(errorFromGraphQL([])).toBeNull();
  });
});

describe('transaction id', () => {
  it('extracts the keys of the page', () => {
    const html = `<html><head><meta name="twitter-site-verification" content="AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKiss"/></head>
      <svg id="loading-x-anim-1"><g><path d="a"/><path d="M 10,30 C 1 2 3"/></g></svg>
      <svg id="loading-x-anim-0"><g><path d="a"/><path d="M 10,30 C 4 5 6"/></g></svg>
      <script>e.u=e=>e+"."+({12:"ondemand.s",13:"bundle.UserProfile"}[e]||e)+"."+{12:"abcdef12",13:"0123abcd"}[e]+"a.js"</script>`;
    expect(extractVerificationKey(html)).toMatch(/^AAEC/);
    expect(extractAnimationPaths(html)).toEqual([
      'M 10,30 C 4 5 6',
      'M 10,30 C 1 2 3',
    ]);
    expect(parseChunkManifest(html).chunks).toEqual([
      {
        id: '12',
        name: 'ondemand.s',
        hash: 'abcdef12',
        url: 'https://abs.twimg.com/responsive-web/client-web/ondemand.s.abcdef12a.js',
      },
      {
        id: '13',
        name: 'bundle.UserProfile',
        hash: '0123abcd',
        url: 'https://abs.twimg.com/responsive-web/client-web/bundle.UserProfile.0123abcda.js',
      },
    ]);
    expect(
      extractKeyByteIndices('x=(t[5], 16);y=(n[12], 16),z=(r[30], 16)')
    ).toEqual({
      rowIndex: 5,
      keyByteIndices: [12, 30],
    });
  });

  // verbatim captures of x.com (2026-08-27) and the values XActions expects
  // from them (tests/http-scraper/transactionId.test.js)
  it('matches the reference values on captured x.com data', () => {
    const html = readFileSync(
      join(__dirname, '__fixtures__/x-home-transaction.html'),
      'utf8'
    );
    const chunk = readFileSync(
      join(__dirname, '__fixtures__/x-ondemand-s.txt'),
      'utf8'
    );
    const key = extractVerificationKey(html)!;
    expect(key).toBe(
      'FLlaTQODQdnjpY6SK8G8RDi46nFwe8pU4OelNyubw6ax0z0iRp2+ofQeeOH0mVQG'
    );
    const indices = extractKeyByteIndices(chunk)!;
    expect(indices).toEqual({ rowIndex: 30, keyByteIndices: [25, 0, 9] });
    expect(
      parseChunkManifest(html).chunks.find((p) => p.name === 'ondemand.s')?.url
    ).toBe(
      'https://abs.twimg.com/responsive-web/client-web/ondemand.s.07294c1654628fe8a.js'
    );
    expect(
      computeAnimationKey({
        keyBytes: Array.from(Buffer.from(key, 'base64')),
        ...indices,
        paths: extractAnimationPaths(html),
      })
    ).toBe(
      'fef78f0fd70a3d70a3d70266666666666660266666666666660fd70a3d70a3d700'
    );
  });

  it('is deterministic once time and mask are pinned', () => {
    const input = {
      key: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKiss',
      animationKey: 'ff00ff0000',
      method: 'get',
      path: 'https://x.com/i/api/graphql/abc/UserTweets?variables=%7B%7D',
      timeNow: 123456,
      randomByte: 7,
    };
    const first = generateTransactionId(input);
    expect(generateTransactionId(input)).toBe(first);
    expect(
      generateTransactionId({ ...input, path: '/i/api/graphql/abc/UserTweets' })
    ).toBe(first);
    // mask byte, 48 key bytes, 4 time bytes, 16 hash bytes, 1 constant
    const bytes = Buffer.from(first, 'base64');
    expect(bytes.length).toBe(1 + 45 + 4 + 16 + 1);
    expect(bytes[0]).toBe(7);
    expect(bytes[1] ^ 7).toBe(0);
    expect(normalizeSignedPath('/a/b?c=1#d')).toBe('/a/b');
    expect(floatToHex(0.5)).toBe('.8');
    expect(floatToHex(255)).toBe('FF');
  });
});

describe('query ids', () => {
  it('reads the operations of a bundle', () => {
    expect(
      extractOperations(
        'e.exports={queryId:"NEWID-1",operationName:"UserTweets",operationType:"query",metadata:{}}'
      )
    ).toEqual([{ queryId: 'NEWID-1', operationName: 'UserTweets' }]);
  });
});

describe('XFetcherClient (mocked x.com)', () => {
  beforeEach(() => {
    resetGuestToken();
    resetTransactionState();
    resetQueryIdState();
  });

  const client = (
    handler: (url: string, init: RequestInit) => Response | Promise<Response>,
    mode: 'guest' | 'cookies' = 'guest'
  ) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const instance = new XFetcherClient({
      mode,
      authToken: mode === 'cookies' ? 'secret-auth' : undefined,
      ct0: mode === 'cookies' ? 'secret-ct0' : undefined,
      fetch: guardedFetch({
        beforeXRequest: async () => {},
        fetchImpl: (async (url: string, init: RequestInit) => {
          calls.push({ url, init });
          return handler(url, init);
        }) as any,
        spacingMs: 0,
      }),
    });
    return { instance, calls };
  };

  // the transaction keys and query ids are not reachable in these tests
  const offline = (url: string) =>
    url.startsWith('https://x.com/home') || url.includes('githubusercontent');

  it('activates a guest token and pages a user timeline', async () => {
    let page = 0;
    const { instance, calls } = client((url) => {
      if (offline(url)) return json({}, 404);
      if (url.includes('guest/activate')) return json({ guest_token: '777' });
      if (url.includes('/UserByScreenName')) {
        return json({
          data: { user: { result: { __typename: 'User', rest_id: '42' } } },
        });
      }
      page++;
      const base = page * 100;
      return json(
        timeline([
          entry(tweetResult(String(base + 1), 'alice', 10)),
          entry(tweetResult(String(base + 2), 'alice', 20)),
          entry(tweetResult(String(base + 3), 'someone', 5)), // a repost of another account
          entry(
            tweetResult(String(base + 4), 'alice', 1, {
              legacy: { in_reply_to_status_id_str: '1' },
            })
          ),
          cursor(`C${page}`),
        ])
      );
    });

    const tweets = await instance.userTweets('alice', { limit: 100 });
    expect(page).toBe(MAX_PAGES);
    expect(tweets.every((p) => p.authorHandle === 'alice' && !p.isReply)).toBe(
      true
    );
    expect(tweets).toHaveLength(MAX_PAGES * 2);

    const graphql = calls.filter((p) => p.url.includes('/UserTweets'));
    const headers = graphql[0].init.headers as Record<string, string>;
    expect(headers['x-guest-token']).toBe('777');
    expect(headers.authorization).toMatch(/^Bearer AAAA/);
    expect(headers.cookie).toBeUndefined();
    expect(calls.filter((p) => p.url.includes('guest/activate'))).toHaveLength(
      1
    );
    const variables = JSON.parse(
      new URL(graphql[1].url).searchParams.get('variables')!
    );
    expect(variables).toMatchObject({ userId: '42', count: 20, cursor: 'C1' });
  });

  it('stops at the limit and when the cursor stops moving', async () => {
    let pages = 0;
    const { instance } = client((url) => {
      if (offline(url)) return json({}, 404);
      if (url.includes('guest/activate')) return json({ guest_token: '1' });
      pages++;
      return json({
        data: {
          search_by_raw_query: {
            search_timeline: {
              timeline: {
                instructions: [
                  {
                    type: 'TimelineAddEntries',
                    entries: [
                      entry(tweetResult(String(pages), 'zed', 1)),
                      cursor('SAME'),
                    ],
                  },
                ],
              },
            },
          },
        },
      });
    });
    expect(
      await instance.search('forex', { mode: 'top', limit: 1 })
    ).toHaveLength(1);
    expect(pages).toBe(1);
    pages = 0;
    await instance.search('forex', { mode: 'latest', limit: 50 });
    expect(pages).toBe(2);
  });

  it('sends the cookies of the spare account and maps a 403 to auth_failed', async () => {
    const { instance, calls } = client((url) => {
      if (offline(url)) return json({}, 404);
      return json({ errors: [{ message: 'Could not authenticate you' }] }, 403);
    }, 'cookies');
    await expect(instance.tweetById('5')).rejects.toMatchObject({
      code: 'auth_failed',
    });
    const headers = calls.find((p) => p.url.includes('TweetResultByRestId'))!
      .init.headers as Record<string, string>;
    expect(headers.cookie).toBe('auth_token=secret-auth; ct0=secret-ct0');
    expect(headers['x-csrf-token']).toBe('secret-ct0');
    expect(headers['x-guest-token']).toBeUndefined();
    expect(calls.some((p) => p.url.includes('guest/activate'))).toBe(false);
    expect(
      () => new XFetcherClient({ mode: 'cookies', fetch: (() => 0) as any })
    ).toThrow(XFetcherError);
  });

  it('maps rate limits, missing tweets and unknown answers', async () => {
    const answers: Response[] = [];
    const { instance } = client((url) => {
      if (offline(url)) return json({}, 404);
      if (url.includes('guest/activate')) return json({ guest_token: '1' });
      return answers.shift()!;
    });
    answers.push(json({}, 429));
    await expect(instance.tweetById('1')).rejects.toMatchObject({
      code: 'rate_limited',
    });
    answers.push(json({ data: { tweetResult: {} } }));
    await expect(instance.tweetById('1')).rejects.toMatchObject({
      code: 'not_found',
    });
    answers.push(
      json({ data: { user: { result: { __typename: 'UserUnavailable' } } } })
    );
    await expect(
      instance.userTweets('ghost', { limit: 5 })
    ).rejects.toMatchObject({
      code: 'not_found',
    });
    answers.push(json({ unexpected: true }));
    await expect(instance.tweetById('1')).rejects.toMatchObject({
      code: 'schema_changed',
    });
  });

  it('looks the query id up again once when x.com rejects it', async () => {
    const used: string[] = [];
    const { instance } = client((url) => {
      if (url.includes('githubusercontent')) return json({}, 404);
      if (url === 'https://x.com/home') {
        return new Response(
          '<script src="https://abs.twimg.com/responsive-web/client-web/main.abc123.js"></script>',
          { status: 200 }
        );
      }
      if (url.includes('main.abc123.js')) {
        return new Response(
          'a={queryId:"FRESH",operationName:"TweetResultByRestId",operationType:"query"}',
          { status: 200 }
        );
      }
      if (url.includes('guest/activate')) return json({ guest_token: '1' });
      const queryId = new URL(url).pathname.split('/')[4];
      used.push(queryId);
      if (queryId !== 'FRESH') return json({}, 404);
      return json({
        data: { tweetResult: { result: tweetResult('9', 'alice', 3) } },
      });
    });
    expect((await instance.tweetById('9')).id).toBe('9');
    expect(used).toEqual([OPERATIONS.TweetResultByRestId.queryId, 'FRESH']);
    expect(getQueryId('TweetResultByRestId')).toBe('FRESH');
  });
});
