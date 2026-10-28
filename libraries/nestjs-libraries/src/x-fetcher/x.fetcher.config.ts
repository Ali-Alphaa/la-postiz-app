// Configuration and network guard of the X fetcher (Postiz code, not ported).
// The fetcher is off unless X_FETCHER_ENABLED is set; every request it makes
// goes through guardedFetch: allowed hosts only, the daily limit of the
// organization before every x.com request, at least 1s between requests and
// a 10s timeout.

import { XFetcherError } from '@gitroom/nestjs-libraries/x-fetcher/x.fetcher.errors';

export const DEFAULT_DAILY_LIMIT = 150;
export const REQUEST_SPACING_MS = 1000;
export const REQUEST_TIMEOUT_MS = 10000;

export interface XFetcherConfig {
  enabled: boolean;
  mode: 'guest' | 'cookies';
  authToken?: string;
  ct0?: string;
  dailyLimit: number;
}

export const xFetcherConfig = (
  env: Record<string, string | undefined> = process.env
): XFetcherConfig => {
  const limit = parseInt(env.X_FETCHER_DAILY_LIMIT || '', 10);
  return {
    enabled: /^(true|1|yes|on)$/i.test((env.X_FETCHER_ENABLED || '').trim()),
    mode: (env.X_FETCHER_MODE || '').trim() === 'cookies' ? 'cookies' : 'guest',
    authToken: env.X_FETCHER_AUTH_TOKEN?.trim() || undefined,
    ct0: env.X_FETCHER_CT0?.trim() || undefined,
    dailyLimit:
      Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_DAILY_LIMIT,
  };
};

// the usage counter is per UTC day
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

// the counter is incremented before the request: the request is allowed
// while the new value is within the limit
export const isWithinDailyLimit = (
  countAfterIncrement: number,
  limit: number
) => countAfterIncrement <= limit;

// x.com itself: these requests count against the daily limit
const X_HOSTS = ['x.com', 'api.x.com', 'twitter.com', 'api.twitter.com'];
// static bundles of the web app and the transaction-key pair dictionary
const OTHER_HOSTS = ['abs.twimg.com', 'raw.githubusercontent.com'];

export const isXHost = (url: string) => {
  try {
    return X_HOSTS.includes(new URL(url).hostname);
  } catch (err) {
    return false;
  }
};

const isAllowedHost = (url: string) => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      [...X_HOSTS, ...OTHER_HOSTS].includes(parsed.hostname)
    );
  } catch (err) {
    return false;
  }
};

// all the requests of the process are spaced, whatever the organization
let nextSlot = 0;
const waitForSlot = async (spacingMs: number) => {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + spacingMs;
  if (slot > now) {
    await new Promise((resolve) => setTimeout(resolve, slot - now));
  }
};

export const guardedFetch =
  (options: {
    // throws XFetcherError('daily_limit') when the organization is over
    beforeXRequest: () => Promise<void>;
    fetchImpl?: typeof fetch;
    spacingMs?: number;
    timeoutMs?: number;
  }) =>
  async (url: string, init: RequestInit = {}) => {
    if (!isAllowedHost(url)) {
      throw new XFetcherError('blocked', 'host not allowed');
    }
    if (isXHost(url)) {
      await options.beforeXRequest();
    }
    await waitForSlot(options.spacingMs ?? REQUEST_SPACING_MS);
    return (options.fetchImpl || fetch)(url, {
      ...init,
      // never follow a redirect to another host
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  };
