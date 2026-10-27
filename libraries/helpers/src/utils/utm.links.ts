// Appends UTM parameters to the http(s) links of a post. It runs on the stored
// post content, which is HTML for most editors, so `&` inside a link can be
// written as `&amp;` - the link is read with both forms and extended with the
// form the content already uses.
// It never overwrites a utm_* parameter that is already on a link, which also
// makes it idempotent: running it again on its own output changes nothing.

export interface UtmSettings {
  utmSource?: string | null;
  utmMedium?: string | null;
  utmCampaign?: string | null;
}

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

export const DEFAULT_UTM_SOURCE = '{{provider}}';
export const DEFAULT_UTM_MEDIUM = 'social';

const linkRegex = () => /https?:\/\/[^\s<>"'`]+/gi;
const isHtml = (text: string) => /<\/?[a-z][\s\S]*>/i.test(text);
// html entities that end a link inside html content (&amp; is part of it)
const htmlLinkEnd = /&(?:nbsp|lt|gt|quot|#39|#x27|apos);/i;

// `{{provider}}` is replaced with the provider identifier (x, linkedin-page...)
export const buildUtmParams = (
  settings: UtmSettings,
  provider: string
): UtmParams => {
  const fill = (value?: string | null) =>
    (value || '').replace(/{{\s*provider\s*}}/gi, provider).trim();

  const params: UtmParams = {
    utm_source: fill(settings.utmSource || DEFAULT_UTM_SOURCE) || provider,
    utm_medium: fill(settings.utmMedium || DEFAULT_UTM_MEDIUM),
    utm_campaign: fill(settings.utmCampaign),
  };

  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => !!value)
  ) as UtmParams;
};

// Trailing punctuation belongs to the sentence, not to the link, except a
// closing parenthesis that closes one opened inside the link (wikipedia style)
const splitTrailing = (link: string): [string, string] => {
  let end = link.length;
  while (end > 0) {
    const char = link[end - 1];
    if ('.,!?;:]}*'.includes(char)) {
      end--;
      continue;
    }

    if (char === ')') {
      const value = link.slice(0, end);
      const open = (value.match(/\(/g) || []).length;
      const close = (value.match(/\)/g) || []).length;
      if (close > open) {
        end--;
        continue;
      }
    }

    break;
  }

  return [link.slice(0, end), link.slice(end)];
};

export const addUtmToUrl = (
  link: string,
  params: UtmParams,
  html = false
): string => {
  const [beforeHash, ...hashParts] = link.split('#');
  const hash = hashParts.length ? '#' + hashParts.join('#') : '';

  let parsed: URL;
  try {
    parsed = new URL(beforeHash.replace(/&amp;/gi, '&'));
  } catch (err) {
    return link;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return link;
  }

  const missing = Object.entries(params).filter(
    ([key, value]) => !!value && !parsed.searchParams.has(key)
  );

  if (!missing.length) {
    return link;
  }

  const separator = html ? '&amp;' : '&';
  const query = missing
    .map(([key, value]) => `${key}=${encodeURIComponent(value as string)}`)
    .join(separator);

  const joiner = !beforeHash.includes('?')
    ? '?'
    : beforeHash.endsWith('?') ||
      beforeHash.endsWith('&') ||
      beforeHash.endsWith('&amp;')
    ? ''
    : separator;

  return beforeHash + joiner + query + hash;
};

export const addUtmToContent = (
  content: string,
  params: UtmParams,
  skipDomains: string[] = []
): string => {
  if (!content || !Object.keys(params).length) {
    return content;
  }

  const html = isHtml(content);
  return content.replace(linkRegex(), (match) => {
    let link = match;
    let rest = '';
    if (html) {
      const entity = link.search(htmlLinkEnd);
      if (entity > -1) {
        rest = link.slice(entity);
        link = link.slice(0, entity);
      }
    }

    const [clean, trailing] = splitTrailing(link);
    try {
      const host = new URL(clean.replace(/&amp;/gi, '&')).hostname;
      if (
        skipDomains.some(
          (domain) =>
            !!domain && (host === domain || host.endsWith('.' + domain))
        )
      ) {
        return match;
      }
    } catch (err) {
      return match;
    }

    return addUtmToUrl(clean, params, html) + trailing + rest;
  });
};
