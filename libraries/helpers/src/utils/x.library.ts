// Rules of the X (Twitter) library. The browser extension sends the tweets the
// user scrolls past; a tweet is saved when it does much better than what its
// author usually gets. The author baseline is learned only from the tweets the
// user has seen, so it is kept small and per organization. Tweets can also be
// saved by hand (extension button or a pasted link).

export const VIRAL_MIN_LIKES = 50;
// how many OTHER tweets of the author must be known before judging a tweet
export const VIRAL_MIN_SAMPLES = 3;
export const VIRAL_RATIO = 3;
export const MAX_BASELINE_SAMPLES = 30;
export const MAX_PENDING = 10;
export const MAX_VOICE_SAMPLES = 200;

export interface XLikeSample {
  id: string;
  likes: number;
}

export interface XVoiceSample {
  id: string;
  text: string;
  likes: number;
  postedAt: string | null;
}

export type XViralVerdict =
  | { status: 'viral'; ratio: number }
  | { status: 'pending' }
  | { status: 'no' };

export const median = (values: number[]) => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

// the likes of a tweet that is already known are replaced (counts only grow
// while the user scrolls), new tweets are appended and the oldest are dropped
export const mergeLikeSamples = (
  samples: XLikeSample[],
  incoming: XLikeSample[],
  max = MAX_BASELINE_SAMPLES
) => {
  const list = samples.map((p) => ({ id: p.id, likes: p.likes }));
  for (const tweet of incoming) {
    const existing = list.find((p) => p.id === tweet.id);
    if (existing) {
      existing.likes = tweet.likes;
      continue;
    }
    list.push({ id: tweet.id, likes: tweet.likes });
  }
  return list.slice(-max);
};

// viral: at least VIRAL_MIN_LIKES and VIRAL_RATIO x the median likes of the
// other known tweets of the author. Without enough other tweets a tweet that
// is big enough waits ("pending") until the baseline grows.
export const viralVerdict = (
  tweet: XLikeSample,
  samples: XLikeSample[]
): XViralVerdict => {
  if (tweet.likes < VIRAL_MIN_LIKES) {
    return { status: 'no' };
  }

  const others = samples.filter((p) => p.id !== tweet.id).map((p) => p.likes);
  if (others.length < VIRAL_MIN_SAMPLES) {
    return { status: 'pending' };
  }

  const usual = median(others);
  if (tweet.likes < VIRAL_RATIO * usual) {
    return { status: 'no' };
  }

  return {
    status: 'viral',
    ratio: Math.round((tweet.likes / Math.max(usual, 1)) * 100) / 100,
  };
};

// One author: merge the new tweets into the baseline, then judge the new
// tweets together with the ones that were waiting for a bigger baseline
export const evaluateAuthor = <T extends XLikeSample>(
  baseline: { samples: XLikeSample[]; pending: T[] },
  incoming: T[]
) => {
  const samples = mergeLikeSamples(baseline.samples, incoming);

  const candidates = new Map<string, T>();
  for (const tweet of baseline.pending) {
    candidates.set(tweet.id, tweet);
  }
  // the latest counts win
  for (const tweet of incoming) {
    candidates.set(tweet.id, tweet);
  }

  const viral: Array<{ tweet: T; ratio: number }> = [];
  const pending: T[] = [];
  for (const tweet of candidates.values()) {
    const verdict = viralVerdict(tweet, samples);
    if (verdict.status === 'viral') {
      viral.push({ tweet, ratio: verdict.ratio });
    } else if (verdict.status === 'pending') {
      pending.push(tweet);
    }
  }

  return {
    samples,
    // the most liked ones are the most likely to become viral
    pending: pending.sort((a, b) => b.likes - a.likes).slice(0, MAX_PENDING),
    viral,
  };
};

