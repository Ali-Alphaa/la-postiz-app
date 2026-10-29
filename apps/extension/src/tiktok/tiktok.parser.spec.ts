/// <reference types="jest" />
import { JSDOM } from 'jsdom';
import {
  findTikTokVideos,
  getTikTokOwnHandle,
  parseTikTokVideo,
  postedAtFromId,
  tiktokActionBar,
  videoFrom,
} from './tiktok.parser';
import {
  ttFeedItem,
  ttNav,
  ttProfileGrid,
  ttVideoPage,
} from './__fixtures__/tiktok';

const page = (html: string) => {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  document.body.innerHTML = html;
  return document;
};

describe('TikTok parser (unverified fixtures)', () => {
  it('reads a For You item', () => {
    const doc = page(ttNav() + ttFeedItem());
    const [item] = findTikTokVideos(doc);
    expect(parseTikTokVideo(item, getTikTokOwnHandle(doc))).toEqual({
      id: '7431234567890123456',
      url: 'https://www.tiktok.com/@fx_daily/video/7431234567890123456',
      authorHandle: 'fx_daily',
      authorName: 'FX Daily',
      text: 'Gold breakout setup #forex',
      likes: 12300,
      comments: 456,
      shares: 789,
      views: null,
      saves: 1100000,
      mediaType: 'video',
      postedAt: postedAtFromId('7431234567890123456'),
      own: false,
      manual: false,
    });
    expect(tiktokActionBar(item)?.tagName).toBe('SECTION');
  });

  it('reads the video page with the address of the page', () => {
    const doc = page(ttVideoPage());
    const [item] = findTikTokVideos(doc);
    expect(parseTikTokVideo(item, null)).toBeNull();
    expect(
      parseTikTokVideo(
        item,
        null,
        'https://www.tiktok.com/@fx_daily/video/7431234567890999999?lang=en'
      )
    ).toMatchObject({
      id: '7431234567890999999',
      authorName: 'FX Daily',
      text: 'Risk management in 30 seconds',
      likes: 2345,
      comments: 67,
      saves: 890,
      shares: 12,
    });
  });

  it('reads the views of a profile grid and marks own videos', () => {
    const doc = page(ttNav('fx_daily') + ttProfileGrid());
    const own = getTikTokOwnHandle(doc);
    const items = findTikTokVideos(doc).map((p) => parseTikTokVideo(p, own));
    expect(items.map((p) => p?.views)).toEqual([1200000, 980]);
    expect(items.every((p) => p?.own && p.likes === null)).toBe(true);
    expect(tiktokActionBar(findTikTokVideos(doc)[0])).toBeNull();
  });

  it('skips ads and reads photo posts as carousels', () => {
    const doc = page(
      ttFeedItem({ ad: true }) +
        ttFeedItem({ id: '7431234567890123999', photo: true })
    );
    const [ad, photo] = findTikTokVideos(doc).map((p) => parseTikTokVideo(p));
    expect(ad).toBeNull();
    expect(photo).toMatchObject({
      mediaType: 'carousel',
      url: 'https://www.tiktok.com/@fx_daily/photo/7431234567890123999',
    });
  });

  it('reads ids, dates and the signed-in handle', () => {
    expect(videoFrom('/@a.b_c/video/7431234567890123456')).toEqual({
      handle: 'a.b_c',
      kind: 'video',
      id: '7431234567890123456',
    });
    expect(videoFrom('/@x/video/123')).toBeNull();
    // the first 32 bits of the id are the creation time
    expect(postedAtFromId('7431234567890123456')).toBe(
      new Date(
        Number(BigInt('7431234567890123456') >> BigInt(32)) * 1000
      ).toISOString()
    );
    expect(postedAtFromId('12345678')).toBeNull();
    expect(
      getTikTokOwnHandle(
        page(
          '<a href="/@me_trader?lang=en"><span data-e2e="profile-icon"></span></a>'
        )
      )
    ).toBe('me_trader');
    expect(getTikTokOwnHandle(page('<div></div>'))).toBeNull();
  });
});
