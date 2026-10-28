// Portions adapted from XActions (https://github.com/nirholas/XActions),
// Copyright (c) 2024-2026 nich (@nichxbt), Licensed under the Apache License,
// Version 2.0 (src/scrapers/twitter/http/queryIds.js).
// Modifications: ported to TypeScript; the discovered ids are kept in memory
// only (no cache file, no saved session cookies); discovery runs only after
// x.com rejected a query id, at most once an hour, fetches the main bundle and
// the core chunks one by one through the caller's fetch, and keeps only the 5
// read operations Postiz uses.

import {
  OPERATIONS,
  XOperationName,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.endpoints';
import {
  HOME_URL,
  navigationHeaders,
  parseChunkManifest,
  XFetch,
} from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.transaction';

const RETRY_EVERY_MS = 60 * 60 * 1000;

// the chunks that declare the timeline, profile and search operations
const CORE_CHUNK_PATTERNS = [
  /^bundle\.UserProfile$/,
  /^loader\.UserHandler$/,
  /^bundle\.HomeTimeline$/,
  /^shared~.*HomeTimeline.*Compose/,
  /^ondemand\.HoverCard$/,
];

const OPERATION_RE =
  /queryId:"([A-Za-z0-9_-]+)",operationName:"([A-Za-z0-9_]+)",operationType:"(query|mutation|subscription)"/g;

const MAIN_BUNDLE_RE =
  /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/main\.([a-z0-9]+)\.js/;

const state = {
  discovered: {} as Partial<Record<XOperationName, string>>,
  lastAttempt: 0,
};

export const extractOperations = (js: string) =>
  [...js.matchAll(OPERATION_RE)].map((p) => ({
    queryId: p[1],
    operationName: p[2],
  }));

// the id in use: the one read from the live bundle wins over the pinned one
export const getQueryId = (name: XOperationName) =>
  state.discovered[name] || OPERATIONS[name].queryId;

// Reads the current ids of our operations from x.com's bundles. Returns
// whether the id of `name` changed.
export const refreshQueryIds = async (
  fetch: XFetch,
  userAgent: string,
  name: XOperationName
) => {
  if (Date.now() - state.lastAttempt < RETRY_EVERY_MS) {
    return false;
  }
  state.lastAttempt = Date.now();
  const before = getQueryId(name);

  try {
    const response = await fetch(HOME_URL, {
      headers: navigationHeaders(userAgent),
      redirect: 'follow',
    });
    if (!response.ok) {
      return false;
    }
    const html = await response.text();
    const main = html.match(MAIN_BUNDLE_RE)?.[0];
    const chunks = parseChunkManifest(html).chunks.filter((p) =>
      CORE_CHUNK_PATTERNS.some((pattern) => pattern.test(p.name))
    );
    const wanted = Object.keys(OPERATIONS);

    for (const url of [...(main ? [main] : []), ...chunks.map((p) => p.url)]) {
      const bundle = await fetch(url, {
        headers: { 'user-agent': userAgent, accept: '*/*' },
      });
      if (!bundle.ok) {
        continue;
      }
      for (const operation of extractOperations(await bundle.text())) {
        if (wanted.includes(operation.operationName)) {
          state.discovered[operation.operationName as XOperationName] =
            operation.queryId;
        }
      }
      if (wanted.every((p) => state.discovered[p as XOperationName])) {
        break;
      }
    }
  } catch (err) {
    return false;
  }

  return getQueryId(name) !== before;
};

export const resetQueryIdState = () => {
  state.discovered = {};
  state.lastAttempt = 0;
};
