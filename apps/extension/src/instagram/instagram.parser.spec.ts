/// <reference types="jest" />
import { JSDOM } from 'jsdom';
import {
  findInstagramPosts,
  getInstagramOwnHandle,
  instagramActionBar,
  parseInstagramPost,
  shortcodeFrom,
} from './instagram.parser';
import { igFeedPost, igNav, igPostPage } from './__fixtures__/instagram';

const page = (html: string) => {
  const { document } = new JSDOM('<!doctype html><body></body>').window;
  document.body.innerHTML = html;
  return document;
};

describe('Instagram parser (unverified fixtures)', () => {
  it('reads a feed post', () => {
    const doc = page(igNav() + igFeedPost({ likes: '1,234', comments: '56' }));
    const [post] = findInstagramPosts(doc);
    expect(parseInstagramPost(post, getInstagramOwnHandle(doc))).toEqual({
      id: 'C9xYz12AbCd',
      url: 'https://www.instagram.com/p/C9xYz12AbCd/',
      authorHandle: 'chart_guru',
      authorName: null,
      text: 'Risk 1% per trade. Cut losers fast, let winners run.',
      likes: 1234,
      comments: 56,
      shares: null,
      views: null,
      saves: null,
      mediaType: 'image',
      postedAt: '2026-10-27T14:00:00.000Z',
      own: false,
      manual: false,
    });
    expect(instagramActionBar(post)?.tagName).toBe('SECTION');
  });

  it('reads "Liked by x and N others", videos and carousels', () => {
    const doc = page(
      igFeedPost({ likedByOthers: '1.2K', video: true }) +
        igFeedPost({ code: 'CAroUsEl123', carousel: true })
    );
    const [video, carousel] = findInstagramPosts(doc).map((p) =>
      parseInstagramPost(p)
    );
    expect(video).toMatchObject({ likes: 1201, mediaType: 'video' });
    expect(carousel).toMatchObject({
      id: 'CAroUsEl123',
      mediaType: 'carousel',
      likes: null,
    });
  });

  it('marks own posts and skips ads', () => {
    const doc = page(
      igNav('chart_guru') +
        igFeedPost() +
        igFeedPost({ handle: 'brand', code: 'AdAdAd12345', sponsored: true })
    );
    const own = getInstagramOwnHandle(doc);
    expect(own).toBe('chart_guru');
    const parsed = findInstagramPosts(doc).map((p) =>
      parseInstagramPost(p, own)
    );
    expect(parsed[0]?.own).toBe(true);
    expect(parsed[1]).toBeNull();
  });

  it('reads the post page with its h1 caption and a reel link', () => {
    const doc = page(igNav() + igPostPage());
    const posts = findInstagramPosts(doc);
    expect(posts).toHaveLength(1);
    expect(parseInstagramPost(posts[0], null)).toMatchObject({
      id: 'DAbCdEfGhIj',
      url: 'https://www.instagram.com/reel/DAbCdEfGhIj/',
      text: 'My reel caption\nline two',
      likes: 12300,
      mediaType: 'video',
      postedAt: '2026-10-20T08:00:00.000Z',
    });
  });

  it('uses the page address when the post has no link', () => {
    const doc = page(
      '<article><header><a href="/someone/">someone</a></header></article>'
    );
    const [post] = findInstagramPosts(doc);
    expect(parseInstagramPost(post)).toBeNull();
    expect(
      parseInstagramPost(
        post,
        null,
        'https://www.instagram.com/someone/p/Abc12345/'
      )?.id
    ).toBe('Abc12345');
  });

  it('parses shortcodes and ignores app paths as handles', () => {
    expect(shortcodeFrom('/p/AbCdE123/')).toEqual({
      kind: 'p',
      code: 'AbCdE123',
    });
    expect(
      shortcodeFrom('https://www.instagram.com/reels/XyZ98765/?x=1')?.code
    ).toBe('XyZ98765');
    expect(shortcodeFrom('/explore/')).toBeNull();
    expect(
      getInstagramOwnHandle(
        page('<div role="navigation"><a href="/explore/">Profile</a></div>')
      )
    ).toBeNull();
  });
});
