import {
  addUtmToContent,
  addUtmToUrl,
  buildUtmParams,
} from '@gitroom/helpers/utils/utm.links';

const params = { utm_source: 'x', utm_medium: 'social' };

describe('buildUtmParams', () => {
  it('defaults the source to the provider identifier and the medium to social', () => {
    expect(buildUtmParams({}, 'linkedin-page')).toEqual({
      utm_source: 'linkedin-page',
      utm_medium: 'social',
    });
  });

  it('fills the provider template and keeps the campaign', () => {
    expect(
      buildUtmParams(
        {
          utmSource: 'postiz_{{provider}}',
          utmMedium: 'organic',
          utmCampaign: 'launch',
        },
        'x'
      )
    ).toEqual({
      utm_source: 'postiz_x',
      utm_medium: 'organic',
      utm_campaign: 'launch',
    });
  });
});

describe('addUtmToUrl', () => {
  it('adds the params to a link without a query', () => {
    expect(addUtmToUrl('https://postiz.com/blog', params)).toBe(
      'https://postiz.com/blog?utm_source=x&utm_medium=social'
    );
  });

  it('keeps the existing query and the hash', () => {
    expect(addUtmToUrl('https://postiz.com/?a=1#top', params)).toBe(
      'https://postiz.com/?a=1&utm_source=x&utm_medium=social#top'
    );
  });

  it('never overwrites an existing utm param', () => {
    expect(
      addUtmToUrl('https://postiz.com/?utm_source=newsletter', params)
    ).toBe('https://postiz.com/?utm_source=newsletter&utm_medium=social');
  });

  it('encodes the values', () => {
    expect(
      addUtmToUrl('https://postiz.com', { utm_campaign: 'black friday' })
    ).toBe('https://postiz.com?utm_campaign=black%20friday');
  });

  it('ignores other protocols', () => {
    expect(addUtmToUrl('ftp://postiz.com', params)).toBe('ftp://postiz.com');
  });
});

describe('addUtmToContent', () => {
  it('adds the params to every link of a text post', () => {
    expect(
      addUtmToContent(
        'Read https://postiz.com/a and http://example.com/b?c=d.',
        params
      )
    ).toBe(
      'Read https://postiz.com/a?utm_source=x&utm_medium=social and http://example.com/b?c=d&utm_source=x&utm_medium=social.'
    );
  });

  it('is idempotent', () => {
    const once = addUtmToContent('Go https://postiz.com/a!', params);
    expect(addUtmToContent(once, params)).toBe(once);
  });

  it('handles html content with encoded ampersands', () => {
    const content =
      '<p>Read <a href="https://postiz.com/?a=1&amp;b=2">https://postiz.com/?a=1&amp;b=2</a>&nbsp;now</p>';
    const result = addUtmToContent(content, params);
    expect(result).toBe(
      '<p>Read <a href="https://postiz.com/?a=1&amp;b=2&amp;utm_source=x&amp;utm_medium=social">https://postiz.com/?a=1&amp;b=2&amp;utm_source=x&amp;utm_medium=social</a>&nbsp;now</p>'
    );
    expect(addUtmToContent(result, params)).toBe(result);
  });

  it('keeps a closing parenthesis outside of the link', () => {
    expect(addUtmToContent('(see https://postiz.com)', params)).toBe(
      '(see https://postiz.com?utm_source=x&utm_medium=social)'
    );
    expect(
      addUtmToContent('https://en.wikipedia.org/wiki/Foo_(bar)', params)
    ).toBe(
      'https://en.wikipedia.org/wiki/Foo_(bar)?utm_source=x&utm_medium=social'
    );
  });

  it('skips the short link domain', () => {
    expect(
      addUtmToContent('https://dub.sh/abc https://postiz.com', params, [
        'dub.sh',
      ])
    ).toBe(
      'https://dub.sh/abc https://postiz.com?utm_source=x&utm_medium=social'
    );
  });

  it('returns content without links untouched', () => {
    expect(addUtmToContent('No links #here', params)).toBe('No links #here');
  });
});
