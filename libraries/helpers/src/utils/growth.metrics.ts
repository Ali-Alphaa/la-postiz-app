// Scoring used by the growth features (best time to post, hashtags, A/B tests,
// evergreen recycling). Everything here works on the engagement snapshots the
// growth workflow stores (PostEngagement), never on live provider calls.

// Below this amount of published posts with analytics the best time to post
// falls back to DEFAULT_BEST_HOURS (local time of the user): 9:00, 12:00 and
// 17:00 - the commonly reported engagement peaks (morning, lunch, after work).
export const MIN_POSTS_FOR_BEST_TIME = 10;
export const DEFAULT_BEST_HOURS = [9, 12, 17];
// Weight (in posts) of the overall average when averaging a slot, so an hour
// with a single viral post doesn't beat an hour that is consistently good
export const SLOT_SMOOTHING = 2;

// Labels that measure reach and not interaction. Clicks are left out as well,
// some providers report them twice (total + by type)
const reachLabel = /impression|view|reach|click/i;

export interface AnalyticsLike {
  label: string;
  data: Array<{ total: string | number }>;
}

export const engagementFromAnalytics = (analytics: AnalyticsLike[]) => {
  const metrics: Record<string, number> = {};
  for (const item of analytics || []) {
    const total = (item.data || []).reduce(
      (all, current) => all + (Number(current.total) || 0),
      0
    );
    metrics[item.label] = (metrics[item.label] || 0) + total;
  }

  return Object.entries(metrics).reduce(
    (all, [label, total]) => {
      if (reachLabel.test(label)) {
        if (/impression|view|reach/i.test(label)) {
          all.impressions = Math.max(all.impressions, total);
        }
        return all;
      }
      all.engagement += total;
      return all;
    },
    { engagement: 0, impressions: 0, metrics }
  );
};

const weekdays: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export const isValidTimezone = (timezone?: string) => {
  if (!timezone) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch (err) {
    return false;
  }
};

// weekday (0 = Sunday) and hour of a date in a timezone
export const localWeekdayHour = (date: Date | string, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(date));

  return {
    weekday: weekdays[parts.find((p) => p.type === 'weekday')!.value],
    hour: +parts.find((p) => p.type === 'hour')!.value % 24,
  };
};

// offset of a timezone in minutes (UTC+2 => 120) at an instant
export const timezoneOffset = (timezone: string, at: Date = new Date()) => {
  const parts: Record<string, number> = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimezone(timezone) ? timezone : 'UTC',
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(at)) {
    parts[type] = +value;
  }
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour % 24,
    parts.minute
  );
  return Math.round((wall - Math.floor(at.getTime() / 60000) * 60000) / 60000);
};

// Integration.postingTimes holds minutes after midnight UTC, this converts a
// local hour of the user to that format (with the current offset, the same way
// the posting times modal does it)
export const localHourToUtcMinutes = (
  hour: number,
  timezone: string,
  at: Date = new Date()
) => {
  const minutes = hour * 60 - timezoneOffset(timezone, at);
  return ((minutes % 1440) + 1440) % 1440;
};

export interface EngagementSample {
  publishDate: Date | string;
  engagement: number;
}

export interface BestTimeSlot {
  hour: number;
  posts: number;
  avgEngagement: number;
  score: number;
}

export const bestTimeToPost = (
  samples: EngagementSample[],
  timezone: string,
  top = 3
) => {
  const heatmap = [...Array(7)].map(() =>
    [...Array(24)].map(() => ({ posts: 0, total: 0 }))
  );
  const hours = [...Array(24)].map(() => ({ posts: 0, total: 0 }));

  for (const sample of samples) {
    const { weekday, hour } = localWeekdayHour(sample.publishDate, timezone);
    heatmap[weekday][hour].posts++;
    heatmap[weekday][hour].total += sample.engagement;
    hours[hour].posts++;
    hours[hour].total += sample.engagement;
  }

  const overall = samples.length
    ? samples.reduce((all, p) => all + p.engagement, 0) / samples.length
    : 0;

  const cells = heatmap.flatMap((row, weekday) =>
    row
      .map((cell, hour) => ({
        weekday,
        hour,
        posts: cell.posts,
        avgEngagement: cell.posts ? cell.total / cell.posts : 0,
      }))
      .filter((cell) => cell.posts > 0)
  );

  if (samples.length < MIN_POSTS_FOR_BEST_TIME) {
    return {
      sampleSize: samples.length,
      isDefault: true,
      heatmap: cells,
      topSlots: DEFAULT_BEST_HOURS.slice(0, top).map(
        (hour): BestTimeSlot => ({
          hour,
          posts: hours[hour].posts,
          avgEngagement: hours[hour].posts
            ? hours[hour].total / hours[hour].posts
            : 0,
          score: 0,
        })
      ),
    };
  }

  const topSlots = hours
    .map(
      (slot, hour): BestTimeSlot => ({
        hour,
        posts: slot.posts,
        avgEngagement: slot.posts ? slot.total / slot.posts : 0,
        score:
          (slot.total + SLOT_SMOOTHING * overall) /
          (slot.posts + SLOT_SMOOTHING),
      })
    )
    .filter((slot) => slot.posts > 0)
    .sort((a, b) => b.score - a.score || b.posts - a.posts || a.hour - b.hour)
    .slice(0, top)
    .sort((a, b) => a.hour - b.hour);

  return {
    sampleSize: samples.length,
    isDefault: false,
    heatmap: cells,
    topSlots,
  };
};

