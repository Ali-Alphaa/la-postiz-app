// Portions adapted from XActions (https://github.com/nirholas/XActions),
// Copyright (c) 2024-2026 nich (@nichxbt), Licensed under the Apache License,
// Version 2.0 (src/scrapers/twitter/http/errors.js).
// Modifications: the error classes are folded into one error with a code and
// a message that can be shown to the user; the write-action cases ("already
// favorited", ...) are removed.

export type XFetcherErrorCode =
  | 'disabled'
  | 'daily_limit'
  | 'rate_limited'
  | 'auth_failed'
  | 'blocked'
  | 'not_found'
  | 'schema_changed';

const MESSAGES: Record<XFetcherErrorCode, string> = {
  disabled: 'The X fetcher is not enabled on this server (X_FETCHER_ENABLED)',
  daily_limit:
    'The daily limit of X requests of your organization is reached, try again tomorrow',
  rate_limited: 'X is limiting the requests right now, try again later',
  auth_failed:
    'X refused the session of the spare account (X_FETCHER_AUTH_TOKEN / X_FETCHER_CT0): sign in again and update the cookies',
  blocked:
    'X refused the request from this server. Guest access may be blocked here, try cookie mode with a spare account or use the browser extension',
  not_found: 'Not found on X (deleted, private or wrong name)',
  schema_changed:
    'X changed how its web app talks to its servers, the fetcher needs an update',
};

export class XFetcherError extends Error {
  constructor(public code: XFetcherErrorCode, detail?: string) {
    // the detail is for the logs, never cookies or tokens
    super(MESSAGES[code]);
    this.name = 'XFetcherError';
    this.detail = detail;
  }

  detail?: string;
}

// errors x.com returns with a 200 { errors: [...] }
export const errorFromGraphQL = (
  errors: Array<{ message?: string }> | undefined
): XFetcherError | null => {
  if (!errors?.length) {
    return null;
  }
  const messages = errors.map((p) => (p.message || '').toLowerCase());
  if (
    messages.some((p) =>
      /rate limit|to protect our users from spam|too many requests/.test(p)
    )
  ) {
    return new XFetcherError('rate_limited', messages.join('; '));
  }
  if (
    messages.some((p) =>
      /cannot find specified user|user not found|could not find|no status found|_missing/.test(
        p
      )
    )
  ) {
    return new XFetcherError('not_found', messages.join('; '));
  }
  if (
    messages.some((p) =>
      /features cannot be null|persisted ?query|query ?not ?found|unknown operation|operation not found|queryid/.test(
        p
      )
    )
  ) {
    return new XFetcherError('schema_changed', messages.join('; '));
  }
  return null;
};

// a stale query id: x.com answers 404, or 400 naming the persisted query
export const isStaleQueryId = (status: number, body: any) => {
  if (status === 404) {
    return true;
  }
  if (status !== 400) {
    return false;
  }
  return errorFromGraphQL(body?.errors)?.code === 'schema_changed';
};
