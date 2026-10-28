/// <reference types="jest" />
import { JSDOM } from 'jsdom';
import { getOwnHandle, parseCount, parseTweet } from './tweet.parser';
import { CaptureQueue, FLUSH_EVERY, FIRST_FLUSH_DELAY } from './capture.queue';

// jsdom of the repository (jest-environment-jsdom needs the native canvas)
const { document } = new JSDOM('<!doctype html><body></body>').window;

// Simplified copies of the markup of x.com (2026): only the attributes the
// parser relies on are kept
const actions = (
  replies: string,
  reposts: string,
  likes: string,
  views?: string
) => `
  <div role="group" aria-label="${replies} replies, ${reposts} reposts, ${likes} likes">
    <button data-testid="reply" aria-label="${replies} Replies. Reply"><span>${replies}</span></button>
    <button data-testid="retweet" aria-label="${reposts} reposts. Repost"><span>${reposts}</span></button>
    <button data-testid="like" aria-label="${likes} Likes. Like"><span>${likes}</span></button>
    ${
      views
        ? `<a href="/alice/status/1850000000000000001/analytics" aria-label="${views} views. View post analytics"><span>${views}</span></a>`
        : ''
    }
  </div>`;

const userName = (
  name: string,
  handle: string,
  id: string,
  datetime: string
) => `
  <div data-testid="User-Name">
    <div><a href="/${handle}" role="link"><div><span><span>${name}</span></span></div></a></div>
    <div>
      <a href="/${handle}" tabindex="-1"><span>@${handle}</span></a>
      <span>·</span>
      <a href="/${handle}/status/${id}" role="link"><time datetime="${datetime}">Oct 27</time></a>
    </div>
  </div>`;

const article = (inner: string) => {
  document.body.innerHTML = `<article data-testid="tweet" role="article">${inner}</article>`;
  return document.querySelector('article')!;
};

describe('parseCount', () => {
  it.each([
    ['1,234 Likes. Like', 1234],
    ['1.234 Gefällt mir', 1234],
    ['1 234 J’aime', 1234],
    ['1.2K', 1200],
    ['3M', 3000000],
    ['1,2 k', 1200],
    ['2,5 Mio.', 2500000],
    ['1,2 mil Me gusta', 1200],
    ['1234 Me gusta', 1234],
    ['1.5万', 15000],
    ['١٢٣ إعجاب', 123],
    ['Like', null],
    ['', null],
  ])('%s', (raw, expected) => {
    expect(parseCount(raw)).toBe(expected);
  });
});

