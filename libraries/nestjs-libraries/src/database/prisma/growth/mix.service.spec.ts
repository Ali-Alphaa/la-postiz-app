jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/growth/growth.service',
  () => ({ GrowthService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({ PostsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/anthropic/anthropic.service', () => ({
  AnthropicService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/growth/mix.repository',
  () => ({ MixRepository: class {} })
);

import { MixService } from '@gitroom/nestjs-libraries/database/prisma/growth/mix.service';

const integration = (id: string, provider: string) => ({
  id,
  name: id,
  picture: null,
  providerIdentifier: provider,
});

const post = (over: Record<string, any>) => ({
  id: 'p',
  state: 'QUEUE',
  publishDate: new Date('2026-07-15T11:00:00Z'),
  createdAt: new Date('2026-07-15T10:00:00Z'),
  content: '<p>plain post</p>',
  image: null,
  integrationId: 'x1',
  integration: integration('x1', 'x'),
  childrenPost: [],
  label: null,
  ...over,
});

const build = (posts: any[] = [], extra: Record<string, any> = {}) => {
  const repository: any = {
    getPosts: jest.fn().mockResolvedValue(posts),
    getTargets: jest.fn().mockResolvedValue(extra.targets || []),
    getUpcomingDates: jest.fn().mockResolvedValue(extra.upcoming || []),
    getPost: jest.fn().mockResolvedValue(extra.post || null),
    upsertLabel: jest.fn().mockResolvedValue({}),
  };
  const growth: any = {
    getBestTime: jest
      .fn()
      .mockResolvedValue(extra.best || { isDefault: true, topSlots: [] }),
  };
  const postsService: any = { changeDate: jest.fn() };
  const integrations: any = {
    getIntegrationsList: jest
      .fn()
      .mockResolvedValue(extra.integrations || [integration('x1', 'x')]),
    getIntegrationById: jest
      .fn()
      .mockResolvedValue(integration('x1', 'x')),
  };
  const anthropic: any = {
    isAvailable: jest.fn().mockReturnValue(!!extra.ai),
    labelPosts: jest.fn().mockResolvedValue(extra.ai || { status: 'error' }),
  };
  return {
    repository,
    postsService,
    anthropic,
    service: new MixService(
      repository,
      growth,
      postsService,
      integrations,
      anthropic
    ),
  };
};

describe('MixService', () => {
  afterEach(() => jest.useRealTimers());

  it('reads a UK summer day from midnight to midnight UK time', async () => {
    const { service, repository } = build([
      post({ id: 'a', state: 'PUBLISHED' }),
      post({ id: 'b', state: 'ERROR' }),
      post({ id: 'c' }),
    ]);
    const day = await service.getDay('org', '2026-07-15');

    const [, from, to] = repository.getPosts.mock.calls[0];
    expect(from.toISOString()).toBe('2026-07-14T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-07-15T23:00:00.000Z');
    expect(day.totals).toEqual({ sent: 1, due: 1, failed: 1 });
    expect(day.items[0].time).toBe('12:00');
    expect(day.unlabelled).toBe(3);
  });

  it('reads a UK winter day with no offset', async () => {
    const { service, repository } = build();
    await service.getDay('org', '2026-12-01');
    const [, from] = repository.getPosts.mock.calls[0];
    expect(from.toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });

  it('derives the format from the media and the thread', async () => {
    const { service } = build([
      post({ id: 'v', image: JSON.stringify([{ path: 'a.mp4' }]) }),
      post({
        id: 'c',
        image: JSON.stringify([{ path: 'a.png' }, { path: 'b.png' }]),
      }),
      post({ id: 'i', image: JSON.stringify([{ path: 'a.png' }]) }),
      post({ id: 't', childrenPost: [{ id: 'x' }] }),
      post({ id: 'x' }),
    ]);
    const day = await service.getDay('org', '2026-07-15');
    expect(day.items.map((p) => p.format)).toEqual([
      'video',
      'carousel',
      'image',
      'thread',
      'text',
    ]);
  });

  it('starts the week on Monday and flags the plan rules', async () => {
    const offer = (id: string, date: string) =>
      post({
        id,
        publishDate: new Date(date),
        content: 'Mentorship open',
        label: { format: 'text', pillar: 'offer', cta: 'link', source: 'AUTO' },
      });
    const { service, repository } = build(
      [
        offer('o1', '2026-07-14T11:00:00Z'),
        offer('o2', '2026-07-15T11:00:00Z'),
        post({
          id: 'r',
          content: 'Friday scorecard +3R',
          label: {
            format: 'text',
            pillar: 'receipts',
            cta: 'none',
            source: 'AUTO',
          },
        }),
        post({
          id: 'h',
          integrationId: 'i1',
          integration: integration('i1', 'instagram'),
          content: '#a #b #c #d #e #f',
        }),
      ],
      { integrations: [integration('x1', 'x'), integration('i1', 'instagram')] }
    );
    const week = await service.getWeek('org', '2026-07-15');

    const [, from, to] = repository.getPosts.mock.calls[0];
    expect(from.toISOString()).toBe('2026-07-12T23:00:00.000Z');
    expect(to.toISOString()).toBe('2026-07-19T23:00:00.000Z');
    expect(week.start).toBe('2026-07-13');
    expect(week.end).toBe('2026-07-19');

    const x = week.channels.find((p) => p.integrationId === 'x1')!;
    const codes = x.flags.map((p) => p.code);
    expect(codes).toEqual(
      expect.arrayContaining(['offer_ratio', 'offer_spacing', 'results_risk_line'])
    );
    const instagram = week.channels.find((p) => p.integrationId === 'i1')!;
    expect(instagram.flags.map((p) => p.code)).toContain('hashtag_limit');
  });

  it('finds Monday across a month boundary and the clock change week', async () => {
    const { service, repository } = build();
    const month = await service.getWeek('org', '2026-07-02');
    expect(month.start).toBe('2026-06-29');
    expect(month.end).toBe('2026-07-05');

    // UK clocks go back on Sunday 25 October 2026: the week has 25 hours on Sunday
    repository.getPosts.mockClear();
    const change = await service.getWeek('org', '2026-10-25');
    const [, from, to] = repository.getPosts.mock.calls[0];
    expect(change.start).toBe('2026-10-19');
    expect(to.getTime() - from.getTime()).toBe(169 * 3600000);
  });

  it('flags a near copy of an earlier post on the same channel', async () => {
    const text =
      'My rule for the opening range is simple wait for the first fifteen minutes then trade the break';
    const { service, repository } = build([
      post({ id: 'new', content: text }),
    ]);
    repository.getPosts
      .mockResolvedValueOnce([post({ id: 'new', content: text })])
      .mockResolvedValueOnce([
        post({
          id: 'old',
          content: text,
          publishDate: new Date('2026-06-01T11:00:00Z'),
        }),
        post({ id: 'new', content: text }),
      ]);
    const week = await service.getWeek('org', '2026-07-15');
    expect(week.channels[0].flags.map((p) => p.code)).toContain('near_copy');
  });

  it('compares the weekly targets with what is sent and due', async () => {
    const { service } = build(
      [
        post({
          id: 'a',
          state: 'PUBLISHED',
          label: { format: 'text', pillar: 'rulebook', cta: 'none', source: 'AUTO' },
        }),
        post({
          id: 'b',
          label: { format: 'text', pillar: 'rulebook', cta: 'none', source: 'AUTO' },
        }),
      ],
      {
        targets: [
          { integrationId: 'x1', kind: 'pillar', value: 'rulebook', perWeek: 2 },
          { integrationId: 'x1', kind: 'pillar', value: 'receipts', perWeek: 3 },
          { integrationId: 'x1', kind: 'format', value: 'text', perWeek: 1 },
        ],
      }
    );
    const week = await service.getWeek('org', '2026-07-15');
    const status = Object.fromEntries(
      week.channels[0].goals.map((p) => [p.value, p.status])
    );
    expect(status).toEqual({ rulebook: 'met', receipts: 'short', text: 'over' });
    // the suggestion for X is 18 posts, 30% receipts and 5% offer
    const suggested = Object.fromEntries(
      week.channels[0].suggested.map((p) => [p.value, p.perWeek])
    );
    expect(Object.values(suggested).reduce((a, b) => a + b, 0)).toBe(18);
    expect(suggested.receipts).toBe(5);
    expect(suggested.offer).toBe(1);
  });

  it('labels with keywords when AI is not available', async () => {
    const { service, repository } = build([
      post({ id: 'a', content: 'Friday scorecard: every trade, net of fees' }),
      post({ id: 'b', content: 'Reply RULEBOOK and I will send the checklist' }),
    ]);
    const result = await service.labelPending('org');
    expect(result).toEqual({ labelled: 2, remaining: 0, ai: false });
    const a = repository.upsertLabel.mock.calls[0][2];
    expect(a.pillar).toBe('receipts');
    expect(a.source).toBe('RULE');
    expect(repository.upsertLabel.mock.calls[1][2].cta).toBe('comment_dm');
  });

  it('uses the labels of Claude when it answers', async () => {
    const { service, repository } = build([post({ id: 'a' })], {
      ai: {
        status: 'ok',
        data: [{ id: 'a', pillar: 'risk_psychology', cta: 'engage' }],
      },
    });
    const result = await service.labelPending('org');
    expect(result.ai).toBe(true);
    expect(repository.upsertLabel.mock.calls[0][2]).toMatchObject({
      pillar: 'risk_psychology',
      cta: 'engage',
      source: 'AUTO',
    });
  });

  it('suggests the plan times in UK time and keeps clear of queued posts', async () => {
    // Wednesday 15 July 2026, 05:00 UTC = 06:00 UK
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T05:00:00Z'));
    const { service } = build([], {
      upcoming: [{ publishDate: new Date('2026-07-15T06:15:00Z') }],
    });
    const result = await service.suggest('org', 'x1');
    expect(result.source).toBe('plan');
    // 07:15 UK is taken (06:15 UTC), the next X times of Wednesday are 10:00, 12:00
    expect(result.slots.map((p) => p.label).slice(0, 3)).toEqual([
      '2026-07-15 10:00',
      '2026-07-15 12:00',
      '2026-07-15 14:00',
    ]);
    expect(result.slots[0].date).toBe('2026-07-15T09:00:00.000Z');
  });

  it('suggests the hours of its own results outside market hours', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-01T05:00:00Z'));
    const { service } = build([], {
      best: {
        isDefault: false,
        topSlots: [{ hour: 9 }, { hour: 12 }, { hour: 17 }],
      },
    });
    const result = await service.suggest('org', 'x1');
    expect(result.source).toBe('your_data');
    expect(result.slots.map((p) => p.label).slice(0, 2)).toEqual([
      '2026-12-01 12:00',
      '2026-12-01 17:00',
    ]);
  });

  it('only moves a post that is waiting to be sent', async () => {
    const { service, postsService } = build([], {
      post: { id: 'a', state: 'PUBLISHED' },
    });
    await expect(
      service.move('org', 'a', '2999-01-01T10:00:00Z')
    ).rejects.toThrow('waiting to be sent');
    expect(postsService.changeDate).not.toHaveBeenCalled();
  });

  it('moves a queued post without requeueing it', async () => {
    const { service, postsService } = build([], {
      post: { id: 'a', state: 'QUEUE' },
    });
    await service.move('org', 'a', '2999-01-01T10:00:00Z');
    expect(postsService.changeDate).toHaveBeenCalledWith(
      'org',
      'a',
      '2999-01-01T10:00:00.000Z',
      'update'
    );
  });
});
