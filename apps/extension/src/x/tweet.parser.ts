// Reads a tweet from the x.com page the user is looking at. Pure DOM reading:
// nothing here clicks, scrolls, navigates or calls X.

export type MediaType = 'photo' | 'video' | 'none';

export interface ParsedTweet {
  id: string;
  url: string;
  authorHandle: string;
  authorName: string | null;
  text: string;
  postedAt: string | null;
  likes: number;
  reposts: number;
  replies: number;
  views: number | null;
  mediaType: MediaType;
  isReply: boolean;
  isRepost: boolean;
  isQuote: boolean;
  own: boolean;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;
const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,30})(?:[/?#]|$)/;

// digits of other scripts (Arabic-Indic, Persian, Devanagari, Bengali,
// full width) to ASCII
const DIGIT_BLOCKS = [0x0660, 0x06f0, 0x0966, 0x09e6, 0xff10];
const normalizeDigits = (value: string) =>
  value.replace(/[٠-٩۰-۹०-९০-৯０-９]/g, (char) => {
    const code = char.charCodeAt(0);
    const block = DIGIT_BLOCKS.find((start) => code >= start && code <= start + 9)!;
    return String(code - block);
  });

// abbreviations X uses for big counts, in the languages it supports
const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  tsd: 1e3,
  mil: 1e3,
  '千': 1e3,
  '万': 1e4,
  m: 1e6,
  mio: 1e6,
  mn: 1e6,
  mln: 1e6,
  '億': 1e8,
  b: 1e9,
  md: 1e9,
  mrd: 1e9,
  bn: 1e9,
};

// "1,234", "1.2K", "3M", "1,2 k", "١٢٣" -> number. Returns null without digits
export const parseCount = (raw: string | null | undefined): number | null => {
  if (!raw) {
    return null;
  }
  const value = normalizeDigits(raw).replace(/[  ]/g, ' ');
  const match = value.match(/(\d[\d.,' ]*)\s*([^\d\s.,]*)/);
  if (!match) {
    return null;
  }

  const number = match[1].trim();
  const suffix = match[2] || '';
  const multiplier = MULTIPLIERS[suffix.toLowerCase()];

  if (multiplier) {
    // with a suffix the separator is a decimal one: 1.2K, 1,2 k
    const decimal = parseFloat(number.replace(/[ ']/g, '').replace(',', '.'));
    return Number.isNaN(decimal) ? null : Math.round(decimal * multiplier);
  }

  // a full number: every separator is a thousands separator
  const integer = parseInt(number.replace(/[.,' ]/g, ''), 10);
  return Number.isNaN(integer) ? null : integer;
};

// the text of a tweet with its line breaks and emojis (images with alt)
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const readText = (node: Node): string => {
  if (node.nodeType === TEXT_NODE) {
    return node.textContent || '';
  }
  if (node.nodeType !== ELEMENT_NODE) {
    return '';
  }
  const element = node as Element;
  if (element.tagName === 'BR') {
    return '\n';
  }
  if (element.tagName === 'IMG') {
    return element.getAttribute('alt') || '';
  }
  return Array.from(element.childNodes).map(readText).join('');
};

const countOf = (element: Element | null) => {
  if (!element) {
    return null;
  }
  return (
    parseCount(element.getAttribute('aria-label')) ??
    parseCount(element.textContent)
  );
};

export const getOwnHandle = (root: ParentNode): string | null => {
  const href = root
    .querySelector('a[data-testid="AppTabBar_Profile_Link"]')
    ?.getAttribute('href');
  const handle = href?.replace(/^\//, '').split(/[/?#]/)[0];
  return handle && HANDLE.test(handle) ? handle : null;
};

const isPromoted = (article: Element) =>
  !!article.querySelector('[data-testid="placementTracking"]') ||
  Array.from(article.querySelectorAll('span')).some((span) =>
    /^(Ad|Promoted|Sponsored)$/.test((span.textContent || '').trim())
  );

export const parseTweet = (
  article: Element,
  ownHandle?: string | null
): ParsedTweet | null => {
  if (isPromoted(article)) {
    return null;
  }

  // the quoted tweet is a nested card with its own author and time: only the
  // elements outside of it belong to this tweet
  const quote = article
    .querySelector('div[role="link"] [data-testid="User-Name"]')
    ?.closest('div[role="link"]');
  const own = <T extends Element>(selector: string) =>
    (Array.from(article.querySelectorAll<T>(selector)).find(
      (element) => !quote || !quote.contains(element)
    ) || null) as T | null;

  // the permalink of the tweet is the link around its time
  const time = Array.from(article.querySelectorAll('time')).find(
    (element) =>
      (!quote || !quote.contains(element)) &&
      element.closest('a[href*="/status/"]')
  );
  const link = time?.closest('a[href*="/status/"]');
  const path = link?.getAttribute('href') || '';
  const status = (path.startsWith('http') ? new URL(path).pathname : path).match(
    STATUS_PATH
  );
  if (!time || !status) {
    return null;
  }

  const [, permalinkHandle, id] = status;
  const userName = own('[data-testid="User-Name"]');
  const handle =
    Array.from(userName?.querySelectorAll('span') || [])
      .map((span) => (span.textContent || '').trim())
      .find((text) => /^@[A-Za-z0-9_]{1,15}$/.test(text))
      ?.slice(1) || permalinkHandle;
  const authorName =
    (userName?.querySelector('a span')?.textContent || '').trim() || null;

  const textElement = own('[data-testid="tweetText"]');
  const text = textElement ? readText(textElement).trim() : '';

  const hasVideo = !!own('[data-testid="videoPlayer"], [data-testid="videoComponent"], video');
  const hasPhoto = !!own('[data-testid="tweetPhoto"]');

  const socialContext = (
    article.querySelector('[data-testid="socialContext"]')?.textContent || ''
  ).toLowerCase();

  const views = countOf(own('a[href*="/analytics"]'));

  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    authorHandle: handle,
    authorName,
    text,
    postedAt: time.getAttribute('datetime'),
    likes: countOf(own('[data-testid="like"], [data-testid="unlike"]')) ?? 0,
    reposts:
      countOf(own('[data-testid="retweet"], [data-testid="unretweet"]')) ?? 0,
    replies: countOf(own('[data-testid="reply"]')) ?? 0,
    views,
    mediaType: hasVideo ? 'video' : hasPhoto ? 'photo' : 'none',
    isReply: Array.from(article.querySelectorAll('div')).some(
      (div) =>
        (!quote || !quote.contains(div)) &&
        /^Replying to/.test((div.textContent || '').trim()) &&
        div.children.length <= 3
    ),
    isRepost: /repost|retweet/.test(socialContext),
    isQuote: !!quote,
    own:
      !!ownHandle && handle.toLowerCase() === ownHandle.toLowerCase(),
  };
};