describe('parseTweet', () => {
  it('reads a regular tweet', () => {
    const tweet = parseTweet(
      article(`
        ${userName(
          'Alice Trader',
          'alice',
          '1850000000000000001',
          '2026-10-27T10:00:00.000Z'
        )}
        <div data-testid="tweetText" lang="en"><span>Cut losers fast.</span><br><span>Let winners run </span><img alt="📈" src="x.svg"></div>
        <div data-testid="tweetPhoto"><img src="p.jpg"></div>
        ${actions('12', '1.2K', '4,567', '89,012')}
      `),
      'bob'
    );

    expect(tweet).toEqual({
      id: '1850000000000000001',
      url: 'https://x.com/alice/status/1850000000000000001',
      authorHandle: 'alice',
      authorName: 'Alice Trader',
      text: 'Cut losers fast.\nLet winners run 📈',
      postedAt: '2026-10-27T10:00:00.000Z',
      likes: 4567,
      reposts: 1200,
      replies: 12,
      views: 89012,
      mediaType: 'photo',
      isReply: false,
      isRepost: false,
      isQuote: false,
      own: false,
    });
  });

  it('marks the tweets of the logged in user', () => {
    const tweet = parseTweet(
      article(`
        ${userName('Bob', 'Bob', '1', '2026-10-27T10:00:00.000Z')}
        <div data-testid="tweetText"><span>mine</span></div>
        ${actions('0', '0', '0')}
      `),
      'bob'
    );
    expect(tweet?.own).toBe(true);
    expect(tweet?.views).toBeNull();
    expect(tweet?.likes).toBe(0);
  });

  it('captures the original tweet of a repost', () => {
    const tweet = parseTweet(
      article(`
        <div data-testid="socialContext"><span>Carol reposted</span></div>
        ${userName('Alice', 'alice', '42', '2026-10-27T10:00:00.000Z')}
        <div data-testid="tweetText"><span>original</span></div>
        <div data-testid="videoPlayer"><video></video></div>
        ${actions('1', '2', '300')}
      `)
    );
    expect(tweet).toMatchObject({
      id: '42',
      authorHandle: 'alice',
      text: 'original',
      isRepost: true,
      mediaType: 'video',
      likes: 300,
    });
  });

  it('keeps the quoted tweet out of a quote', () => {
    const tweet = parseTweet(
      article(`
        ${userName('Alice', 'alice', '100', '2026-10-27T10:00:00.000Z')}
        <div data-testid="tweetText"><span>my take</span></div>
        <div role="link" tabindex="0">
          <div data-testid="User-Name">
            <div><span>Dave</span></div>
            <div><span>@dave</span><time datetime="2026-10-20T10:00:00.000Z">Oct 20</time></div>
          </div>
          <div data-testid="tweetText"><span>quoted text</span></div>
          <div data-testid="tweetPhoto"><img src="q.jpg"></div>
        </div>
        ${actions('1', '2', '3')}
      `)
    );
    expect(tweet).toMatchObject({
      id: '100',
      authorHandle: 'alice',
      text: 'my take',
      isQuote: true,
      mediaType: 'none',
    });
  });

  it('detects replies', () => {
    const tweet = parseTweet(
      article(`
        ${userName('Alice', 'alice', '7', '2026-10-27T10:00:00.000Z')}
        <div dir="ltr">Replying to <div><a href="/bob">@bob</a></div></div>
        <div data-testid="tweetText"><span>agreed</span></div>
        ${actions('0', '0', '1')}
      `)
    );
    expect(tweet?.isReply).toBe(true);
  });

  it('skips promoted tweets and tweets without permalink', () => {
    expect(
      parseTweet(
        article(`
          ${userName('Brand', 'brand', '9', '2026-10-27T10:00:00.000Z')}
          <div data-testid="tweetText"><span>buy</span></div>
          <div><span>Ad</span></div>
          ${actions('0', '0', '1')}
        `)
      )
    ).toBeNull();
    expect(
      parseTweet(
        article(`
          <div data-testid="tweetText"><span>no link</span></div>
          ${actions('0', '0', '1')}
        `)
      )
    ).toBeNull();
  });
});

describe('getOwnHandle', () => {
  it('reads the profile link of the navigation', () => {
    document.body.innerHTML =
      '<nav><a data-testid="AppTabBar_Profile_Link" href="/Sigma_Trader">Profile</a></nav>';
    expect(getOwnHandle(document)).toBe('Sigma_Trader');
    document.body.innerHTML = '<nav></nav>';
    expect(getOwnHandle(document)).toBeNull();
  });
});

describe('CaptureQueue', () => {
  const tweet = (id: string, likes: number) => ({
    id,
    url: '',
    authorHandle: 'a',
    authorName: null,
    text: 'x'.repeat(5000),
    postedAt: null,
    likes,
    reposts: 0,
    replies: 0,
    views: null,
    mediaType: 'none' as const,
    isReply: false,
    isRepost: false,
    isQuote: false,
    own: false,
  });

  it('dedupes sent tweets unless their likes grew by 20%', () => {
    const queue = new CaptureQueue();
    expect(queue.add(tweet('1', 100))).toBe(true);
    expect(queue.take(0).map((p) => p.id)).toEqual(['1']);
    expect(queue.add(tweet('1', 119))).toBe(false);
    expect(queue.add(tweet('1', 120))).toBe(true);
    expect(queue.take(1).map((p) => p.likes)).toEqual([120]);
  });

  it('cuts long texts and splits big batches', () => {
    const queue = new CaptureQueue();
    for (let index = 0; index < 30; index++) {
      queue.add(tweet(String(index), 1));
    }
    const first = queue.take(0);
    expect(first[0].text).toHaveLength(4000);
    expect(JSON.stringify(first).length).toBeLessThan(100_000);
    expect(first.length + queue.size).toBe(30);
    expect(queue.size).toBeGreaterThan(0);
  });

  it('waits ~10s between batches', () => {
    const queue = new CaptureQueue();
    expect(queue.delay(0)).toBe(FLUSH_EVERY);
    queue.take(50_000);
    expect(queue.delay(51_000)).toBe(FLUSH_EVERY - 1_000);
    expect(queue.delay(100_000)).toBe(FIRST_FLUSH_DELAY);
  });
});
