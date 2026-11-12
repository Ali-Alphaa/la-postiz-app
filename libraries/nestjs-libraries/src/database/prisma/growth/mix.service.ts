import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MixRepository } from '@gitroom/nestjs-libraries/database/prisma/growth/mix.repository';
import { GrowthService } from '@gitroom/nestjs-libraries/database/prisma/growth/growth.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { AnthropicService } from '@gitroom/nestjs-libraries/anthropic/anthropic.service';
import { timezoneOffset } from '@gitroom/helpers/utils/growth.metrics';
import {
  checkTradingCompliance,
  stripPostHtml,
} from '@gitroom/helpers/utils/trading.compliance';
import {
  MIX_CTAS,
  MIX_FORMATS,
  MIX_PILLARS,
  MixLabelDto,
  MixTargetDto,
} from '@gitroom/nestjs-libraries/dtos/growth/mix.dto';

// The day and the week of the schedule start at midnight UK time, on Monday
const TIMEZONE = 'Europe/London';
const DAY = 86400000;
const LABEL_BATCH = 40;
const LABEL_PAST_DAYS = 60;
const LABEL_FUTURE_DAYS = 30;
// how far back a post is compared to find near copies
const DUPLICATE_DAYS = 56;
const DUPLICATE_SIMILARITY = 0.8;
const OFFER_EVERY = 5;
const OFFER_PER_WEEK = 2;
// a channel's own results replace the plan times after this long, timing is noise before
const OWN_DATA_DAYS = 60;
const OFFER_SPACING = 3 * DAY;
const ADVANCE_SCHEDULE = DAY;
const SUGGESTIONS = 6;
const SUGGESTION_DAYS = 14;
const SUGGESTION_GAP = 30 * 60000;
const SUGGESTION_LEAD = 15 * 60000;

// Share of the posts of a week per pillar, the posting plan of the educator
const PILLAR_SHARE: Record<string, number> = {
  receipts: 30,
  rulebook: 30,
  risk_psychology: 15,
  student_stories: 10,
  behind_scenes: 10,
  offer: 5,
};

// Posts a week the plan asks of a channel, by platform
const WEEKLY_VOLUME: Record<string, number> = {
  x: 18,
  instagram: 5,
  tiktok: 5,
  youtube: 4,
};
const DEFAULT_VOLUME = 7;

// Local (UK) times to post when a channel has no engagement history yet,
// by platform and weekday (0 = Sunday). The 07:15 plan of X is the proof
// timestamp, so it never moves.
const PRIOR_TIMES: Record<string, Record<number, string[]>> = {
  x: {
    0: ['18:00'],
    1: ['07:15', '12:00', '14:00'],
    2: ['07:15', '12:00', '13:45'],
    3: ['07:15', '10:00', '12:00', '14:00'],
    4: ['07:15', '12:00', '13:45'],
    5: ['07:15', '12:00', '16:00'],
    6: ['10:00'],
  },
  instagram: {
    1: ['14:00'],
    2: ['13:00'],
    3: ['12:30'],
    4: ['12:30'],
    5: ['15:00'],
  },
  tiktok: {
    1: ['17:30'],
    2: ['14:00'],
    3: ['13:00'],
    4: ['15:00'],
    5: ['16:00'],
  },
  youtube: {
    0: ['10:00'],
    2: ['16:00'],
    4: ['16:00'],
    5: ['16:00'],
  },
};
const FALLBACK_TIMES = ['09:00', '12:00', '17:00'];
// the market hours, the audience is trading and a post gets little attention
const TRADING_HOURS = [8, 11];

// Most hashtags a platform takes
const HASHTAG_LIMIT: Record<string, number> = { instagram: 5 };

const VIDEO = /\.(mp4|mov|webm|m4v)(\?|$)/i;
const RISK_WORDING = /\brisk\b/i;
const NOT_ADVICE_WORDING = /\b(not (financial )?advice|educational)\b/i;

