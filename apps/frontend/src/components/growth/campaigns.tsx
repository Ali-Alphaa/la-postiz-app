'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timezoneOffset } from '@gitroom/helpers/utils/growth.metrics';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { Textarea } from '@gitroom/react/form/textarea';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import {
  errorMessage,
  useCampaign,
  useCampaignMagnets,
  useCampaigns,
  useGrowthIntegrations,
} from '@gitroom/frontend/components/growth/growth.hooks';
import { LABELS } from '@gitroom/frontend/components/growth/mix';

const TIMEZONE = 'Europe/London';
const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'bg-btnPrimary text-white',
  APPROVED: 'bg-green-500/15 text-green-400',
  NEEDS_MEDIA: 'bg-yellow-500/15 text-yellow-400',
  REJECTED: 'bg-red-500/15 text-red-400',
};
const STATUS_NAME: Record<string, string> = {
  DRAFT: 'Waiting for you',
  APPROVED: 'Scheduled',
  NEEDS_MEDIA: 'Draft in calendar, needs media',
  REJECTED: 'Rejected',
};

const ukToday = (plusDays = 0) => {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE })
    .format(new Date())
    .split('-')
    .map(Number);
  return new Date(Date.UTC(y, m - 1, d + plusDays)).toISOString().slice(0, 10);
};

// a datetime-local value holds UK wall time, the server takes an instant
const isoToUkWall = (iso: string) => {
  const date = new Date(iso);
  return new Date(date.getTime() + timezoneOffset(TIMEZONE, date) * 60000)
    .toISOString()
    .slice(0, 16);
};

const ukWallToIso = (wall: string) => {
  const [day, time] = wall.split('T');
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - timezoneOffset(TIMEZONE, new Date(guess)) * 60000;
  return new Date(
    guess - timezoneOffset(TIMEZONE, new Date(first)) * 60000
  ).toISOString();
};

const CampaignForm: FC<{ onCreated: (id: string) => void }> = ({
  onCreated,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: magnets } = useCampaignMagnets();
  const { data: integrations } = useGrowthIntegrations();
  const [values, setValues] = useState({
    name: '',
    goal: '',
    leadMagnetId: '',
    startDate: ukToday(1),
    days: '7',
    tone: '',
    notes: '',
  });
  const [channels, setChannels] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const available = useMemo(
    () => (magnets || []).filter((p: any) => !p.archivedAt),
    [magnets]
  );
  const set = (key: string, value: string) =>
    setValues((prev) => ({ ...prev, [key]: value }));

  const create = useCallback(async () => {
    setSaving(true);
    const response = await fetch('/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: values.name,
        goal: values.goal || undefined,
        leadMagnetId: values.leadMagnetId || available[0]?.id,
        startDate: values.startDate,
        days: +values.days,
        integrationIds: channels,
        tone: values.tone || undefined,
        notes: values.notes || undefined,
      }),
    });
    setSaving(false);
    if (!response.ok) {
      toaster.show(
        await errorMessage(
          response,
          t('something_went_wrong', 'Something went wrong')
        ),
        'warning'
      );
      return;
    }
    const { id } = await response.json();
    toaster.show(
      t('campaign_drafted', 'Claude drafted the campaign, review each post'),
      'success'
    );
    onCreated(id);
  }, [values, channels, available]);

  return (
    <GrowthCard className="flex flex-col gap-[12px] max-w-[640px]">
      <Input
        label={t('campaign_name', 'Campaign name')}
        name="campaignName"
        disableForm={true}
        value={values.name}
        onChange={(e) => set('name', e.target.value)}
      />
      <Input
        label={t('campaign_goal', 'Goal (optional)')}
        name="campaignGoal"
        disableForm={true}
        value={values.goal}
        onChange={(e) => set('goal', e.target.value)}
      />
      <Select
        label={t('campaign_lead_magnet', 'Lead magnet to give away')}
        name="campaignMagnet"
        disableForm={true}
        hideErrors={true}
        value={values.leadMagnetId || available[0]?.id || ''}
        onChange={(e) => set('leadMagnetId', e.target.value)}
      >
        {available.map((magnet: any) => (
          <option key={magnet.id} value={magnet.id}>
            {magnet.title}
          </option>
        ))}
      </Select>
      <div className="flex gap-[12px] flex-wrap">
        <div className="w-[200px] mobile:w-full">
          <Input
            label={t('campaign_start', 'Start date (UK)')}
            name="campaignStart"
            type="date"
            disableForm={true}
            value={values.startDate}
            onChange={(e) => set('startDate', e.target.value)}
          />
        </div>
        <div className="w-[200px] mobile:w-full">
          <Select
            label={t('campaign_days', 'Length')}
            name="campaignDays"
            disableForm={true}
            hideErrors={true}
            value={values.days}
            onChange={(e) => set('days', e.target.value)}
          >
            <option value="7">{t('campaign_7_days', '7 days')}</option>
            <option value="14">{t('campaign_14_days', '14 days')}</option>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">
          {t('campaign_channels', 'Channels')}
        </div>
        {(integrations || [])
          .filter((p) => !p.disabled)
          .map((integration) => (
            <label
              key={integration.id}
              className="flex items-center gap-[8px] text-[14px]"
            >
              <input
                type="checkbox"
                checked={channels.includes(integration.id)}
                onChange={(e) =>
                  setChannels((prev) =>
                    e.target.checked
                      ? [...prev, integration.id]
                      : prev.filter((p) => p !== integration.id)
                  )
                }
              />
              {integration.name} ({integration.identifier})
            </label>
          ))}
      </div>
      <Input
        label={t('campaign_tone', 'Tone (optional)')}
        name="campaignTone"
        disableForm={true}
        value={values.tone}
        onChange={(e) => set('tone', e.target.value)}
      />
      <Textarea
        label={t('campaign_notes', 'Anything Claude should know (optional)')}
        name="campaignNotes"
        disableForm={true}
        value={values.notes}
        onChange={(e) => set('notes', e.target.value)}
      />
      <div className="text-[12px] text-newTextColor/60">
        {t(
          'campaign_drafting_note',
          'Claude writes one post for every plan time of every channel. This takes up to a minute. Nothing is scheduled until you approve each post.'
        )}
      </div>
      <div>
        <Button
          onClick={create}
          loading={saving}
          disabled={!values.name.trim() || !channels.length || !available.length}
        >
          {t('campaign_draft_button', 'Draft the campaign with Claude')}
        </Button>
      </div>
    </GrowthCard>
  );
};

