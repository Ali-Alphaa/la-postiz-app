/// <reference types="jest" />
import {
  inspirationApiUrl,
  isBBKey,
  isPlatformEnabled,
  normalizeBBSettings,
} from './settings';
import { CaptureQueue, MAX_BATCH_BYTES } from '../x/capture.queue';
import { savedTodayByPlatform } from '../x/badge';
import type { BBItem } from './types';

describe('BrightBean settings', () => {
  it('defaults to the user domain with both platforms on', () => {
    expect(normalizeBBSettings(undefined)).toEqual({
      baseUrl: 'https://social.thesigmatrader.com',
      apiKey: '',
      instagram: true,
      tiktok: true,
    });
    expect(
      normalizeBBSettings({ apiKey: 'bb_studio_x', tiktok: false })
    ).toMatchObject({
      instagram: true,
      tiktok: false,
    });
  });

  it('needs a key and the toggle to capture', () => {
    const settings = normalizeBBSettings({
      apiKey: 'bb_studio_abc',
      instagram: false,
    });
    expect(isPlatformEnabled(settings, 'instagram')).toBe(false);
    expect(isPlatformEnabled(settings, 'tiktok')).toBe(true);
    expect(isPlatformEnabled(normalizeBBSettings({}), 'tiktok')).toBe(false);
  });

  it('builds the API URL and checks keys', () => {
    expect(inspirationApiUrl('https://social.thesigmatrader.com/')).toBe(
      'https://social.thesigmatrader.com/api/v1/growth/inspiration'
    );
    expect(inspirationApiUrl('https://example.com/studio')).toBe(
      'https://example.com/studio/api/v1/growth/inspiration'
    );
    expect(() => inspirationApiUrl('nope')).toThrow();
    expect(isBBKey('bb_studio_AbC-123_x')).toBe(true);
    expect(isBBKey('pos_123')).toBe(false);
  });
});

describe('batching of Instagram / TikTok items', () => {
  const item = (id: string, likes: number | null): BBItem => ({
    id,
    url: '',
    authorHandle: 'a',
    authorName: null,
    text: 'x'.repeat(6000),
    likes,
    comments: null,
    shares: null,
    views: null,
    saves: null,
    mediaType: 'video',
    postedAt: null,
    own: false,
    manual: false,
  });

  it('dedupes, re-sends on +20% likes, handles unknown likes and splits batches', () => {
    const queue = new CaptureQueue<BBItem>();
    expect(queue.add(item('1', null))).toBe(true);
    expect(queue.take(0)).toHaveLength(1);
    expect(queue.add(item('1', null))).toBe(false);
    expect(queue.add(item('1', 5))).toBe(true);

    for (let i = 2; i < 40; i++) {
      queue.add(item(String(i), 1));
    }
    const batch = queue.take(1);
    expect(batch[0].text).toHaveLength(4000);
    expect(JSON.stringify(batch).length).toBeLessThan(MAX_BATCH_BYTES + 5000);
    expect(queue.size).toBeGreaterThan(0);
  });
});

describe('saved today', () => {
  it('sums X, Instagram and TikTok of today only', () => {
    expect(
      savedTodayByPlatform(
        {
          x: { day: '2026-10-29', count: 3 },
          instagram: { day: '2026-10-29', count: 2 },
          tiktok: { day: '2026-10-28', count: 9 },
        },
        '2026-10-29'
      )
    ).toEqual({ x: 3, instagram: 2, tiktok: 0, total: 5 });
    expect(savedTodayByPlatform({}, '2026-10-29').total).toBe(0);
  });
});
