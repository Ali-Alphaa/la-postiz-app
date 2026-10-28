// Portions adapted from XActions (https://github.com/nirholas/XActions),
// Copyright (c) 2024-2026 nich (@nichxbt), Licensed under the Apache License,
// Version 2.0 (src/scrapers/twitter/http/transactionId.js).
// That file adapts the transaction-id algorithm (key-byte indices, the
// cubic-bezier animation key and the SHA-256 + XOR payload) from
// x-client-transaction-id by Lami, https://github.com/Lqm1/x-client-transaction-id,
// MIT License, Copyright (c) 2025 Lami (see NOTICE.md for the full notice),
// and can use the {animationKey, verification} pair dictionary published by
// fa0311 (MIT): https://github.com/fa0311/x-client-transaction-id-pair-dict
// Modifications: ported to TypeScript; the keys are kept in memory only (no
// cache file in the home directory); the live page is tried before the pair
// dictionary so that only x.com is called while it works; every network call
// goes through the fetch function of the caller (daily limit, spacing,
// timeout); no environment switches.

import { createHash } from 'crypto';

export type XFetch = (url: string, init?: RequestInit) => Promise<Response>;

export const PAIR_DICTIONARY_URL =
  'https://raw.githubusercontent.com/fa0311/x-client-transaction-id-pair-dict/main/pair.json';
export const HOME_URL = 'https://x.com/home';
export const BUNDLE_BASE = 'https://abs.twimg.com/responsive-web/client-web/';
const ON_DEMAND_CHUNK_NAME = 'ondemand.s';
const DEFAULT_KEYWORD = 'obfiowerehiring';
const ADDITIONAL_RANDOM_NUMBER = 3;
const TRANSACTION_EPOCH_MS = 1682924400 * 1000;
const TOTAL_TIME = 4096;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FAILURE_BACKOFF_MS = 10 * 60 * 1000;