const PostCard: FC<{ post: any; reload: () => void }> = ({ post, reload }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [content, setContent] = useState<string>(post.content);
  const [when, setWhen] = useState<string>(isoToUkWall(post.publishAt));
  const [busy, setBusy] = useState('');
  const editable = ['DRAFT', 'NEEDS_MEDIA', 'REJECTED'].includes(post.status);
  const dirty =
    content !== post.content || when !== isoToUkWall(post.publishAt);

  const call = useCallback(
    async (url: string, method: string, body?: any) => {
      const response = await fetch(url, {
        method,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        toaster.show(
          await errorMessage(
            response,
            t('something_went_wrong', 'Something went wrong')
          ),
          'warning'
        );
        return null;
      }
      return response.json();
    },
    []
  );

  const save = useCallback(async () => {
    setBusy('save');
    const saved = await call(`/campaigns/posts/${post.id}`, 'PUT', {
      content,
      publishAt: ukWallToIso(when),
    });
    setBusy('');
    if (saved) {
      reload();
    }
    return !!saved;
  }, [content, when, post.id]);

  const approve = useCallback(async () => {
    if (dirty && !(await save())) {
      return;
    }
    setBusy('approve');
    const result = await call(`/campaigns/posts/${post.id}/approve`, 'POST');
    setBusy('');
    if (result) {
      toaster.show(
        result.status === 'APPROVED'
          ? t('campaign_post_scheduled', 'Scheduled')
          : result.note,
        'success'
      );
      reload();
    }
  }, [dirty, save, post.id]);

  const reject = useCallback(async () => {
    setBusy('reject');
    const result = await call(`/campaigns/posts/${post.id}/reject`, 'POST');
    setBusy('');
    if (result) {
      reload();
    }
  }, [post.id]);

  return (
    <GrowthCard className="flex flex-col gap-[10px]">
      <div className="flex gap-[10px] items-center flex-wrap">
        <span className="font-semibold text-[14px]">{post.channel}</span>
        <span className="text-[12px] text-newTextColor/60">
          {LABELS[post.pillar] || post.pillar}
        </span>
        <span
          className={clsx(
            'px-[8px] py-[2px] rounded-[6px] text-[12px]',
            STATUS_STYLE[post.status]
          )}
        >
          {t(`campaign_status_${post.status}`, STATUS_NAME[post.status])}
        </span>
        <div className="ms-auto w-[230px] mobile:w-full">
          <Input
            label={t('campaign_time_uk', 'Time (UK)')}
            name={`when-${post.id}`}
            type="datetime-local"
            disableForm={true}
            disabled={!editable}
            value={when}
            onChange={(e) => e.target.value && setWhen(e.target.value)}
          />
        </div>
      </div>
      {!!post.mediaIdea && (
        <div className="text-[13px] bg-newBgColor rounded-[8px] px-[12px] py-[8px]">
          {t('campaign_media_idea', 'Make this picture or video')}:{' '}
          {post.mediaIdea}
        </div>
      )}
      <Textarea
        label={t('campaign_post_text', 'Post text')}
        name={`content-${post.id}`}
        disableForm={true}
        disabled={!editable}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      {post.flags.map((flag: any) => (
        <div
          key={flag.code + flag.message}
          className={clsx(
            'text-[13px] px-[12px] py-[8px] rounded-[8px]',
            flag.severity === 'high' ? 'bg-red-500/10' : 'bg-yellow-500/10'
          )}
        >
          {flag.severity === 'high'
            ? t('campaign_blocked', 'Blocks approval')
            : t('campaign_warning', 'Check')}
          : {flag.message}
        </div>
      ))}
      {!!post.note && (
        <div className="text-[13px] text-newTextColor/60">{post.note}</div>
      )}
      {editable && (
        <div className="flex gap-[8px] flex-wrap">
          <Button
            onClick={approve}
            loading={busy === 'approve'}
            disabled={post.blocked && !dirty}
          >
            {t('campaign_approve', 'Approve and schedule')}
          </Button>
          {dirty && (
            <Button secondary={true} onClick={save} loading={busy === 'save'}>
              {t('save', 'Save')}
            </Button>
          )}
          {post.status !== 'REJECTED' && (
            <Button
              secondary={true}
              onClick={reject}
              loading={busy === 'reject'}
            >
              {t('campaign_reject', 'Reject')}
            </Button>
          )}
        </div>
      )}
    </GrowthCard>
  );
};

const CampaignDetail: FC<{ id: string; onBack: () => void }> = ({
  id,
  onBack,
}) => {
  const t = useT();
  const { data, mutate } = useCampaign(id);
  const { mutate: reloadList } = useCampaigns();

  const reload = useCallback(() => {
    mutate();
    reloadList();
  }, [mutate, reloadList]);

  // the posts of a day together, in UK time
  const days = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const post of data?.posts || []) {
      const day = isoToUkWall(post.publishAt).slice(0, 10);
      groups.set(day, [...(groups.get(day) || []), post]);
    }
    return [...groups.entries()];
  }, [data]);

  if (!data) {
    return null;
  }

  const counts = (status: string) =>
    data.posts.filter((p: any) => p.status === status).length;

  return (
    <>
      <div className="flex gap-[12px] items-center flex-wrap">
        <Button secondary={true} onClick={onBack}>
          &larr; {t('campaigns', 'Campaigns')}
        </Button>
        <div className="text-[18px] font-semibold">{data.name}</div>
        <div className="text-[13px] text-newTextColor/60">
          {data.magnet?.title} · {counts('APPROVED')}{' '}
          {t('campaign_scheduled_count', 'scheduled')} · {counts('DRAFT')}{' '}
          {t('campaign_waiting_count', 'waiting for you')}
        </div>
      </div>
      {days.map(([day, posts]) => (
        <div key={day} className="flex flex-col gap-[10px]">
          <div className="text-[15px] font-semibold">
            {new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'short',
              timeZone: 'UTC',
            })}
          </div>
          {posts.map((post: any) => (
            <PostCard key={post.id} post={post} reload={reload} />
          ))}
        </div>
      ))}
    </>
  );
};