// when AI is not available the pillar and the call to action come from keywords
const PILLAR_RULES: Array<[string, RegExp]> = [
  [
    'offer',
    /\b(mentorship|programme|program|cohort|enrol|apply now|applications?|spots?)\b/i,
  ],
  [
    'student_stories',
    /\b(students?|journal|rule[- ]adherence|streak|process story)\b/i,
  ],
  [
    'receipts',
    /\b(recap|scorecard|statement|every trade|pre-market|my plan|fills?|drawdown|[+-]?\d+(\.\d+)?R)\b/i,
  ],
  [
    'risk_psychology',
    /\b(base rate|97%|tilt|didn'?t trade|revenge|discipline|psycholog\w*|fear)\b/i,
  ],
  ['behind_scenes', /\b(desk|my setup|routine|my day)\b/i],
  [
    'rulebook',
    /\b(rule|checklist|if\/then|opening range|position siz\w*|ninjatrader|hotkeys?)\b/i,
  ],
];

const CTA_RULES: Array<[string, RegExp]> = [
  ['comment_dm', /\b(comment|reply)\s+["“'‘]?[A-Za-z]{3,}["”'’]?\s+(and|&|to|for)\b/i],
  ['link', /https?:\/\/|\blink (in|below)|\bin (my )?bio\b/i],
  ['engage', /\?\s*$|\b(what do you think|thoughts|agree)\b/i],
];

export interface MixPost {
  id: string;
  state: string;
  publishDate: Date;
  createdAt: Date;
  content: string;
  image: string | null;
  integrationId: string;
  integration: {
    id: string;
    name: string;
    picture: string | null;
    providerIdentifier: string;
  };
  childrenPost: { id: string }[];
  label: {
    format: string;
    pillar: string;
    cta: string;
    source: string;
  } | null;
}

export interface Flag {
  code: string;
  severity: 'high' | 'medium';
  message: string;
  postIds: string[];
}

@Injectable()
export class MixService {
  constructor(
    private _mixRepository: MixRepository,
    private _growthService: GrowthService,
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _anthropicService: AnthropicService
  ) {}

  private baseProvider(identifier: string) {
    return identifier.split('-')[0].toLowerCase();
  }

  // the date and time on the wall clock of the schedule, in the UTC fields
  private wall(date: Date) {
    return new Date(date.getTime() + timezoneOffset(TIMEZONE, date) * 60000);
  }

  private localToUtc(y: number, m: number, d: number, hh = 0, mm = 0) {
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    const first = guess - timezoneOffset(TIMEZONE, new Date(guess)) * 60000;
    return new Date(guess - timezoneOffset(TIMEZONE, new Date(first)) * 60000);
  }

  private parseDate(date: string) {
    const [y, m, d] = date.split('-').map(Number);
    if (!y || !m || !d || m > 12 || d > 31) {
      throw new BadRequestException('Invalid date');
    }
    return { y, m, d };
  }

  private two(value: number) {
    return String(value).padStart(2, '0');
  }

  private dayString(date: Date) {
    const wall = this.wall(date);
    return `${wall.getUTCFullYear()}-${this.two(
      wall.getUTCMonth() + 1
    )}-${this.two(wall.getUTCDate())}`;
  }

  private derivedFormat(post: {
    image: string | null;
    childrenPost: { id: string }[];
  }) {
    let paths: string[] = [];
    try {
      paths = (JSON.parse(post.image || '[]') as Array<{ path?: string }>)
        .map((p) => p?.path || '')
        .filter(Boolean);
    } catch (err) {}

    if (paths.some((p) => VIDEO.test(p))) {
      return 'video';
    }
    if (paths.length > 1) {
      return 'carousel';
    }
    if (paths.length === 1) {
      return 'image';
    }
    return post.childrenPost.length ? 'thread' : 'text';
  }

  private ruleLabel(text: string) {
    return {
      pillar: PILLAR_RULES.find(([, rule]) => rule.test(text))?.[0] || 'other',
      cta: CTA_RULES.find(([, rule]) => rule.test(text))?.[0] || 'none',
    };
  }

  private item(post: MixPost) {
    const wall = this.wall(post.publishDate);
    return {
      id: post.id,
      state: post.state,
      date: post.publishDate.toISOString(),
      day: this.dayString(post.publishDate),
      time: `${this.two(wall.getUTCHours())}:${this.two(wall.getUTCMinutes())}`,
      integrationId: post.integrationId,
      channel: post.integration.name,
      picture: post.integration.picture,
      provider: post.integration.providerIdentifier,
      preview: stripPostHtml(post.content).slice(0, 140),
      format: post.label?.format || this.derivedFormat(post),
      pillar: post.label?.pillar || null,
      cta: post.label?.cta || null,
      source: post.label?.source || null,
    };
  }

  private bucket(state: string) {
    return state === 'PUBLISHED' ? 'sent' : state === 'ERROR' ? 'failed' : 'due';
  }

  private tally(items: Array<ReturnType<MixService['item']>>) {
    const result: Record<string, Record<string, Record<string, number>>> = {
      format: {},
      pillar: {},
      cta: {},
    };
    for (const item of items) {
      for (const kind of ['format', 'pillar', 'cta'] as const) {
        const value = item[kind] || 'unlabelled';
        result[kind][value] = result[kind][value] || {
          sent: 0,
          due: 0,
          failed: 0,
        };
        result[kind][value][this.bucket(item.state)]++;
      }
    }
    return result;
  }

  private count(items: Array<ReturnType<MixService['item']>>) {
    const total = { sent: 0, due: 0, failed: 0 };
    for (const item of items) {
      total[this.bucket(item.state)]++;
    }
    return total;
  }

  async getDay(orgId: string, date: string) {
    const { y, m, d } = this.parseDate(date);
    const posts = await this._mixRepository.getPosts(
      orgId,
      this.localToUtc(y, m, d),
      this.localToUtc(y, m, d + 1),
      ['QUEUE', 'PUBLISHED', 'ERROR']
    );
    const items = posts.map((p) => this.item(p as MixPost));

    const channels = new Map<string, any>();
    for (const item of items) {
      const channel = channels.get(item.integrationId) || {
        integrationId: item.integrationId,
        name: item.channel,
        picture: item.picture,
        provider: item.provider,
        sent: 0,
        due: 0,
        failed: 0,
      };
      channel[this.bucket(item.state)]++;
      channels.set(item.integrationId, channel);
    }

    return {
      date,
      timezone: TIMEZONE,
      items,
      totals: this.count(items),
      kinds: this.tally(items),
      channels: [...channels.values()],
      unlabelled: items.filter((p) => !p.pillar).length,
    };
  }

  private words(text: string) {
    return new Set(
      stripPostHtml(text)
        .toLowerCase()
        .split(/[^a-z0-9£$%#@]+/)
        .filter((p) => p.length > 2)
    );
  }

  private similar(a: Set<string>, b: Set<string>) {
    if (a.size < 6 || b.size < 6) {
      return false;
    }
    let shared = 0;
    for (const word of a) {
      if (b.has(word)) {
        shared++;
      }
    }
    return shared / (a.size + b.size - shared) >= DUPLICATE_SIMILARITY;
  }

  private flags(week: MixPost[], history: MixPost[]) {
    const flags: Flag[] = [];
    const add = (
      code: string,
      severity: Flag['severity'],
      message: string,
      posts: MixPost[]
    ) => {
      if (posts.length) {
        flags.push({ code, severity, message, postIds: posts.map((p) => p.id) });
      }
    };

    const offers = week.filter((p) => p.label?.pillar === 'offer');
    const value = week.filter(
      (p) => p.label && p.label.pillar !== 'offer'
    ).length;
    if (offers.length && offers.length * OFFER_EVERY > value) {
      add(
        'offer_ratio',
        'medium',
        `${offers.length} sales post${
          offers.length > 1 ? 's' : ''
        } to ${value} value post${
          value === 1 ? '' : 's'
        }, aim for one sales post to every ${OFFER_EVERY} to 7 value posts`,
        offers
      );
    }

    add(
      'offer_cap',
      'medium',
      `More than ${OFFER_PER_WEEK} sales posts in a week on this channel`,
      offers.length > OFFER_PER_WEEK ? offers : []
    );
    add(
      'claims',
      'high',
      'Wording that promises or implies profit, check it before it goes out',
      week.filter((p) =>
        checkTradingCompliance(p.content).some((f) => f.severity === 'high')
      )
    );

    const tooClose = offers.filter(
      (p, index) =>
        index > 0 &&
        p.publishDate.getTime() - offers[index - 1].publishDate.getTime() <
          OFFER_SPACING
    );
    add(
      'offer_spacing',
      'medium',
      'Sales posts less than 3 days apart read as a promo burst',
      tooClose
    );

    const receipts = week.filter((p) => p.label?.pillar === 'receipts');
    add(
      'results_risk_line',
      'high',
      'Results post without the risk line (risk of loss and educational, not financial advice)',
      receipts.filter((p) => {
        const text = stripPostHtml(p.content);
        return !RISK_WORDING.test(text) || !NOT_ADVICE_WORDING.test(text);
      })
    );
    add(
      'results_prescheduled',
      'medium',
      'Results post scheduled a day or more ahead, write results in real time',
      receipts.filter(
        (p) =>
          p.state === 'QUEUE' &&
          p.publishDate.getTime() - p.createdAt.getTime() > ADVANCE_SCHEDULE
      )
    );

    const limited = week.filter((p) => {
      const limit = HASHTAG_LIMIT[this.baseProvider(p.integration.providerIdentifier)];
      return (
        !!limit && (stripPostHtml(p.content).match(/#\w+/g) || []).length > limit
      );
    });
    add('hashtag_limit', 'medium', 'More hashtags than the platform takes', limited);

    const earlier = history.map((p) => ({ post: p, words: this.words(p.content) }));
    add(
      'near_copy',
      'high',
      'Near copy of an earlier post on the same channel, rewrite the hook and the examples',
      week.filter((p) => {
        const words = this.words(p.content);
        return earlier.some(
          (e) =>
            e.post.id !== p.id &&
            e.post.integrationId === p.integrationId &&
            e.post.publishDate < p.publishDate &&
            this.similar(words, e.words)
        );
      })
    );

    return flags;
  }

  // the posts a week the plan suggests for a channel, from the share of every pillar
  private suggestedTargets(provider: string) {
    const volume = WEEKLY_VOLUME[this.baseProvider(provider)] ?? DEFAULT_VOLUME;
    const exact = Object.entries(PILLAR_SHARE).map(([value, share]) => ({
      value,
      count: Math.floor((volume * share) / 100),
      rest: ((volume * share) / 100) % 1,
    }));
    let left = volume - exact.reduce((all, p) => all + p.count, 0);
    for (const entry of [...exact].sort((a, b) => b.rest - a.rest)) {
      if (left > 0) {
        entry.count++;
        left--;
      }
    }
    return exact
      .filter((p) => p.count > 0)
      .map((p) => ({ kind: 'pillar', value: p.value, perWeek: p.count }));
  }

  async getWeek(orgId: string, date: string) {
    const { y, m, d } = this.parseDate(date);
    const monday = d - ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7);
    const from = this.localToUtc(y, m, monday);
    const to = this.localToUtc(y, m, monday + 7);

    const [posts, history, targets] = await Promise.all([
      this._mixRepository.getPosts(orgId, from, to, [
        'QUEUE',
        'PUBLISHED',
        'ERROR',
      ]),
      this._mixRepository.getPosts(
        orgId,
        new Date(from.getTime() - DUPLICATE_DAYS * DAY),
        to,
        ['QUEUE', 'PUBLISHED']
      ),
      this._mixRepository.getTargets(orgId),
    ]);

    const items = (posts as MixPost[]).map((p) => this.item(p));
    const days = [...Array(7)].map((_, index) => {
      const day = this.dayString(this.localToUtc(y, m, monday + index, 12));
      return { date: day, ...this.count(items.filter((p) => p.day === day)) };
    });

    const channelIds = new Set([
      ...items.map((p) => p.integrationId),
      ...targets.map((p) => p.integrationId),
    ]);
    const integrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((p) => channelIds.has(p.id) && !p.deletedAt);

    const channels = integrations.map((integration) => {
      const mine = items.filter((p) => p.integrationId === integration.id);
      const kinds = this.tally(mine);
      const goals = targets
        .filter((p) => p.integrationId === integration.id)
        .map((target) => {
          const done = kinds[target.kind]?.[target.value];
          const total = (done?.sent || 0) + (done?.due || 0);
          return {
            kind: target.kind,
            value: target.value,
            perWeek: target.perWeek,
            sent: done?.sent || 0,
            due: done?.due || 0,
            status:
              total < target.perWeek
                ? 'short'
                : total === target.perWeek
                ? 'met'
                : 'over',
          };
        });
      return {
        integrationId: integration.id,
        name: integration.name,
        picture: integration.picture,
        provider: integration.providerIdentifier,
        ...this.count(mine),
        kinds,
        goals,
        suggested: this.suggestedTargets(integration.providerIdentifier),
        flags: this.flags(
          (posts as MixPost[]).filter((p) => p.integrationId === integration.id),
          (history as MixPost[]).filter((p) => p.integrationId === integration.id)
        ),
      };
    });

    return {
      timezone: TIMEZONE,
      start: days[0].date,
      end: days[6].date,
      days,
      totals: this.count(items),
      channels,
      unlabelled: items.filter((p) => !p.pillar).length,
    };
  }

  // Labels the posts around today that have no label yet, a batch at a time
  async labelPending(orgId: string) {
    const now = Date.now();
    const posts = (await this._mixRepository.getPosts(
      orgId,
      new Date(now - LABEL_PAST_DAYS * DAY),
      new Date(now + LABEL_FUTURE_DAYS * DAY),
      ['QUEUE', 'PUBLISHED', 'ERROR']
    )) as MixPost[];

    const ai = this._anthropicService.isAvailable();
    const unlabelled = posts.filter((p) => !p.label);
    // labels from keywords are redone once AI is available
    const rules = ai ? posts.filter((p) => p.label?.source === 'RULE') : [];
    const pending = [...unlabelled, ...rules];
    const batch = pending.slice(0, LABEL_BATCH);

    const result = ai
      ? await this._anthropicService.labelPosts(
          batch.map((p) => ({
            id: p.id,
            platform: p.integration.providerIdentifier,
            text: stripPostHtml(p.content).slice(0, 600),
          }))
        )
      : null;
    const answers = new Map(
      (result?.status === 'ok' ? result.data : []).map((p) => [p.id, p])
    );

    // when AI failed only the posts with no label get one from keywords
    const todo = result?.status === 'ok' ? batch : batch.filter((p) => !p.label);
    for (const post of todo) {
      const answer = answers.get(post.id);
      const rule = this.ruleLabel(stripPostHtml(post.content));
      await this._mixRepository.upsertLabel(orgId, post.id, {
        format: this.derivedFormat(post),
        pillar: answer?.pillar || rule.pillar,
        cta: answer?.cta || rule.cta,
        source: answer ? 'AUTO' : 'RULE',
      });
    }

    return {
      labelled: todo.length,
      remaining:
        result?.status === 'ok'
          ? pending.length - batch.length
          : unlabelled.length - todo.length,
      ai: result?.status === 'ok',
    };
  }

  async setLabel(orgId: string, postId: string, body: MixLabelDto) {
    const post = await this._mixRepository.getPost(orgId, postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const rule = this.ruleLabel(stripPostHtml(post.content));
    return this._mixRepository.upsertLabel(orgId, postId, {
      format:
        body.format || post.label?.format || this.derivedFormat(post),
      pillar: body.pillar || post.label?.pillar || rule.pillar,
      cta: body.cta || post.label?.cta || rule.cta,
      source: 'MANUAL',
    });
  }

  async setTargets(
    orgId: string,
    integrationId: string,
    targets: MixTargetDto[]
  ) {
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration || integration.deletedAt) {
      throw new NotFoundException('Channel not found');
    }

    const options: Record<string, string[]> = {
      format: MIX_FORMATS,
      pillar: MIX_PILLARS,
      cta: MIX_CTAS,
    };
    if (targets.some((p) => !options[p.kind]?.includes(p.value))) {
      throw new BadRequestException('Unknown target');
    }

    await this._mixRepository.replaceTargets(orgId, integrationId, targets);
    return { saved: targets.filter((p) => p.perWeek > 0).length };
  }

  // The next free times of a channel: the hours of its own best posts once
  // it has enough history, the times of the posting plan before that
  async suggest(orgId: string, integrationId: string) {
    const best = await this._growthService.getBestTime(
      orgId,
      integrationId,
      TIMEZONE
    );
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    const provider = this.baseProvider(integration?.providerIdentifier || '');
    const now = Date.now();
    const taken = (
      await this._mixRepository.getUpcomingDates(
        orgId,
        integrationId,
        new Date(now - SUGGESTION_GAP)
      )
    ).map((p) => p.publishDate.getTime());

    const firstResult = await this._mixRepository.getFirstPublished(
      orgId,
      integrationId
    );
    const enoughHistory =
      !!firstResult && now - firstResult.getTime() >= OWN_DATA_DAYS * DAY;

    const own = best.isDefault || !enoughHistory
      ? null
      : best.topSlots
          .map((p) => p.hour)
          .filter((hour) => hour < TRADING_HOURS[0] || hour >= TRADING_HOURS[1])
          .map((hour) => `${this.two(hour)}:00`);

    const today = this.wall(new Date(now));
    const slots: Array<{ date: string; label: string }> = [];
    for (let offset = 0; offset < SUGGESTION_DAYS; offset++) {
      const day = new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() + offset
        )
      );
      const times =
        own || PRIOR_TIMES[provider]?.[day.getUTCDay()] || FALLBACK_TIMES;
      for (const time of times) {
        const [hh, mm] = time.split(':').map(Number);
        const at = this.localToUtc(
          day.getUTCFullYear(),
          day.getUTCMonth() + 1,
          day.getUTCDate(),
          hh,
          mm
        );
        if (
          at.getTime() < now + SUGGESTION_LEAD ||
          taken.some((p) => Math.abs(p - at.getTime()) < SUGGESTION_GAP)
        ) {
          continue;
        }
        taken.push(at.getTime());
        slots.push({
          date: at.toISOString(),
          label: `${this.dayString(at)} ${time}`,
        });
      }
    }

    return {
      timezone: TIMEZONE,
      source: own ? 'your_data' : 'plan',
      slots: slots
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, SUGGESTIONS),
    };
  }

  // Moves a post that has not been sent, the same way as dragging it on the calendar
  async move(orgId: string, postId: string, date: string) {
    const post = await this._mixRepository.getPost(orgId, postId);
    if (!post) {
      throw new NotFoundException('Post not found');
    }
    if (post.state !== 'QUEUE') {
      throw new BadRequestException('Only a post waiting to be sent can move');
    }
    const at = new Date(date);
    if (isNaN(at.getTime()) || at.getTime() < Date.now()) {
      throw new BadRequestException('Pick a time in the future');
    }

    await this._postsService.changeDate(
      orgId,
      postId,
      at.toISOString(),
      'update'
    );
    return { date: at.toISOString() };
  }
}
