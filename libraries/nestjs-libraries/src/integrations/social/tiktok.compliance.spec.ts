import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';

const video = [[{ path: 'https://example.com/clip.mp4' }]];

describe('tiktok direct post rules', () => {
  const provider = new TiktokProvider();
  const direct = { content_posting_method: 'DIRECT_POST' };

  it('asks for who the content promotes when the disclosure is on', async () => {
    expect(
      await provider.checkValidity(video as any, { ...direct, disclose: true })
    ).toContain('promotes yourself');
    expect(
      await provider.checkValidity(video as any, {
        ...direct,
        disclose: true,
        brand_organic_toggle: true,
      })
    ).toBe(true);
  });

  it('does not allow branded content to be private', async () => {
    expect(
      await provider.checkValidity(video as any, {
        ...direct,
        brand_content_toggle: true,
        privacy_level: 'SELF_ONLY',
      })
    ).toContain('cannot be set to private');
    expect(
      await provider.checkValidity(video as any, {
        ...direct,
        brand_content_toggle: true,
        privacy_level: 'PUBLIC_TO_EVERYONE',
      })
    ).toBe(true);
  });

  it('refuses a video longer than the account allows and a post TikTok will not take now', async () => {
    expect(
      await provider.checkValidity(video as any, {
        ...direct,
        video_seconds: 301,
        max_video_seconds: 300,
      })
    ).toContain('allows 300 seconds');
    expect(
      await provider.checkValidity(video as any, {
        ...direct,
        creator_error: 'too many posts',
      })
    ).toBe('too many posts');
  });

  it('only accepts Self only while the app is not audited', async () => {
    process.env.TIKTOK_APP_AUDITED = 'false';
    try {
      expect(
        await provider.checkValidity(video as any, {
          ...direct,
          privacy_level: 'PUBLIC_TO_EVERYONE',
        })
      ).toContain('choose Self only');
      expect(
        await provider.checkValidity(video as any, {
          ...direct,
          privacy_level: 'SELF_ONLY',
        })
      ).toBe(true);
    } finally {
      delete process.env.TIKTOK_APP_AUDITED;
    }
    // without the setting every audience TikTok lists is allowed
    expect(
      await provider.checkValidity(video as any, {
        ...direct,
        privacy_level: 'PUBLIC_TO_EVERYONE',
      })
    ).toBe(true);
  });

  it('keeps these rules away from an upload to the inbox', async () => {
    expect(
      await provider.checkValidity(video as any, {
        content_posting_method: 'UPLOAD',
        disclose: true,
        brand_content_toggle: true,
        privacy_level: 'SELF_ONLY',
      })
    ).toBe(true);
  });
});