const INDICES_RE = /\(\w\[(\d{1,2})\],\s*16\)/g;
const VERIFICATION_META_RE =
  /<meta[^>]*name=["']twitter-site-verification["'][^>]*content=["']([^"']+)["']/i;
const VERIFICATION_META_REVERSED_RE =
  /<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter-site-verification["']/i;
const ANIMATION_FRAME_RE = /id=["']loading-x-anim-(\d+)["']/g;
const D_ATTRIBUTE_RE = /\sd=["']([^"']+)["']/g;

// headers of a browser opening a page: without them x.com serves a shell
export const navigationHeaders = (userAgent: string) => ({
  'user-agent': userAgent,
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'sec-fetch-user': '?1',
  'upgrade-insecure-requests': '1',
});

// ---------------------------------------------------------------------------
// Webpack manifest of the x.com page (shared with the query id discovery)
// ---------------------------------------------------------------------------

export interface XChunk {
  id: string;
  name: string;
  hash: string;
  url: string;
}

export const parseChunkManifest = (html: string) => {
  const base =
    (html.match(
      /p\.p="(https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/)"/
    ) || [])[1] || BUNDLE_BASE;

  const start = html.indexOf('.u=e=>');
  const end = start === -1 ? -1 : html.indexOf('a.js"', start);
  if (start === -1 || end === -1) {
    return { base, chunks: [] as XChunk[] };
  }
  const fn = html.slice(start, end + 5);
  const pivot = fn.indexOf('||e)');
  if (pivot === -1) {
    return { base, chunks: [] as XChunk[] };
  }

  const names = new Map<string, string>();
  for (const match of fn.slice(0, pivot).matchAll(/(\d+):"([^"]+)"/g)) {
    names.set(match[1], match[2]);
  }
  const chunks: XChunk[] = [];
  for (const match of fn.slice(pivot).matchAll(/(\d+):"([a-f0-9]{8,32})"/g)) {
    const name = names.get(match[1]) ?? match[1];
    chunks.push({
      id: match[1],
      name,
      hash: match[2],
      url: `${base}${name}.${match[2]}a.js`,
    });
  }
  return { base, chunks };
};

// ---------------------------------------------------------------------------
// Pure extractors
// ---------------------------------------------------------------------------

export const extractVerificationKey = (html: string) => {
  const match =
    html.match(VERIFICATION_META_RE) ||
    html.match(VERIFICATION_META_REVERSED_RE);
  return match ? match[1] : null;
};

export const extractAnimationPaths = (html: string) => {
  const frames: Array<{ index: number; d: string }> = [];
  for (const match of html.matchAll(ANIMATION_FRAME_RE)) {
    const closing = html.indexOf('</svg>', match.index);
    const block =
      closing === -1
        ? html.slice(match.index)
        : html.slice(match.index, closing);
    const paths = [...block.matchAll(D_ATTRIBUTE_RE)].map((p) => p[1]);
    if (paths.length >= 2) {
      frames.push({ index: Number(match[1]), d: paths[1] });
    }
  }
  return frames.sort((a, b) => a.index - b.index).map((p) => p.d);
};

export const extractKeyByteIndices = (js: string) => {
  const found = [...js.matchAll(INDICES_RE)].map((p) => parseInt(p[1], 10));
  if (found.length < 2) {
    return null;
  }
  return { rowIndex: found[0], keyByteIndices: found.slice(1) };
};

const pathToFrameRows = (d: string) =>
  d
    .substring(9)
    .split('C')
    .map((segment) => {
      const cleaned = segment.replace(/[^\d]+/g, ' ').trim();
      return cleaned === ''
        ? []
        : cleaned.split(/\s+/).map((n) => parseInt(n, 10));
    });

const keyToBytes = (key: string) => Array.from(Buffer.from(key, 'base64'));

// ---------------------------------------------------------------------------
// Animation key (x-client-transaction-id, MIT, (c) 2025 Lami)
// ---------------------------------------------------------------------------

const isOdd = (n: number) => (n % 2 ? -1.0 : 0.0);

// the float-to-hex routine of the web client, quirks included
export const floatToHex = (value: number) => {
  let x = value;
  const digits: string[] = [];
  let quotient = Math.floor(x);
  let fraction = x - quotient;

  while (quotient > 0) {
    quotient = Math.floor(x / 16);
    const remainder = Math.floor(x - quotient * 16);
    digits.unshift(
      remainder > 9 ? String.fromCharCode(remainder + 55) : String(remainder)
    );
    x = quotient;
  }

  if (fraction === 0) {
    return digits.join('');
  }

  digits.push('.');
  while (fraction > 0) {
    fraction *= 16;
    const whole = Math.floor(fraction);
    fraction -= whole;
    digits.push(whole > 9 ? String.fromCharCode(whole + 55) : String(whole));
  }
  return digits.join('');
};

const bezier = (a: number, b: number, m: number) =>
  3.0 * a * (1 - m) * (1 - m) * m + 3.0 * b * (1 - m) * m * m + m * m * m;

export const cubicValue = (curves: number[], time: number) => {
  if (time <= 0.0) {
    let startGradient = 0;
    if (curves[0] > 0.0) {
      startGradient = curves[1] / curves[0];
    } else if (curves[1] === 0.0 && curves[2] > 0.0) {
      startGradient = curves[3] / curves[2];
    }
    return startGradient * time;
  }
  if (time >= 1.0) {
    let endGradient = 0;
    if (curves[2] < 1.0) {
      endGradient = (curves[3] - 1.0) / (curves[2] - 1.0);
    } else if (curves[2] === 1.0 && curves[0] < 1.0) {
      endGradient = (curves[1] - 1.0) / (curves[0] - 1.0);
    }
    return 1.0 + endGradient * (time - 1.0);
  }

  let start = 0.0;
  let end = 1.0;
  let mid = 0.0;
  while (start < end) {
    mid = (start + end) / 2;
    const estimate = bezier(curves[0], curves[2], mid);
    if (Math.abs(time - estimate) < 0.00001) {
      return bezier(curves[1], curves[3], mid);
    }
    if (estimate < time) {
      start = mid;
    } else {
      end = mid;
    }
  }
  return bezier(curves[1], curves[3], mid);
};

const interpolate = (from: number[], to: number[], f: number) =>
  from.map((value, i) => value * (1 - f) + to[i] * f);

const rotationToMatrix = (degrees: number) => {
  const radians = (degrees * Math.PI) / 180;
  return [
    Math.cos(radians),
    -Math.sin(radians),
    Math.sin(radians),
    Math.cos(radians),
  ];
};

const solve = (value: number, min: number, max: number, floor: boolean) => {
  const result = (value * (max - min)) / 255 + min;
  return floor ? Math.floor(result) : Math.round(result * 100) / 100;
};

export const animate = (frames: number[], targetTime: number) => {
  const fromColor = frames.slice(0, 3).concat(1).map(Number);
  const toColor = frames.slice(3, 6).concat(1).map(Number);
  const toRotation = [solve(frames[6], 60.0, 360.0, true)];
  const curves = frames
    .slice(7)
    .map((item, i) => solve(item, isOdd(i), 1.0, false));

  const value = cubicValue(curves, targetTime);
  const color = interpolate(fromColor, toColor, value).map((n) =>
    n > 0 ? n : 0
  );
  const rotation = interpolate([0.0], toRotation, value);
  const matrix = rotationToMatrix(rotation[0]);

  const parts = color.slice(0, -1).map((n) => Math.round(n).toString(16));
  for (const entry of matrix) {
    let rounded = Math.round(entry * 100) / 100;
    if (rounded < 0) {
      rounded = -rounded;
    }
    const hex = floatToHex(rounded);
    parts.push(hex.startsWith('.') ? `0${hex}`.toLowerCase() : hex || '0');
  }
  parts.push('0', '0');

  return parts.join('').replace(/[.-]/g, '');
};

export const computeAnimationKey = (input: {
  keyBytes: number[];
  rowIndex: number;
  keyByteIndices: number[];
  paths: string[];
}) => {
  const { keyBytes, rowIndex, keyByteIndices, paths } = input;
  if (!keyBytes.length || !paths.length) {
    return null;
  }
  const d = paths[keyBytes[5] % paths.length];
  if (typeof d !== 'string') {
    return null;
  }
  const row = keyBytes[rowIndex] % 16;
  const frameTime =
    Math.round(
      keyByteIndices.reduce((acc, i) => acc * (keyBytes[i] % 16), 1) / 10
    ) * 10;
  const frames = pathToFrameRows(d)[row];
  if (!Array.isArray(frames) || frames.length < 8) {
    return null;
  }
  return animate(frames, frameTime / TOTAL_TIME);
};

// ---------------------------------------------------------------------------
// Transaction id
// ---------------------------------------------------------------------------

// x.com signs the pathname only
export const normalizeSignedPath = (target: string) => {
  try {
    return new URL(target).pathname;
  } catch (err) {
    const path = target.split('#')[0].split('?')[0];
    return path.startsWith('/') ? path : `/${path}`;
  }
};

export const generateTransactionId = (input: {
  key: string;
  animationKey: string;
  method: string;
  path: string;
  timeNow?: number;
  randomByte?: number;
}) => {
  const seconds =
    input.timeNow ?? Math.floor((Date.now() - TRANSACTION_EPOCH_MS) / 1000);
  const timeBytes = [
    seconds & 0xff,
    (seconds >> 8) & 0xff,
    (seconds >> 16) & 0xff,
    (seconds >> 24) & 0xff,
  ];
  const payload = `${input.method.toUpperCase()}!${normalizeSignedPath(
    input.path
  )}!${seconds}${DEFAULT_KEYWORD}${input.animationKey}`;
  const digest = Array.from(createHash('sha256').update(payload).digest());

  const mask = input.randomByte ?? Math.floor(Math.random() * 256);
  const bytes = [
    ...keyToBytes(input.key),
    ...timeBytes,
    ...digest.slice(0, 16),
    ADDITIONAL_RANDOM_NUMBER,
  ];
  return Buffer.from([mask, ...bytes.map((b) => b ^ mask)])
    .toString('base64')
    .replace(/=/g, '');
};

// ---------------------------------------------------------------------------
// Key discovery, cached in memory for the process
// ---------------------------------------------------------------------------

const state = {
  keys: null as null | { key: string; animationKey: string; at: number },
  lastFailureAt: 0,
  inflight: null as null | Promise<{
    key: string;
    animationKey: string;
  } | null>,
};

const readText = async (
  fetch: XFetch,
  url: string,
  headers: Record<string, string>
) => {
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`GET ${new URL(url).host} answered ${response.status}`);
  }
  return response.text();
};

const fromLivePage = async (fetch: XFetch, userAgent: string) => {
  const html = await readText(fetch, HOME_URL, navigationHeaders(userAgent));
  const key = extractVerificationKey(html);
  const paths = extractAnimationPaths(html);
  const chunk = parseChunkManifest(html).chunks.find(
    (p) => p.name === ON_DEMAND_CHUNK_NAME
  );
  if (!key || !paths.length || !chunk) {
    throw new Error('the x.com page has no transaction keys');
  }
  const indices = extractKeyByteIndices(
    await readText(fetch, chunk.url, { 'user-agent': userAgent, accept: '*/*' })
  );
  if (!indices) {
    throw new Error('no key-byte indices in the ondemand chunk');
  }
  const animationKey = computeAnimationKey({
    keyBytes: keyToBytes(key),
    ...indices,
    paths,
  });
  if (!animationKey) {
    throw new Error('the animation frames do not match the key');
  }
  return { key, animationKey };
};

const fromPairDictionary = async (fetch: XFetch) => {
  const pairs = JSON.parse(
    await readText(fetch, PAIR_DICTIONARY_URL, { accept: 'application/json' })
  );
  const usable = (Array.isArray(pairs) ? pairs : []).filter(
    (p: any) =>
      typeof p?.verification === 'string' && typeof p?.animationKey === 'string'
  );
  if (!usable.length) {
    throw new Error('the pair dictionary has no usable pair');
  }
  const chosen = usable[Math.floor(Math.random() * usable.length)];
  return { key: chosen.verification, animationKey: chosen.animationKey };
};

const discover = async (fetch: XFetch, userAgent: string) => {
  for (const lane of [
    () => fromLivePage(fetch, userAgent),
    () => fromPairDictionary(fetch),
  ]) {
    try {
      const keys = await lane();
      state.keys = { ...keys, at: Date.now() };
      state.lastFailureAt = 0;
      return state.keys;
    } catch (err) {
      // the next lane
    }
  }
  state.lastFailureAt = Date.now();
  // stale keys still sign correctly
  return state.keys;
};

// The x-client-transaction-id header of one request, or null: the request
// then goes out unsigned
export const getTransactionId = async (
  fetch: XFetch,
  userAgent: string,
  method: string,
  url: string
) => {
  try {
    const fresh = state.keys && Date.now() - state.keys.at < MAX_AGE_MS;
    if (!fresh && Date.now() - state.lastFailureAt >= FAILURE_BACKOFF_MS) {
      if (!state.inflight) {
        state.inflight = discover(fetch, userAgent).finally(() => {
          state.inflight = null;
        });
      }
      await state.inflight;
    }
    if (!state.keys) {
      return null;
    }
    return generateTransactionId({
      key: state.keys.key,
      animationKey: state.keys.animationKey,
      method,
      path: url,
    });
  } catch (err) {
    return null;
  }
};

export const resetTransactionState = () => {
  state.keys = null;
  state.lastFailureAt = 0;
  state.inflight = null;
};
