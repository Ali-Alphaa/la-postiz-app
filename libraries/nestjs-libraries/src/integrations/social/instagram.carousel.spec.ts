import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';
import { InstagramStandaloneProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.standalone.provider';

const media = (count: number) =>
  [...Array(count)].map((_, i) => ({ path: `https://x/${i}.png` }) as any);

describe.each([
  ['instagram', new InstagramProvider()],
  ['instagram standalone', new InstagramStandaloneProvider()],
])('%s carousel post type', (_name, provider: any) => {
  it('needs between 2 and 10 media', async () => {
    const settings = { post_type: 'carousel' };
    expect(await provider.checkValidity([media(1)], settings)).toContain(
      'between 2 and 10'
    );
    expect(await provider.checkValidity([media(2)], settings)).toBe(true);
    expect(await provider.checkValidity([media(10)], settings)).toBe(true);
    expect(await provider.checkValidity([media(11)], settings)).toEqual(
      expect.any(String)
    );
  });

  it('ignores a leftover trial reel flag and audio', async () => {
    expect(
      await provider.checkValidity([media(3)], {
        post_type: 'carousel',
        is_trial_reel: true,
        audio: { id: 'a1' },
      })
    ).toBe(true);
  });

  it('keeps one image allowed as a normal post', async () => {
    expect(
      await provider.checkValidity([media(1)], { post_type: 'post' })
    ).toBe(true);
  });
});
