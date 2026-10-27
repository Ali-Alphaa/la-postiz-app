import {
  bestTimeToPost,
  DEFAULT_BEST_HOURS,
  engagementFromAnalytics,
  extractHashtags,
  localHourToUtcMinutes,
  localWeekdayHour,
  percentile,
  pickAbWinner,
  rankHashtags,
  selectRecycleCandidates,
} from '@gitroom/helpers/utils/growth.metrics';

describe('engagementFromAnalytics', () => {
  it('sums interactions and keeps impressions apart', () => {
    expect(
      engagementFromAnalytics([
        { label: 'Impressions', data: [{ total: '1000' }] },
        { label: 'Likes', data: [{ total: '10' }] },
        { label: 'Retweets', data: [{ total: '5' }] },
        { label: 'Clicks', data: [{ total: '7' }] },
        { label: 'Comments', data: [{ total: '1' }, { total: '2' }] },
      ])
    ).toEqual({
      engagement: 18,
      impressions: 1000,
      metrics: {
        Impressions: 1000,
        Likes: 10,
        Retweets: 5,
        Clicks: 7,
        Comments: 3,
      },
    });
  });

  it('handles empty analytics', () => {
    expect(engagementFromAnalytics([])).toEqual({
      engagement: 0,
      impressions: 0,
      metrics: {},
    });
  });
});

describe('timezones', () => {
  it('reads the weekday and hour in the timezone', () => {
    // Monday 2024-01-01 23:30 UTC is Tuesday 01:30 in Jerusalem (UTC+2)
    expect(localWeekdayHour('2024-01-01T23:30:00Z', 'Asia/Jerusalem')).toEqual({
      weekday: 2,
      hour: 1,
    });
    expect(localWeekdayHour('2024-01-01T23:30:00Z', 'UTC')).toEqual({
      weekday: 1,
      hour: 23,
    });
  });

  it('converts a local hour to posting time minutes in UTC', () => {
    const winter = new Date('2024-01-15T12:00:00Z');
    expect(localHourToUtcMinutes(9, 'America/New_York', winter)).toBe(14 * 60);
    expect(localHourToUtcMinutes(1, 'Asia/Jerusalem', winter)).toBe(23 * 60);
    expect(localHourToUtcMinutes(9, 'not/a-zone', winter)).toBe(9 * 60);
  });
});

describe('bestTimeToPost', () => {
  const sample = (iso: string, engagement: number) => ({
    publishDate: iso,
    engagement,
  });

  it('falls back to the default hours with too little data', () => {
    const result = bestTimeToPost([sample('2024-01-01T10:00:00Z', 5)], 'UTC');
    expect(result.isDefault).toBe(true);
    expect(result.topSlots.map((p) => p.hour)).toEqual(DEFAULT_BEST_HOURS);
    expect(result.heatmap).toEqual([
      { weekday: 1, hour: 10, posts: 1, avgEngagement: 5 },
    ]);
  });

  it('ranks the hours by smoothed average engagement', () => {
    const samples = [
      // 18:00 is consistently good
      sample('2024-01-01T18:00:00Z', 50),
      sample('2024-01-02T18:10:00Z', 60),
      sample('2024-01-03T18:20:00Z', 55),
      // 08:00 is weak
      sample('2024-01-01T08:00:00Z', 2),
      sample('2024-01-02T08:00:00Z', 3),
      sample('2024-01-03T08:00:00Z', 1),
      // 12:00 is average
      sample('2024-01-04T12:00:00Z', 20),
      sample('2024-01-05T12:00:00Z', 25),
      // a single viral post at 03:00 should not beat 18:00
      sample('2024-01-06T03:00:00Z', 60),
      sample('2024-01-07T22:00:00Z', 5),
    ];
    const result = bestTimeToPost(samples, 'UTC', 2);
    expect(result.isDefault).toBe(false);
    expect(result.sampleSize).toBe(10);
    // sorted by hour once picked
    expect(result.topSlots.map((p) => p.hour)).toEqual([3, 18]);
    expect(result.topSlots[1].score).toBeGreaterThan(result.topSlots[0].score);
  });

  it('buckets in the timezone of the user', () => {
    const samples = [...Array(10)].map((_, i) =>
      sample(`2024-01-${String(i + 1).padStart(2, '0')}T22:00:00Z`, 10)
    );
    const result = bestTimeToPost(samples, 'Asia/Tokyo', 1);
    expect(result.topSlots[0].hour).toBe(7);
  });
});

