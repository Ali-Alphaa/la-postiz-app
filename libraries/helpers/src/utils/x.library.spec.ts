import { weightedLength } from '@gitroom/helpers/utils/count.length';
import {
  bestVoiceSamples,
  likesRatio,
  nativeScheduleError,
  normalizeVoiceHandle,
  normalizeVariations,
  oembedHtmlToTweet,
  parseTweetUrl,
  evaluateAuthor,
  MAX_BASELINE_SAMPLES,
  MAX_PENDING,
  median,
  mergeLikeSamples,
  mergeVoiceSamples,
  viralVerdict,
  XVoiceSample,
} from '@gitroom/helpers/utils/x.library';

const samples = (...likes: number[]) =>
  likes.map((p, index) => ({ id: `s${index}`, likes: p }));

describe('median', () => {
  it('handles empty, odd and even lists', () => {
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 10])).toBe(3.5);
  });
});

describe('mergeLikeSamples', () => {
  it('replaces the likes of a known tweet and appends new ones', () => {
    expect(
      mergeLikeSamples(samples(1, 2), [
        { id: 's1', likes: 20 },
        { id: 'new', likes: 3 },
      ])
    ).toEqual([
      { id: 's0', likes: 1 },
      { id: 's1', likes: 20 },
      { id: 'new', likes: 3 },
    ]);
  });

  it('keeps only the most recent samples', () => {
    const merged = mergeLikeSamples(
      samples(...Array.from({ length: MAX_BASELINE_SAMPLES }, () => 1)),
      [{ id: 'new', likes: 9 }]
    );
    expect(merged).toHaveLength(MAX_BASELINE_SAMPLES);
    expect(merged[0].id).toBe('s1');
    expect(merged[merged.length - 1]).toEqual({ id: 'new', likes: 9 });
  });
});

describe('viralVerdict', () => {
  it('needs at least 50 likes', () => {
    expect(viralVerdict({ id: 't', likes: 49 }, samples(1, 1, 1))).toEqual({
      status: 'no',
    });
  });

  it('waits for 3 other samples of the author', () => {
    expect(
      viralVerdict({ id: 't', likes: 500 }, [
        ...samples(10, 10),
        { id: 't', likes: 500 },
      ])
    ).toEqual({ status: 'pending' });
  });

  it('is viral at 3x the median of the other samples', () => {
    expect(
      viralVerdict({ id: 't', likes: 60 }, [
        ...samples(10, 20, 30),
        { id: 't', likes: 60 },
      ])
    ).toEqual({ status: 'viral', ratio: 3 });
    expect(viralVerdict({ id: 't', likes: 59 }, samples(10, 20, 30))).toEqual({
      status: 'no',
    });
  });

  it('does not divide by zero', () => {
    expect(viralVerdict({ id: 't', likes: 80 }, samples(0, 0, 0))).toEqual({
      status: 'viral',
      ratio: 80,
    });
  });
});

describe('evaluateAuthor', () => {
  it('parks a big tweet until the baseline is known, then saves it', () => {
    const tweet = { id: 'big', likes: 300, text: 'hello' };
    const first = evaluateAuthor({ samples: [], pending: [] }, [
      tweet,
      { id: 'a', likes: 10, text: '' },
    ]);
    expect(first.viral).toEqual([]);
    expect(first.pending).toEqual([tweet]);

    const second = evaluateAuthor(first, [
      { id: 'b', likes: 12, text: '' },
      { id: 'c', likes: 8, text: '' },
    ]);
    expect(second.pending).toEqual([]);
    expect(second.viral).toEqual([{ tweet, ratio: 30 }]);
  });

  it('drops a pending tweet that turns out to be normal for the author', () => {
    const first = evaluateAuthor({ samples: [], pending: [] }, [
      { id: 'big', likes: 60 },
    ]);
    expect(first.pending).toHaveLength(1);
    const second = evaluateAuthor(first, samples(50, 40, 70));
    expect(second.pending).toEqual([]);
    expect(second.viral).toEqual([]);
  });

  it('uses the latest counts of a pending tweet', () => {
    const first = evaluateAuthor({ samples: [], pending: [] }, [
      { id: 'big', likes: 60 },
    ]);
    const second = evaluateAuthor(first, [
      ...samples(30, 30, 30),
      { id: 'big', likes: 120 },
    ]);
    expect(second.viral).toEqual([
      { tweet: { id: 'big', likes: 120 }, ratio: 4 },
    ]);
  });

  it('keeps at most MAX_PENDING pending tweets, most liked first', () => {
    const pending = Array.from({ length: MAX_PENDING + 3 }, (_, index) => ({
      id: `p${index}`,
      likes: 100 + index,
    }));
    // only 2 known tweets of the author: everything big keeps waiting
    const result = evaluateAuthor({ samples: samples(1, 1), pending }, []);
    expect(result.viral).toEqual([]);
    expect(result.pending).toHaveLength(MAX_PENDING);
    expect(result.pending[0]).toEqual({ id: 'p12', likes: 112 });
  });
});

describe('voice samples', () => {
  const voice = (id: string, likes: number, day: number): XVoiceSample => ({
    id,
    text: `tweet ${id}`,
    likes,
    postedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
  });

  it('updates a known tweet', () => {
    expect(
      mergeVoiceSamples([voice('a', 1, 1)], [{ ...voice('a', 5, 1) }])
    ).toEqual([voice('a', 5, 1)]);
  });

  it('keeps the best and the most recent ones', () => {
    const all = [
      voice('old-best', 1000, 1),
      voice('old-bad', 1, 2),
      voice('recent', 2, 20),
      voice('mid', 3, 10),
    ];
    const merged = mergeVoiceSamples([], all, 2);
    expect(merged.map((p) => p.id).sort()).toEqual(['old-best', 'recent']);
  });

  it('sorts the best samples first', () => {
    expect(
      bestVoiceSamples([voice('a', 1, 1), voice('b', 9, 1)], 1).map((p) => p.id)
    ).toEqual(['b']);
  });
});

