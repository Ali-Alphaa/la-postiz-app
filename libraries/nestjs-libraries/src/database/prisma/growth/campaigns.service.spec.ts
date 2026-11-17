jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/growth/campaigns.repository',
  () => ({ CampaignsRepository: class {} })
);
jest.mock('@gitroom/nestjs-libraries/database/prisma/growth/mix.service', () => ({
  MixService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/growth/growth.tools.service',
  () => ({ GrowthToolsService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/growth/x.voice.service',
  () => ({ XVoiceService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/lead-links/lead.links.repository',
  () => ({ LeadLinksRepository: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/anthropic/anthropic.service', () => ({
  AnthropicService: class {},
}));

import { CampaignsService } from '@gitroom/nestjs-libraries/database/prisma/growth/campaigns.service';

const future = (hours: number) => new Date(Date.now() + hours * 3600000);

const integration = (id: string, provider: string) => ({
  id,
  name: id,
  picture: null,
  providerIdentifier: provider,
  disabled: false,
  deletedAt: null,
});

const body = {
  name: 'Candlestick guide push',
  leadMagnetId: 'm1',
  startDate: '2999-01-01',
  days: 7,
  integrationIds: ['x1'],
};

const build = (extra: Record<string, any> = {}) => {
  const slots = (count: number) =>
    [...Array(count)].map((_, i) => ({
      day: Math.floor(i / 2),
      time: '12:00',
      date: future(48 + i),
    }));
  const repository: any = {
    createCampaign: jest.fn().mockResolvedValue({ id: 'c1' }),
    getPost: jest.fn().mockResolvedValue(extra.post),
    updatePost: jest.fn().mockResolvedValue({}),
    activateCampaign: jest.fn(),
    getCampaign: jest.fn(),
    ...(extra.repo || {}),
  };
  const mix: any = {
    planSlots: jest.fn().mockReturnValue(slots(extra.slots ?? 12)),
  };
  const tools: any = {
    bulkSchedule: jest
      .fn()
      .mockImplementation(async (_org: string, input: any) =>
        (extra.bulk || [{ row: 1, ok: true, postId: 'p1' }]).length
          ? {
              created: 1,
              results: [
                (extra.bulk || [])[input.type === 'schedule' ? 0 : 1] || {
                  row: 1,
                  ok: true,
                  postId: 'p1',
                },
              ],
            }
          : { created: 0, results: [] }
      ),
  };
  const leadLinks: any = {
    getMagnet: jest.fn().mockResolvedValue({
      id: 'm1',
      title: 'Candlestick Visual Guide',
      url: 'https://thesigmatrader.com/free/candles',
      description: 'A guide',
    }),
  };
  const integrations: any = {
    getIntegrationsList: jest.fn().mockResolvedValue([
      integration('x1', 'x'),
      integration('i1', 'instagram'),
    ]),
  };
  const manager: any = {
    getSocialIntegration: jest.fn().mockImplementation((id: string) => ({
      maxLength: () => (id === 'x' ? 280 : 2200),
      checkValidity: async () =>
        id === 'instagram' ? 'Should have at least one media' : true,
    })),
  };
  const anthropic: any = {
    isAvailable: jest.fn().mockReturnValue(extra.ai !== false),
    draftCampaign: jest.fn().mockImplementation(async (_brief: any, s: any[]) => ({
      status: 'ok',
      data: s.map((p) => ({
        slot: p.slot,
        content: p.role === 'offer' || p.role === 'last'
          ? `Free guide {{link}} (${p.role})`
          : `Rule ${p.slot} {{link}}`,
        mediaIdea: p.needsMedia ? 'A chart screenshot' : '',
      })),
    })),
  };
  const voice: any = { resolve: jest.fn().mockResolvedValue({}) };
  return {
    repository,
    tools,
    anthropic,
    mix,
    service: new CampaignsService(
      repository,
      mix,
      tools,
      voice,
      leadLinks,
      integrations,
      manager,
      anthropic
    ),
  };
};

const savedPost = (over: Record<string, any> = {}) => ({
  id: 'cp1',
  status: 'DRAFT',
  integrationId: 'x1',
  campaignId: 'c1',
  publishAt: future(24),
  pillar: 'rulebook',
  content: 'One rule for the opening range',
  integration: integration('x1', 'x'),
  ...over,
});

describe('CampaignsService', () => {
  it('drafts a post for every plan slot with one offer, a last reminder and a tracked link', async () => {
    const { service, repository, anthropic } = build();
    await service.createCampaign('org', body as any);

    const slots = anthropic.draftCampaign.mock.calls[0][1];
    expect(slots).toHaveLength(12);
    expect(slots[0].role).toBe('teaser');
    expect(slots.filter((p: any) => p.role === 'offer')).toHaveLength(1);
    expect(slots[11].role).toBe('last');
    expect(slots[0].maxLength).toBe(280);

    const [, data, posts] = repository.createCampaign.mock.calls[0];
    expect(data.slug).toMatch(/^candlestick-guide-push-[a-z0-9]{4}$/);
    const offer = posts.find((p: any) => p.pillar === 'offer');
    expect(offer.content).toContain('https://thesigmatrader.com/free/candles?');
    expect(offer.content).toContain(`utm_campaign=${data.slug}`);
    expect(offer.content).toContain('utm_source=x');
    // value posts never carry the link token
    expect(posts[1].content).not.toContain('{{link}}');
    expect(posts.filter((p: any) => /thesigmatrader/.test(p.content)).length).toBe(2);
  });

  it('asks channels that need media for a picture or video idea', async () => {
    const { service, repository } = build({ slots: 4 });
    await service.createCampaign('org', {
      ...body,
      integrationIds: ['i1'],
    } as any);
    const [, , posts] = repository.createCampaign.mock.calls[0];
    expect(posts.every((p: any) => p.mediaIdea === 'A chart screenshot')).toBe(
      true
    );
  });

  it('does not draft without Claude or with a start date in the past', async () => {
    await expect(
      build({ ai: false }).service.createCampaign('org', body as any)
    ).rejects.toThrow('Claude is not set up');
    await expect(
      build().service.createCampaign('org', {
        ...body,
        startDate: '2000-01-01',
      } as any)
    ).rejects.toThrow('in the past');
  });

  it('flags income claims, a results post without the risk line and an unreplaced link', () => {
    const { service } = build();
    const codes = (content: string, pillar = 'rulebook', max = 280) =>
      service.flags(content, pillar, max).map((p) => p.code);

    expect(codes('This setup is risk free and guaranteed profits')).toContain(
      'claims'
    );
    expect(codes('Friday scorecard, 3 trades', 'receipts')).toContain(
      'results_risk_line'
    );
    expect(
      codes(
        'Friday scorecard. Trading involves substantial risk of loss. Educational content only, not financial advice.',
        'receipts'
      )
    ).not.toContain('results_risk_line');
    expect(codes('Get it {{link}}')).toContain('link_token');
    expect(codes('x'.repeat(300))).toContain('too_long');
    expect(codes('')).toContain('empty');
  });

  it('blocks approving a post with a high severity flag', async () => {
    const { service, tools } = build({
      post: savedPost({ content: 'Guaranteed profits, risk free' }),
    });
    await expect(service.approvePost('org', 'cp1')).rejects.toThrow(
      'Fix this before approving'
    );
    expect(tools.bulkSchedule).not.toHaveBeenCalled();
  });

  it('schedules an approved post and links it to the calendar post', async () => {
    const { service, tools, repository } = build({ post: savedPost() });
    const result = await service.approvePost('org', 'cp1');

    expect(tools.bulkSchedule.mock.calls[0][1].type).toBe('schedule');
    expect(result.status).toBe('APPROVED');
    expect(repository.updatePost).toHaveBeenCalledWith('cp1', {
      status: 'APPROVED',
      postId: 'p1',
      note: null,
    });
    expect(repository.activateCampaign).toHaveBeenCalledWith('c1');
  });

  it('keeps a post as a calendar draft when the channel needs media', async () => {
    const { service, tools } = build({
      post: savedPost({
        integrationId: 'i1',
        integration: integration('i1', 'instagram'),
      }),
      bulk: [
        { row: 1, ok: false, error: 'Should have at least one media' },
        { row: 1, ok: true, postId: 'draft1' },
      ],
    });
    const result = await service.approvePost('org', 'cp1');

    expect(tools.bulkSchedule.mock.calls.map((p: any) => p[1].type)).toEqual([
      'schedule',
      'draft',
    ]);
    expect(result.status).toBe('NEEDS_MEDIA');
    expect(result.note).toContain('at least one media');
  });

  describe('results', () => {
    const row = (id: string, integrationId: string, provider: string, postId: string | null) => ({
      id,
      integrationId,
      integration: integration(integrationId, provider),
      publishAt: new Date('2026-11-16T12:00:00Z'),
      pillar: 'rulebook',
      content: `Post ${id}`,
      postId,
    });
    const at = (iso: string) => new Date(iso);

    const results = (over: Record<string, any> = {}) =>
      build({
        repo: {
          getCampaign: jest.fn().mockResolvedValue({
            id: 'c1',
            name: 'Guide push',
            slug: 'guide-push-ab12',
            startDate: at('2026-11-16T00:00:00Z'),
            days: 7,
            posts: [
              row('r1', 'x1', 'x', 'pa'),
              row('r2', 'i1', 'instagram', 'pb'),
              row('r3', 'x1', 'x', null),
            ],
          }),
          getConversions: jest.fn().mockResolvedValue([
            { type: 'lead', value: 0, currency: null, utmSource: 'x', postId: 'pa', createdAt: at('2026-11-16T12:05:00Z') },
            { type: 'lead', value: 0, currency: null, utmSource: 'x', postId: 'pa', createdAt: at('2026-11-16T15:00:00Z') },
            { type: 'lead', value: 0, currency: null, utmSource: 'x', postId: null, createdAt: at('2026-11-17T09:00:00Z') },
            { type: 'lead', value: 0, currency: null, utmSource: 'instagram', postId: null, createdAt: at('2026-11-17T10:00:00Z') },
            { type: 'sale', value: 50, currency: 'gbp', utmSource: 'x', postId: 'pa', createdAt: at('2026-11-17T11:00:00Z') },
          ]),
          getEngagements: jest.fn().mockResolvedValue([
            { postId: 'pa', engagement: 40, impressions: 1000 },
          ]),
          getPostStates: jest.fn().mockResolvedValue([
            { id: 'pa', state: 'PUBLISHED', releaseURL: 'https://x.com/a/1' },
            { id: 'pb', state: 'QUEUE', releaseURL: null },
          ]),
          isUtmEnabled: jest.fn().mockResolvedValue(over.utm ?? true),
          // 14 sign-ups of any kind in the 28 days before, 6 since it started
          countLeads: jest
            .fn()
            .mockImplementation(async (_org: string, from: Date) =>
              from.getTime() < at('2026-11-16T00:00:00Z').getTime() ? 14 : 6
            ),
          getBaselineEngagement: jest.fn().mockResolvedValue({
            posts: 20,
            engagement: 10,
            impressions: 400,
          }),
        },
      });

    afterEach(() => jest.useRealTimers());

    it('adds up sign-ups, reach and sales and compares them with a normal stretch', async () => {
      // two days into a 7 day campaign
      jest.useFakeTimers().setSystemTime(new Date('2026-11-18T00:00:00Z'));
      const { service } = results();
      const result = await service.getResults('org', 'c1');

      expect(result.campaign.status).toBe('RUNNING');
      expect(result.totals).toMatchObject({
        posts: 3,
        sent: 1,
        leads: 4,
        sales: 1,
        salesValue: 50,
        currencies: ['GBP'],
        impressions: 1000,
        engagement: 40,
      });
      // 14 sign-ups in the 28 days before = 0.5 a day, 6 in 2 days = 3 a day
      // (4 of them came through the campaign links)
      expect(result.baseline.leadsPerDay).toBeCloseTo(0.5);
      expect(result.baseline.campaignLeadsPerDay).toBe(3);
      expect(result.baseline.leadsLift).toBeCloseTo(5);
      // 40 engagement on the one measured post against 10 normally
      expect(result.baseline.engagementLift).toBeCloseTo(3);

      const x = result.platforms.find((p) => p.platform === 'x')!;
      expect(x).toMatchObject({ posts: 2, sent: 1, leads: 3, impressions: 1000 });
      const instagram = result.platforms.find((p) => p.platform === 'instagram')!;
      expect(instagram).toMatchObject({ posts: 1, sent: 0, leads: 1 });

      // only posts that went out or earned sign-ups are ranked, with their own leads
      expect(result.posts).toHaveLength(1);
      expect(result.posts[0]).toMatchObject({ provider: 'x', leads: 2 });
      expect(result.tracking.unattributed).toBe(2);
      expect(result.daily.slice(0, 2).map((p) => p.leads)).toEqual([2, 2]);
    });

    it('has no comparison before the campaign starts or without a normal stretch', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-10T00:00:00Z'));
      const before = await results().service.getResults('org', 'c1');
      expect(before.campaign.status).toBe('NOT_STARTED');
      expect(before.baseline.campaignLeadsPerDay).toBeNull();
      expect(before.baseline.leadsLift).toBeNull();
    });

    it('reports that utm tracking is off', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-18T00:00:00Z'));
      const { tracking } = await results({ utm: false }).service.getResults(
        'org',
        'c1'
      );
      expect(tracking.utmEnabled).toBe(false);
    });
  });

  it('refuses to approve a time that has passed and to edit an approved post', async () => {
    await expect(
      build({ post: savedPost({ publishAt: new Date(Date.now() - 1000) }) })
        .service.approvePost('org', 'cp1')
    ).rejects.toThrow('time has passed');
    await expect(
      build({ post: savedPost({ status: 'APPROVED' }) }).service.updatePost(
        'org',
        'cp1',
        { content: 'new' }
      )
    ).rejects.toThrow('already approved');
  });
});
