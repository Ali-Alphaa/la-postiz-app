// Reads Instagram posts and reels from the page the user is looking at.
// Pure DOM reading: nothing here clicks, scrolls, navigates or calls
// Instagram.
//
// The selectors are written from what instagram.com used in 2026 and could
// not be checked against the live site from where this was built: each value
// has fallbacks and a post that can't be read is skipped, never guessed.
import { parseCount } from '../x/tweet.parser';
import type { BBItem, BBMediaType } from '../bb/types';

const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const POST_PATH =
  /\/(?:[A-Za-z0-9._]{1,30}\/)?(p|reels?)\/([A-Za-z0-9_-]{5,40})(?:[/?#]|$)/;
// paths of the app that look like a handle but are not one
const NOT_HANDLES = new Set([
  'explore',
  'reels',
  'reel',
  'p',
  'direct',
  'accounts',
  'stories',
  'about',
  'legal',
]);

// containers of one post: feed articles, the post page and the post modal
export const POST_CONTAINERS = [
  'article',
  'div[role="dialog"] article',
  'main[role="main"] div[role="presentation"]',
];

const handleFromHref = (href: string | null) => {
  const path = (href || '').replace(/^https?:\/\/(www\.)?instagram\.com/, '');
  const match = path.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
  return match && !NOT_HANDLES.has(match[1].toLowerCase()) ? match[1] : null;
};

export const shortcodeFrom = (href: string | null) => {
  const match = (href || '').match(POST_PATH);
  return match ? { kind: match[1], code: match[2] } : null;
};

// the handle signed in: the "Profile" link of the navigation, or the link
// around the user's own avatar ("<handle>'s profile picture")
export const getInstagramOwnHandle = (root: ParentNode): string | null => {
  const links = Array.from(
    root.querySelectorAll<HTMLAnchorElement>(
      'nav a[href], div[role="navigation"] a[href], a[role="link"][href]'
    )
  );
  for (const link of links) {
    const handle = handleFromHref(link.getAttribute('href'));
    if (!handle) {
      continue;
    }
    if (/^\s*profile\s*$/i.test(link.textContent || '')) {
      return handle;
    }
    const alt = link.querySelector('img')?.getAttribute('alt') || '';
    const own = alt.match(/^(.+?)'s profile picture$/i)?.[1];
    if (
      own &&
      own.toLowerCase() === handle.toLowerCase() &&
      /profile/i.test(
        link.textContent || link.getAttribute('aria-label') || 'profile'
      )
    ) {
      return handle;
    }
  }
  return null;
};

const text = (element: Element | null | undefined) =>
  (element?.textContent || '').replace(/\s+/g, ' ').trim();

// "1,234 likes", "Liked by bob and 1,234 others", "1.2M views"
const countFrom = (container: Element, pattern: RegExp) => {
  for (const element of Array.from(
    container.querySelectorAll('a, span, section, div')
  )) {
    // the smallest element that holds the words
    if (element.children.length > 3) {
      continue;
    }
    const match = text(element).match(pattern);
    if (match) {
      return parseCount(match[1]);
    }
  }
  return null;
};

// ads ("Sponsored"); a "Paid partnership" is a creator's own post and kept
const isSponsored = (container: Element) =>
  Array.from(container.querySelectorAll('span, a, div')).some(
    (element) =>
      element.children.length === 0 && /^(sponsored|ad)$/i.test(text(element))
  );

const mediaTypeOf = (container: Element, kind: string): BBMediaType => {
  if (
    container.querySelector(
      'button[aria-label="Next"], button[aria-label="Go back"], [aria-label*="Carousel" i]'
    ) ||
    container.querySelectorAll('ul li img').length > 1
  ) {
    return 'carousel';
  }
  if (container.querySelector('video') || kind.startsWith('reel')) {
    return 'video';
  }
  return 'image';
};

// the caption: the h1 of the post page, else the first comment of the
// author, else the longest text of the post
const captionOf = (container: Element, handle: string) => {
  const h1 = container.querySelector('h1');
  if (text(h1)) {
    return (h1!.textContent || '').trim();
  }

  // the caption starts with the author's name: the last link to the author
  const authorLink = Array.from(container.querySelectorAll('a[href]'))
    .filter(
      (link, index) =>
        index > 0 &&
        handleFromHref(link.getAttribute('href'))?.toLowerCase() ===
          handle.toLowerCase()
    )
    .pop();
  const next = Array.from(
    authorLink?.closest('li, div')?.querySelectorAll('span[dir="auto"]') || []
  ).find((p) => !p.querySelector('a') && text(p) !== handle);
  if (next && text(next) && text(next) !== handle) {
    return (next.textContent || '').trim();
  }

  const spans = Array.from(container.querySelectorAll('span[dir="auto"], span'))
    .map((p) => (p.textContent || '').trim())
    .filter(
      (p) =>
        p.length > 20 &&
        !/^\d[\d.,KMkm]*\s+(likes?|comments?|views?)$/i.test(p) &&
        !/^(view all|liked by)/i.test(p)
    )
    .sort((a, b) => b.length - a.length);
  return spans[0] || '';
};

export const parseInstagramPost = (
  container: Element,
  ownHandle?: string | null,
  pageUrl?: string
): BBItem | null => {
  if (isSponsored(container)) {
    return null;
  }

  // the permalink of the post: a link around its time, any post link, or the
  // address of the page for the post page and the modal
  const timeLink = container.querySelector('time')?.closest('a[href]');
  const postLink =
    timeLink ||
    Array.from(container.querySelectorAll('a[href]')).find((p) =>
      shortcodeFrom(p.getAttribute('href'))
    );
  const shortcode =
    shortcodeFrom(postLink?.getAttribute('href') || null) ||
    shortcodeFrom(pageUrl || null);
  if (!shortcode) {
    return null;
  }

  // the author: the first profile link of the header
  const authorHandle =
    Array.from(container.querySelectorAll('header a[href], a[href]'))
      .map((p) => handleFromHref(p.getAttribute('href')))
      .find((p) => !!p) || null;
  if (!authorHandle || !HANDLE.test(authorHandle)) {
    return null;
  }

  const likes =
    countFrom(container, /^(\d[\d.,\s]*[KMkm]?)\s+likes?$/i) ??
    (() => {
      const others = countFrom(
        container,
        /liked by .+ and (\d[\d.,\s]*[KMkm]?) others?/i
      );
      return others === null ? null : others + 1;
    })();
  const comments = countFrom(
    container,
    /^view (?:all )?(\d[\d.,\s]*[KMkm]?) comments?$/i
  );
  const views = countFrom(
    container,
    /^(\d[\d.,\s]*[KMkm]?)\s+(?:views|plays)$/i
  );

  const kind = shortcode.kind === 'p' ? 'p' : 'reel';
  return {
    id: shortcode.code,
    url: `https://www.instagram.com/${kind}/${shortcode.code}/`,
    authorHandle,
    authorName: null,
    text: captionOf(container, authorHandle),
    likes,
    comments,
    shares: null,
    views,
    saves: null,
    mediaType: mediaTypeOf(container, kind),
    postedAt: container.querySelector('time')?.getAttribute('datetime') || null,
    own: !!ownHandle && authorHandle.toLowerCase() === ownHandle.toLowerCase(),
    manual: false,
  };
};

// the containers of the page that hold a post (the innermost ones)
export const findInstagramPosts = (root: ParentNode) => {
  const found = new Set<Element>();
  for (const selector of POST_CONTAINERS) {
    root.querySelectorAll(selector).forEach((element) => found.add(element));
  }
  return [...found].filter(
    (element) =>
      ![...found].some((other) => other !== element && element.contains(other))
  );
};

// where the "Save to BrightBean" button goes: the bar of the like button
export const instagramActionBar = (container: Element) =>
  container
    .querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]')
    ?.closest('section') ||
  container
    .querySelector('svg[aria-label="Like"], svg[aria-label="Unlike"]')
    ?.closest('div[role="button"], button')?.parentElement ||
  null;