describe('likesRatio', () => {
  it('is 0 until the author is known', () => {
    expect(likesRatio({ id: 't', likes: 10 }, samples(1, 2))).toBe(0);
    expect(likesRatio({ id: 't', likes: 10 }, samples(2, 2, 2))).toBe(5);
  });
});

describe('parseTweetUrl', () => {
  it('accepts the links of a tweet', () => {
    expect(parseTweetUrl('https://x.com/Alice_1/status/123?s=20')).toEqual({
      id: '123',
      handle: 'Alice_1',
      url: 'https://x.com/Alice_1/status/123',
    });
    expect(
      parseTweetUrl('https://mobile.twitter.com/bob/statuses/9/photo/1')?.id
    ).toBe('9');
    expect(parseTweetUrl('http://www.twitter.com/bob/status/9')?.handle).toBe(
      'bob'
    );
    expect(parseTweetUrl('https://x.com/i/web/status/77')).toEqual({
      id: '77',
      handle: null,
      url: 'https://x.com/i/web/status/77',
    });
  });

  it('rejects anything else', () => {
    for (const url of [
      'not a url',
      'ftp://x.com/a/status/1',
      'https://x.com.evil.com/a/status/1',
      'https://evil.com/x.com/a/status/1',
      'https://user:pass@x.com/a/status/1',
      'https://x.com:8080/a/status/1',
      'https://x.com/a/status/abc',
      'https://x.com/a',
      'https://x.com/home/status/1',
      'https://x.com/this_handle_is_too_long/status/1',
      'https://127.0.0.1/a/status/1',
    ]) {
      expect(parseTweetUrl(url)).toBeNull();
    }
  });
});

describe('oembedHtmlToTweet', () => {
  it('extracts the text, the media and the date', () => {
    expect(
      oembedHtmlToTweet(
        '<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Risk 1% &amp; cut losers<br><br>Line &lt;2&gt; &#39;ok&#39; &#x1F680; <a href="https://t.co/x">pic.twitter.com/AbC123</a></p>&mdash; Alice (@alice) <a href="https://twitter.com/alice/status/1?ref_src=twsrc%5Etfw">October 27, 2026</a></blockquote>\n'
      )
    ).toEqual({
      text: "Risk 1% & cut losers\n\nLine <2> 'ok' \u{1F680}",
      mediaType: 'photo',
      postedAt: new Date('October 27, 2026').toISOString(),
    });
  });

  it('handles an answer without paragraph', () => {
    expect(oembedHtmlToTweet('<blockquote></blockquote>')).toEqual({
      text: '',
      mediaType: 'none',
      postedAt: null,
    });
  });
});

describe('normalizeVariations', () => {
  it('keeps exactly 5 non empty variations', () => {
    const six = [['a'], ['b', ' c '], [''], ['d'], ['e'], ['f'], ['g']];
    expect(normalizeVariations(six)).toEqual([
      ['a'],
      ['b', 'c'],
      ['d'],
      ['e'],
      ['f'],
    ]);
  });

  it('asks again when there are not enough', () => {
    expect(normalizeVariations([['a'], [' '], ['b'], ['c'], ['d']])).toBeNull();
    expect(normalizeVariations([])).toBeNull();
  });
});

describe('nativeScheduleError', () => {
  const now = new Date('2026-10-28T12:00:00.000Z');
  const length = (text: string) => text.length;
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60000);

  it('accepts a post between 10 minutes and 18 months ahead', () => {
    expect(nativeScheduleError('hello', at(10), length, now)).toBeNull();
    expect(
      nativeScheduleError(
        'hello',
        new Date('2028-04-28T12:00:00.000Z'),
        length,
        now
      )
    ).toBeNull();
  });

  it('rejects empty, long, too soon, too far and invalid dates', () => {
    expect(nativeScheduleError('  ', at(60), length, now)).toMatch(/empty/);
    expect(nativeScheduleError('x'.repeat(281), at(60), length, now)).toMatch(
      /280/
    );
    expect(nativeScheduleError('ok', at(9), length, now)).toMatch(/10 minutes/);
    expect(
      nativeScheduleError(
        'ok',
        new Date('2028-04-28T12:01:00.000Z'),
        length,
        now
      )
    ).toMatch(/18 months/);
    expect(nativeScheduleError('ok', new Date('nope'), length, now)).toMatch(
      /valid/
    );
  });

  it('uses the weighted length of X', () => {
    // weightedLength counts an emoji or a CJK character as 2
    expect(
      nativeScheduleError('漢'.repeat(141), at(60), weightedLength, now)
    ).toMatch(/280/);
    expect(
      nativeScheduleError('漢'.repeat(140), at(60), weightedLength, now)
    ).toBeNull();
  });
});

describe('normalizeVoiceHandle', () => {
  it('lowercases and strips @', () => {
    expect(normalizeVoiceHandle(' @Sigma_Trader ')).toBe('sigma_trader');
    expect(normalizeVoiceHandle('bad handle')).toBeNull();
    expect(normalizeVoiceHandle(null)).toBeNull();
  });
});
