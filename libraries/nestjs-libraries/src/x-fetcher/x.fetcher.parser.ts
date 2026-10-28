// Portions adapted from XActions (https://github.com/nirholas/XActions),
// Copyright (c) 2024-2026 nich (@nichxbt), Licensed under the Apache License,
// Version 2.0 (src/scrapers/twitter/http/parse/tweet.js, paging.js and
// search.js buildAdvancedQuery).
// Modifications: ported to TypeScript; the output is the tweet shape of the
// Postiz X library (the one the browser extension sends) instead of the
// XActions tweet object; long posts read their full text from note_tweet;
// a repost is replaced by the original tweet; the search query builder keeps
// only keywords and min_faves, and inputs are validated.

export type XMediaType = 'photo' | 'video' | 'none';

export interface XFetchedTweet {
  id: string;
  url: string;
  authorHandle: string;
  authorName: string | null;
  text: string;
  likes: number;
  reposts: number;
  replies: number;
  views: number | null;
  mediaType: XMediaType;
  postedAt: string | null;
  isReply: boolean;
  isRepost: boolean;
  isQuote: boolean;
}

const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

const toIsoDate = (raw?: string) => {
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const toNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// one result of tweet_results.result
export const parseTweetData = (
  raw: any,
  repostedBy = false
): XFetchedTweet | null => {
  if (!raw || raw.__typename === 'TweetTombstone') {
    return null;
  }

  // TweetWithVisibilityResults wraps the real tweet one level deeper
  const tweet =
    raw.__typename === 'TweetWithVisibilityResults' ? raw.tweet : raw;
  if (!tweet) {
    return null;
  }
  const legacy = tweet.legacy || {};

  // a repost: the original tweet is the interesting one
  const reposted = legacy.retweeted_status_result?.result;
  if (reposted) {
    const original = parseTweetData(reposted, true);
    if (original) {
      return original;
    }
  }

  const user = tweet.core?.user_results?.result || {};
  const handle: string =
    user.core?.screen_name ?? user.legacy?.screen_name ?? '';
  const id: string = tweet.rest_id || legacy.id_str || '';
  if (!/^\d{1,30}$/.test(id) || !HANDLE.test(handle)) {
    return null;
  }

  const media: any[] = legacy.extended_entities?.media || [];
  const views = tweet.views?.count ?? tweet.ext_views?.count;

  return {
    id,
    url: `https://x.com/${handle}/status/${id}`,
    authorHandle: handle,
    authorName: (user.core?.name ?? user.legacy?.name ?? null) || null,
    // posts longer than 280 characters carry their full text in note_tweet
    text: (
      tweet.note_tweet?.note_tweet_results?.result?.text ??
      legacy.full_text ??
      ''
    ).trim(),
    likes: toNumber(legacy.favorite_count) ?? 0,
    reposts: toNumber(legacy.retweet_count) ?? 0,
    replies: toNumber(legacy.reply_count) ?? 0,
    views: views === undefined || views === null ? null : toNumber(views),
    mediaType: media.some(
      (p) => p.type === 'video' || p.type === 'animated_gif'
    )
      ? 'video'
      : media.length
      ? 'photo'
      : 'none',
    postedAt: toIsoDate(legacy.created_at),
    isReply: !!legacy.in_reply_to_status_id_str,
    isRepost: repostedBy,
    isQuote: !!tweet.quoted_status_result?.result || !!legacy.is_quote_status,
  };
};

// the instructions of a user timeline, wherever x.com puts them this week
export const userTimelineInstructions = (data: any): any[] => {
  const result = data?.user?.result;
  return (
    result?.timeline?.timeline?.instructions ??
    result?.timeline_v2?.timeline?.instructions ??
    result?.timeline?.instructions ??
    []
  );
};

export const searchInstructions = (data: any): any[] =>
  data?.search_by_raw_query?.search_timeline?.timeline?.instructions ?? [];

// the tweets and the bottom cursor of one timeline page
export const parseTimelineInstructions = (instructions: any[]) => {
  const tweets: XFetchedTweet[] = [];
  let cursor: string | null = null;

  const add = (result: any) => {
    const tweet = parseTweetData(result);
    if (tweet && !tweets.some((p) => p.id === tweet.id)) {
      tweets.push(tweet);
    }
  };

  for (const instruction of Array.isArray(instructions) ? instructions : []) {
    const type = instruction?.type;

    if (type === 'TimelineAddEntries') {
      for (const entry of instruction.entries || []) {
        const entryId: string = entry?.entryId || '';
        if (entryId.startsWith('cursor-bottom-')) {
          cursor =
            entry.content?.value ?? entry.content?.itemContent?.value ?? null;
          continue;
        }
        if (entryId.startsWith('cursor-top-')) {
          continue;
        }
        // promoted tweets are not content
        if (entryId.startsWith('promoted-')) {
          continue;
        }
        const result = entry.content?.itemContent?.tweet_results?.result;
        if (result) {
          add(result);
        }
        // conversation modules (replies timeline)
        for (const item of entry.content?.items || []) {
          const moduleResult = item?.item?.itemContent?.tweet_results?.result;
          if (moduleResult) {
            add(moduleResult);
          }
        }
      }
    }

    if (type === 'TimelineAddToModule') {
      for (const item of instruction.moduleItems || []) {
        const result = item?.item?.itemContent?.tweet_results?.result;
        if (result) {
          add(result);
        }
      }
    }

    if (type === 'TimelinePinEntry') {
      const result =
        instruction.entry?.content?.itemContent?.tweet_results?.result;
      if (result) {
        add(result);
      }
    }

    // some pages put the bottom cursor in a replace instruction
    if (type === 'TimelineReplaceEntry') {
      const entry = instruction.entry;
      if ((entry?.entryId || '').startsWith('cursor-bottom-')) {
        cursor = entry.content?.value ?? cursor;
      }
    }
  }

  return { tweets, cursor };
};

// "@Name" -> "Name", or null when it is not a valid X handle
export const normalizeHandle = (value: string) => {
  const handle = (value || '').trim().replace(/^@/, '');
  return HANDLE.test(handle) ? handle : null;
};

export const MAX_QUERY_LENGTH = 300;

// The search query: the user's keywords (X operators allowed, like
// from:name or lang:en) plus min_faves. Null when there is nothing to search.
export const buildSearchQuery = (options: {
  keywords: string;
  minLikes?: number;
}) => {
  const keywords = (options.keywords || '')
    // one line, no control characters
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!keywords) {
    return null;
  }

  const parts = [keywords];
  if (options.minLikes && options.minLikes > 0) {
    parts.push(`min_faves:${Math.floor(options.minLikes)}`);
  }
  const query = parts.join(' ');
  return query.length <= MAX_QUERY_LENGTH + 20 ? query : null;
};