export const Campaigns: FC = () => {
  const t = useT();
  const { data, mutate } = useCampaigns();
  const [openId, setOpenId] = useState('');
  const [adding, setAdding] = useState(false);

  return (
    <GrowthSection
      title={t('campaigns', 'Campaigns')}
      description={t(
        'campaigns_description',
        'Launch a lead magnet across your channels. Give Claude a brief, it drafts a post for every plan time of every channel, and nothing is scheduled until you approve each post and it passes the compliance check. The links carry the campaign name, so sign-ups are credited to it.'
      )}
    >
      {!openId && !adding && (
        <div>
          <Button onClick={() => setAdding(true)}>
            {t('campaign_new', 'New campaign')}
          </Button>
        </div>
      )}

      {adding && !openId && (
        <CampaignForm
          onCreated={(id) => {
            setAdding(false);
            setOpenId(id);
            mutate();
          }}
        />
      )}

      {!!openId && (
        <CampaignDetail
          id={openId}
          onBack={() => {
            setOpenId('');
            mutate();
          }}
        />
      )}

      {!openId && !adding && (
        <div className="flex flex-col gap-[10px]">
          {!!data && !data.length && (
            <GrowthCard className="text-[14px] text-newTextColor/60">
              {t('campaigns_none', 'No campaigns yet')}
            </GrowthCard>
          )}
          {(data || []).map((campaign: any) => (
            <GrowthCard
              key={campaign.id}
              className="flex gap-[12px] items-center flex-wrap"
            >
              <div className="flex-1 min-w-[200px]">
                <div className="text-[15px] font-semibold">{campaign.name}</div>
                <div className="text-[13px] text-newTextColor/60">
                  {campaign.total} {t('posts', 'posts')} ·{' '}
                  {campaign.counts.APPROVED || 0}{' '}
                  {t('campaign_scheduled_count', 'scheduled')} ·{' '}
                  {campaign.counts.DRAFT || 0}{' '}
                  {t('campaign_waiting_count', 'waiting for you')}
                </div>
              </div>
              <Button secondary={true} onClick={() => setOpenId(campaign.id)}>
                {t('campaign_open', 'Open')}
              </Button>
            </GrowthCard>
          ))}
        </div>
      )}

      {adding && !openId && (
        <div>
          <Button secondary={true} onClick={() => setAdding(false)}>
            {t('cancel', 'Cancel')}
          </Button>
        </div>
      )}
    </GrowthSection>
  );
};