// The tweets of the user feed the voice profile: the best performing ones and
// the most recent ones are kept
export const mergeVoiceSamples = (
  samples: XVoiceSample[],
  incoming: XVoiceSample[],
  max = MAX_VOICE_SAMPLES
) => {
  const byId = new Map<string, XVoiceSample>();
  for (const sample of [...samples, ...incoming]) {
    byId.set(sample.id, { ...byId.get(sample.id), ...sample });
  }

  const all = [...byId.values()];
  if (all.length <= max) {
    return all;
  }

  const time = (p: XVoiceSample) => (p.postedAt ? Date.parse(p.postedAt) : 0);
  const keep = new Set<string>();
  for (const sample of [...all]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, Math.ceil(max / 2))) {
    keep.add(sample.id);
  }
  for (const sample of [...all].sort((a, b) => time(b) - time(a))) {
    if (keep.size >= max) {
      break;
    }
    keep.add(sample.id);
  }

  return all.filter((p) => keep.has(p.id));
};

// the samples used to write the style guide: best performing first
export const bestVoiceSamples = (samples: XVoiceSample[], count = 40) =>
  [...samples]
    .filter((p) => p.text.trim().length > 0)
    .sort((a, b) => b.likes - a.likes)
    .slice(0, count);

// likes / median likes of the other known tweets of the author, 0 while the
// author is not known well enough (used for the tweets saved by hand)
export const likesRatio = (tweet: XLikeSample, samples: XLikeSample[]) => {
  const others = samples.filter((p) => p.id !== tweet.id).map((p) => p.likes);
  if (others.length < VIRAL_MIN_SAMPLES) {
    return 0;
  }
  return Math.round((tweet.likes / Math.max(median(others), 1)) * 100) / 100;
};

const TWEET_HOSTS = [
  'x.com',
  'www.x.com',
  'mobile.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
];

// A link to a tweet pasted by the user. Only the handle and the id are kept,
// the link that is used later is rebuilt from them (never fetched as is).
export const parseTweetUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch (err) {
    return null;
  }

  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    !TWEET_HOSTS.includes(url.hostname.toLowerCase())
  ) {
    return null;
  }

  const match =
    url.pathname.match(
      /^\/([A-Za-z0-9_]{1,15})\/status(?:es)?\/(\d{1,30})(?:\/.*)?$/
    ) || url.pathname.match(/^\/i\/(?:web\/)?status\/(\d{1,30})(?:\/.*)?$/);
  if (!match) {
    return null;
  }

  const [handle, id] = match.length === 3 ? [match[1], match[2]] : [null, match[1]];
  if (handle && ['i', 'home', 'search', 'explore'].includes(handle.toLowerCase())) {
    return null;
  }

  return {
    id,
    handle,
    url: `https://x.com/${handle || 'i/web'}/status/${id}`,
  };
};

const decodeEntities = (value: string) =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&');

// The html of the oEmbed answer of publish.twitter.com:
// <blockquote><p>text<br>text <a>pic.twitter.com/x</a></p>&mdash; Name
// (@handle) <a href="...">October 27, 2026</a></blockquote>
export const oembedHtmlToTweet = (html: string) => {
  const paragraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '';
  const raw = decodeEntities(
    paragraph.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  );
  const hasMedia = /pic\.(twitter|x)\.com\/\w+/i.test(raw);
  const text = raw
    .replace(/\s*pic\.(twitter|x)\.com\/\w+/gi, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  const links = [...html.matchAll(/<a[^>]*>([^<]*)<\/a>/gi)];
  const date = links.length ? Date.parse(links[links.length - 1][1]) : NaN;

  return {
    text,
    mediaType: hasMedia ? ('photo' as const) : ('none' as const),
    postedAt: Number.isNaN(date) ? null : new Date(date).toISOString(),
  };
};

// The repurpose answer of the model: exactly `count` non empty variations, or
// null to ask again. A post over the X limit is kept: the user edits it.
export const normalizeVariations = (variations: string[][], count = 5) => {
  const list = (variations || [])
    .map((posts) => (posts || []).map((p) => (p || '').trim()).filter((p) => p))
    .filter((posts) => posts.length);

  return list.length >= count ? list.slice(0, count) : null;
};
