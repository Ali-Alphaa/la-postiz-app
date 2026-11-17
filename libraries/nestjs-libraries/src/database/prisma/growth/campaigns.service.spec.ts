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