describe('hashtags', () => {
  it('extracts unique lowercase hashtags from html', () => {
    expect(
      extractHashtags(
        '<p>Hello #Growth and #growth #2024 it&#39;s &amp; #SaaS_tips</p><p>#marketing</p> https://a.com/#anchor'
      )
    ).toEqual(['growth', 'saas_tips', 'marketing']);
  });

  it('ranks hashtags by lift against the baseline', () => {
    const { baseline, hashtags } = rankHashtags([
      { content: '#a #b', engagement: 30 },
      { content: '#a', engagement: 30 },
      { content: '#b', engagement: 0 },
      { content: '#c', engagement: 100 },
      { content: 'nothing', engagement: 0 },
    ]);
    expect(baseline).toBe(32);
    expect(hashtags.map((p) => p.tag)).toEqual(['a', 'b']);
    expect(hashtags[0]).toEqual({
      tag: 'a',
      uses: 2,
      avgEngagement: 30,
      lift: 30 / 32,
    });
  });
});

describe('pickAbWinner', () => {
  it('uses the engagement rate when every variant has impressions', () => {
    const result = pickAbWinner([
      { id: 'a', engagement: 50, impressions: 1000 },
      { id: 'b', engagement: 40, impressions: 400 },
    ]);
    expect(result.metric).toBe('rate');
    expect(result.winnerId).toBe('b');
  });

  it('uses raw engagement otherwise', () => {
    const result = pickAbWinner([
      { id: 'a', engagement: 50, impressions: 0 },
      { id: 'b', engagement: 40, impressions: 400 },
    ]);
    expect(result.metric).toBe('engagement');
    expect(result.winnerId).toBe('a');
  });

  it('has no winner on a tie or with a single measured variant', () => {
    expect(
      pickAbWinner([
        { id: 'a', engagement: 5, impressions: null },
        { id: 'b', engagement: 5, impressions: null },
      ]).winnerId
    ).toBeNull();
    expect(
      pickAbWinner([
        { id: 'a', engagement: 5, impressions: null },
        { id: 'b', engagement: null, impressions: null },
      ]).winnerId
    ).toBeNull();
  });
});

describe('recycling', () => {
  it('computes the nearest rank percentile', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 80)).toBe(8);
    expect(percentile([], 80)).toBe(0);
    expect(percentile([3], 0)).toBe(3);
  });

  it('selects old top posts that were not recycled recently', () => {
    const now = new Date('2024-06-01T00:00:00Z');
    const posts = [
      { id: 'top-old', publishDate: '2024-01-01', engagement: 100 },
      { id: 'top-new', publishDate: '2024-05-25', engagement: 120 },
      {
        id: 'top-recycled',
        publishDate: '2024-01-01',
        engagement: 110,
        lastRecycledAt: '2024-05-01',
      },
      {
        id: 'top-recycled-long-ago',
        publishDate: '2023-01-01',
        engagement: 90,
        lastRecycledAt: '2023-06-01',
      },
      ...[...Array(10)].map((_, i) => ({
        id: `low-${i}`,
        publishDate: '2024-01-01',
        engagement: i,
      })),
    ];

    expect(
      selectRecycleCandidates(posts, {
        now,
        minAgeDays: 30,
        minGapDays: 90,
        percentile: 75,
        limit: 5,
      }).map((p) => p.id)
    ).toEqual(['top-old', 'top-recycled-long-ago']);

    expect(
      selectRecycleCandidates(posts, {
        now,
        minAgeDays: 30,
        minGapDays: 90,
        percentile: 75,
        limit: 1,
      }).map((p) => p.id)
    ).toEqual(['top-old']);

    expect(
      selectRecycleCandidates(posts, {
        now,
        minAgeDays: 30,
        minGapDays: 90,
        percentile: 75,
        limit: 0,
      })
    ).toEqual([]);
  });
});