export const extractHashtags = (content: string): string[] => {
  const text = (content || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
  const tags = [...text.matchAll(/(?:^|[^\p{L}\p{N}_&#/])#([\p{L}\p{N}_]+)/gu)]
    .map((match) => match[1].toLowerCase())
    .filter((tag) => !/^\d+$/.test(tag));
  return [...new Set(tags)];
};

export interface HashtagScore {
  tag: string;
  uses: number;
  avgEngagement: number;
  lift: number;
}

// lift = average engagement of the posts using the hashtag / average of all
// the posts of the channel (the baseline); 1.5 means 50% above the baseline
export const rankHashtags = (
  samples: Array<{ content: string; engagement: number }>,
  minUses = 2
): { baseline: number; hashtags: HashtagScore[] } => {
  const baseline = samples.length
    ? samples.reduce((all, p) => all + p.engagement, 0) / samples.length
    : 0;

  const stats = new Map<string, { uses: number; total: number }>();
  for (const sample of samples) {
    for (const tag of extractHashtags(sample.content)) {
      const current = stats.get(tag) || { uses: 0, total: 0 };
      current.uses++;
      current.total += sample.engagement;
      stats.set(tag, current);
    }
  }

  const hashtags = [...stats.entries()]
    .filter(([, value]) => value.uses >= minUses)
    .map(([tag, value]) => {
      const avgEngagement = value.total / value.uses;
      return {
        tag,
        uses: value.uses,
        avgEngagement,
        lift: baseline > 0 ? avgEngagement / baseline : 0,
      };
    })
    .sort((a, b) => b.lift - a.lift || b.uses - a.uses);

  return { baseline, hashtags };
};

export interface AbVariantScore {
  id: string;
  engagement: number | null;
  impressions: number | null;
}

// The engagement rate is compared when every variant has impressions,
// otherwise the raw engagement. A tie or a single measured variant has no winner.
export const pickAbWinner = (variants: AbVariantScore[]) => {
  const measured = variants.filter(
    (p) => p.engagement !== null && p.engagement !== undefined
  );
  const useRate =
    measured.length > 0 && measured.every((p) => (p.impressions || 0) > 0);

  const scores = measured
    .map((p) => ({
      id: p.id,
      score: useRate ? p.engagement! / p.impressions! : p.engagement!,
    }))
    .sort((a, b) => b.score - a.score);

  const winnerId =
    scores.length >= 2 && scores[0].score > scores[1].score
      ? scores[0].id
      : null;

  return { winnerId, metric: useRate ? 'rate' : 'engagement', scores };
};

// nearest-rank percentile
export const percentile = (values: number[], p: number) => {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((Math.min(Math.max(p, 0), 100) / 100) * sorted.length);
  return sorted[Math.max(rank - 1, 0)];
};

export interface RecycleCandidate {
  id: string;
  publishDate: Date | string;
  engagement: number;
  lastRecycledAt?: Date | string | null;
}

export const selectRecycleCandidates = (
  posts: RecycleCandidate[],
  options: {
    now: Date;
    minAgeDays: number;
    minGapDays: number;
    percentile: number;
    limit: number;
  }
) => {
  if (options.limit <= 0) {
    return [] as RecycleCandidate[];
  }

  const day = 86400000;
  const threshold = percentile(
    posts.map((p) => p.engagement),
    options.percentile
  );

  return posts
    .filter(
      (p) =>
        p.engagement > 0 &&
        p.engagement >= threshold &&
        options.now.getTime() - new Date(p.publishDate).getTime() >=
          options.minAgeDays * day &&
        (!p.lastRecycledAt ||
          options.now.getTime() - new Date(p.lastRecycledAt).getTime() >=
            options.minGapDays * day)
    )
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, options.limit);
};
