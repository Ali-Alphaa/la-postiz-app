// Reads TikTok videos from the page the user is looking at: the For You /
// Following feed, a video page and a profile grid. Pure DOM reading: nothing
// here clicks, scrolls, navigates or calls TikTok.
//
// The data-e2e selectors are written from what tiktok.com used in 2026 and
// could not be checked against the live site from where this was built:
// each value has fallbacks and a video that can't be read is skipped.
import { parseCount } from '../x/tweet.parser';
import type { BBItem } from '../bb/types';

const HANDLE = /^[A-Za-z0-9._]{2,24}$/;
const VIDEO_PATH =
  /\/@([A-Za-z0-9._]{2,24})\/(video|photo)\/(\d{8,25})(?:[/?#]|$)/;

// one video: a feed item, the video page, a profile grid item
export const VIDEO_CONTAINERS = [
  '[data-e2e="recommend-list-item-container"]',
  '[data-e2e="feed-video"]',
  '[data-e2e="browse-video"]',
  '[data-e2e="user-post-item"]',
  '[data-e2e="user-liked-item"]',
  '[data-e2e="search_top-item"]',
];

const first = (root: ParentNode, selectors: string[]) => {
  for (const selector of selectors) {
    const element = root.querySelector(selector);
    if (element) {
      return element;
    }
  }
  return null;
};

const text = (element: Element | null) =>
  (element?.textContent || '').replace(/\s+/g, ' ').trim();

export const videoFrom = (href: string | null) => {
  const match = (href || '').match(VIDEO_PATH);
  return match ? { handle: match[1], kind: match[2], id: match[3] } : null;
};

// TikTok ids carry their creation time in their first 32 bits
export const postedAtFromId = (id: string) => {
  try {
    const seconds = Number(BigInt(id) >> BigInt(32));
    // between 2016 and 2100, else it is not a timestamp
    return seconds > 1451606400 && seconds < 4102444800
      ? new Date(seconds * 1000).toISOString()
      : null;
  } catch (err) {
    return null;
  }
};

// the handle signed in: the "Profile" link of the navigation, or the link of
// the avatar menu
export const getTikTokOwnHandle = (root: ParentNode): string | null => {
  const link = first(root, [
    'a[data-e2e="nav-profile"]',
    '[data-e2e="profile-icon"] a',
  ]) as HTMLAnchorElement | null;
  const fallback =
    link ||
    (root
      .querySelector('[data-e2e="profile-icon"]')
      ?.closest('a') as HTMLAnchorElement | null);
  const match = (fallback?.getAttribute('href') || '').match(
    /\/@([A-Za-z0-9._]{2,24})(?:[/?#]|$)/
  );
  return match ? match[1] : null;
};

const count = (root: ParentNode, selectors: string[]) =>
  parseCount(text(first(root, selectors)));

const isSponsored = (container: Element) =>
  !!container.querySelector('[data-e2e="ad-tag"], [data-e2e="video-ad-tag"]') ||
  Array.from(container.querySelectorAll('span, div, p')).some(
    (element) =>
      element.children.length === 0 && /^(sponsored|ad)$/i.test(text(element))
  );

export const parseTikTokVideo = (
  container: Element,
  ownHandle?: string | null,
  pageUrl?: string
): BBItem | null => {
  if (isSponsored(container)) {
    return null;
  }

  const link = Array.from(container.querySelectorAll('a[href]')).find((p) =>
    videoFrom(p.getAttribute('href'))
  );
  const video =
    videoFrom(link?.getAttribute('href') || null) || videoFrom(pageUrl || null);
  if (!video) {
    return null;
  }

  const authorHandle =
    text(
      first(container, [
        '[data-e2e="video-author-uniqueid"]',
        '[data-e2e="browse-username"]',
        '[data-e2e="feed-video-author-uniqueid"]',
      ])
    ).replace(/^@/, '') || video.handle;
  if (!HANDLE.test(authorHandle)) {
    return null;
  }

  const description = first(container, [
    '[data-e2e="video-desc"]',
    '[data-e2e="browse-video-desc"]',
    '[data-e2e="user-post-item-desc"]',
  ]);

  return {
    id: video.id,
    url: `https://www.tiktok.com/@${authorHandle}/${video.kind}/${video.id}`,
    authorHandle,
    authorName:
      text(
        first(container, [
          '[data-e2e="video-author-nickname"]',
          '[data-e2e="browser-nickname"]',
          '[data-e2e="browse-nickname"]',
        ])
      ) || null,
    text: (description?.textContent || '').trim(),
    likes: count(container, [
      '[data-e2e="like-count"]',
      '[data-e2e="browse-like-count"]',
    ]),
    comments: count(container, [
      '[data-e2e="comment-count"]',
      '[data-e2e="browse-comment-count"]',
    ]),
    shares: count(container, [
      '[data-e2e="share-count"]',
      '[data-e2e="browse-share-count"]',
    ]),
    views: count(container, [
      '[data-e2e="video-views"]',
      '[data-e2e="browse-video-views"]',
    ]),
    saves: count(container, [
      '[data-e2e="undefined-count"]',
      '[data-e2e="favorite-count"]',
      '[data-e2e="browse-favorite-count"]',
    ]),
    // photo posts are slideshows
    mediaType: video.kind === 'photo' ? 'carousel' : 'video',
    postedAt: postedAtFromId(video.id),
    own: !!ownHandle && authorHandle.toLowerCase() === ownHandle.toLowerCase(),
    manual: false,
  };
};

// the containers of the page that hold one video (the innermost ones)
export const findTikTokVideos = (root: ParentNode) => {
  const found = new Set<Element>();
  for (const selector of VIDEO_CONTAINERS) {
    root.querySelectorAll(selector).forEach((element) => found.add(element));
  }
  return [...found].filter(
    (element) =>
      ![...found].some((other) => other !== element && element.contains(other))
  );
};

// where the "Save to BrightBean" button goes: the column of the like button
// (none on profile grid items, too small)
export const tiktokActionBar = (container: Element) => {
  const like = first(container, [
    '[data-e2e="like-icon"]',
    '[data-e2e="browse-like-icon"]',
  ]);
  return (
    like?.closest('section, div[class*="ActionBar" i]') ||
    like?.closest('button')?.parentElement ||
    null
  );
};
