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
  useCampaignResults,
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
    playbook: 'lead_magnet_7',
    profile: 'trading',
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
        playbook: values.playbook,
        profile: values.profile,
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
        label={t('campaign_profile', 'Business')}
        name="campaignProfile"
        disableForm={true}
        hideErrors={true}
        value={values.profile}
        onChange={(e) => set('profile', e.target.value)}
      >
        <option value="trading">
          {t('campaign_profile_trading', 'Trading education')}
        </option>
        <option value="web_studio">
          {t('campaign_profile_web_studio', 'PXL Haus, websites for trades')}
        </option>
      </Select>
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
        <div className="w-[320px] mobile:w-full">
          <Select
            label={t('campaign_playbook', 'Playbook')}
            name="campaignPlaybook"
            disableForm={true}
            hideErrors={true}
            value={values.playbook}
            onChange={(e) => set('playbook', e.target.value)}
          >
            <option value="lead_magnet_7">
              {t('campaign_playbook_7', 'Lead magnet, 7 days')}
            </option>
            <option value="lead_magnet_14">
              {t('campaign_playbook_14', 'Lead magnet, 14 days')}
            </option>
          </Select>
        </div>
      </div>
      <div className="text-[12px] text-newTextColor/60 -mt-[6px]">
        {values.playbook === 'lead_magnet_14'
          ? t(
              'campaign_playbook_14_hint',
              'A teaser week of value posts, then a push week that opens with the offer and ends with one calm last reminder.'
            )
          : t(
              'campaign_playbook_7_hint',
              'A teaser, the offer at about the middle of the week and, on busy channels, a last reminder.'
            )}
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
      {editable && post.variations?.length > 1 && (
        <div className="flex gap-[8px] items-center flex-wrap">
          <span className="text-[12px] text-newTextColor/60">
            {t('campaign_layouts', 'Layout')}
          </span>
          {post.variations.map((version: string, index: number) => (
            <button
              key={index}
              type="button"
              onClick={() => setContent(version)}
              className={clsx(
                'px-[10px] py-[2px] rounded-[6px] text-[12px] border border-newTableBorder',
                content === version && 'bg-newBgColor font-semibold'
              )}
            >
              {index + 1}
            </button>
          ))}
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

const count = (value: number) =>
  new Intl.NumberFormat().format(Math.round(value));
const perDay = (value: number | null) =>
  value === null ? '-' : value.toFixed(1);
const change = (value: number | null) =>
  value === null
    ? null
    : `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`;

const Stat: FC<{ label: string; value: string; hint?: string }> = ({
  label,
  value,
  hint,
}) => (
  <GrowthCard className="flex flex-col gap-[4px] !p-[14px]">
    <div className="text-[12px] text-newTextColor/60">{label}</div>
    <div className="text-[22px] font-semibold tabular-nums">{value}</div>
    {!!hint && <div className="text-[12px] text-newTextColor/60">{hint}</div>}
  </GrowthCard>
);

const Comparison: FC<{
  title: string;
  now: string;
  normal: string;
  lift: number | null;
  missing: string;
}> = ({ title, now, normal, lift, missing }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[2px]">
      <div className="text-[13px] text-newTextColor/60">{title}</div>
      {lift === null ? (
        <div className="text-[14px]">{missing}</div>
      ) : (
        <div className="text-[14px]">
          <span className="font-semibold tabular-nums">{now}</span>{' '}
          {t('campaign_against', 'against')}{' '}
          <span className="tabular-nums">{normal}</span>{' '}
          {t('campaign_normally', 'normally')}{' '}
          <span
            className={clsx(
              'font-semibold tabular-nums',
              lift >= 0 ? 'text-green-400' : 'text-red-400'
            )}
          >
            ({change(lift)})
          </span>
        </div>
      )}
    </div>
  );
};

const Results: FC<{ id: string }> = ({ id }) => {
  const t = useT();
  const { data } = useCampaignResults(id);

  if (!data) {
    return null;
  }

  const { totals, baseline, tracking } = data;
  const maxDaily = Math.max(1, ...data.daily.map((p: any) => p.leads));
  const status: Record<string, string> = {
    NOT_SCHEDULED: t(
      'campaign_results_not_scheduled',
      'Nothing is scheduled yet, approve posts to start the campaign.'
    ),
    NOT_STARTED: t(
      'campaign_results_not_started',
      'The campaign has not started yet.'
    ),
    RUNNING: t('campaign_results_running', 'The campaign is running.'),
    ENDED: t(
      'campaign_results_ended',
      'The campaign has ended, sign-ups after the last post still count for 3 days.'
    ),
  };

  return (
    <>
      <div className="text-[14px] text-newTextColor/60">
        {status[data.campaign.status]}
      </div>

      {!tracking.utmEnabled && (
        <div className="text-[13px] px-[12px] py-[8px] rounded-[8px] bg-yellow-500/10">
          {t(
            'campaign_results_utm_off',
            'UTM tracking links are off (Growth, UTM tracking links), so sign-ups cannot be credited to single posts. They still count for the campaign through its link.'
          )}
        </div>
      )}
      {tracking.utmEnabled && tracking.unattributed > 0 && (
        <div className="text-[13px] px-[12px] py-[8px] rounded-[8px] bg-yellow-500/10">
          {t(
            'campaign_results_unattributed',
            '{{count}} sign-ups came through the campaign link without a post, for example from a copied link.',
            { count: tracking.unattributed }
          )}
        </div>
      )}

      <div className="grid grid-cols-5 mobile:grid-cols-2 gap-[10px]">
        <Stat
          label={t('campaign_results_signups', 'Sign-ups')}
          value={count(totals.leads)}
        />
        <Stat
          label={t('campaign_results_sent', 'Posts sent')}
          value={`${totals.sent} / ${totals.posts}`}
          hint={
            totals.failed
              ? t('campaign_results_failed', '{{count}} failed', {
                  count: totals.failed,
                })
              : undefined
          }
        />
        <Stat
          label={t('campaign_results_impressions', 'Impressions')}
          value={count(totals.impressions)}
          hint={t('campaign_results_measured', '{{count}} posts measured', {
            count: totals.measuredPosts,
          })}
        />
        <Stat
          label={t('campaign_results_engagement', 'Engagement')}
          value={count(totals.engagement)}
        />
        <Stat
          label={t('campaign_results_sales', 'Sales')}
          value={
            totals.sales
              ? `${totals.sales} (${count(totals.salesValue)} ${totals.currencies.join('/')})`
              : '0'
          }
          hint={
            totals.sales
              ? undefined
              : t(
                  'campaign_results_sales_hint',
                  'Shows once sales are reported to Postiz'
                )
          }
        />
      </div>

      <GrowthCard className="flex flex-col gap-[12px]">
        <div className="text-[15px] font-semibold">
          {t('campaign_results_vs_normal', 'Against a normal stretch')}
        </div>
        <Comparison
          title={t(
            'campaign_results_signups_day',
            'Sign-ups a day, from any source'
          )}
          now={perDay(baseline.campaignLeadsPerDay)}
          normal={perDay(baseline.leadsPerDay)}
          lift={baseline.leadsLift}
          missing={t(
            'campaign_results_cannot_compare',
            'Not enough to compare yet: the campaign has not started, or there were no sign-ups in the 4 weeks before it.'
          )}
        />
        <Comparison
          title={t('campaign_results_engagement_post', 'Engagement per post')}
          now={perDay(baseline.campaignEngagementPerPost)}
          normal={perDay(baseline.engagementPerPost)}
          lift={baseline.engagementLift}
          missing={t(
            'campaign_results_cannot_compare_posts',
            'Not enough to compare yet: no post of the campaign has analytics yet, or there were none in the 4 weeks before it. Refresh analytics in Best time to post.'
          )}
        />
      </GrowthCard>

      <GrowthCard className="overflow-x-auto">
        <div className="text-[15px] font-semibold mb-[8px]">
          {t('campaign_results_platforms', 'By platform')}
        </div>
        <table className="w-full text-[13px] min-w-[480px]">
          <thead className="text-newTextColor/60">
            <tr>
              <th className="text-start font-normal">
                {t('campaign_results_platform', 'Platform')}
              </th>
              <th className="text-end font-normal">
                {t('campaign_results_sent', 'Posts sent')}
              </th>
              <th className="text-end font-normal">
                {t('campaign_results_signups', 'Sign-ups')}
              </th>
              <th className="text-end font-normal">
                {t('campaign_results_impressions', 'Impressions')}
              </th>
              <th className="text-end font-normal">
                {t('campaign_results_engagement', 'Engagement')}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.platforms.map((row: any) => (
              <tr key={row.platform}>
                <td className="py-[3px]">{row.platform}</td>
                <td className="text-end tabular-nums">
                  {row.sent} / {row.posts}
                </td>
                <td className="text-end tabular-nums">{row.leads}</td>
                <td className="text-end tabular-nums">
                  {count(row.impressions)}
                </td>
                <td className="text-end tabular-nums">
                  {count(row.engagement)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </GrowthCard>

      <GrowthCard className="overflow-x-auto">
        <div className="text-[15px] font-semibold mb-[8px]">
          {t('campaign_results_top_posts', 'Posts that brought the most sign-ups')}
        </div>
        {!data.posts.length && (
          <div className="text-[13px] text-newTextColor/60">
            {t('campaign_results_no_posts', 'No post has gone out yet.')}
          </div>
        )}
        {!!data.posts.length && (
          <table className="w-full text-[13px] min-w-[560px]">
            <thead className="text-newTextColor/60">
              <tr>
                <th className="text-start font-normal">
                  {t('campaign_results_post', 'Post')}
                </th>
                <th className="text-end font-normal">
                  {t('campaign_results_signups', 'Sign-ups')}
                </th>
                <th className="text-end font-normal">
                  {t('campaign_results_impressions', 'Impressions')}
                </th>
                <th className="text-end font-normal">
                  {t('campaign_results_engagement', 'Engagement')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.posts.map((post: any) => (
                <tr key={post.id}>
                  <td className="py-[3px]">
                    <div>
                      {post.releaseURL ? (
                        <a
                          href={post.releaseURL}
                          target="_blank"
                          rel="noreferrer"
                          className="underline"
                        >
                          {post.channel}
                        </a>
                      ) : (
                        post.channel
                      )}{' '}
                      <span className="text-newTextColor/60">
                        {post.preview}
                      </span>
                    </div>
                  </td>
                  <td className="text-end tabular-nums">{post.leads}</td>
                  <td className="text-end tabular-nums">
                    {count(post.impressions)}
                  </td>
                  <td className="text-end tabular-nums">
                    {count(post.engagement)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </GrowthCard>

      <GrowthCard className="flex flex-col gap-[6px]">
        <div className="text-[15px] font-semibold">
          {t('campaign_results_daily', 'Sign-ups a day (UK time)')}
        </div>
        {data.daily.map((day: any) => (
          <div key={day.date} className="flex items-center gap-[10px] text-[13px]">
            <div className="w-[88px] tabular-nums text-newTextColor/60">
              {day.date}
            </div>
            <div className="flex-1 h-[10px] rounded-[4px] bg-newBgColor overflow-hidden">
              <div
                className="h-full bg-btnPrimary"
                style={{ width: `${(day.leads / maxDaily) * 100}%` }}
              />
            </div>
            <div className="w-[28px] text-end tabular-nums">{day.leads}</div>
          </div>
        ))}
      </GrowthCard>
    </>
  );
};

const CampaignDetail: FC<{
  id: string;
  onBack: () => void;
  onDuplicated: (id: string) => void;
}> = ({ id, onBack, onDuplicated }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useCampaign(id);
  const { mutate: reloadList } = useCampaigns();
  const [view, setView] = useState<'posts' | 'results'>('posts');
  const [duplicating, setDuplicating] = useState(false);
  const [startDate, setStartDate] = useState(ukToday(1));
  const [working, setWorking] = useState('');

  const reload = useCallback(() => {
    mutate();
    reloadList();
  }, [mutate, reloadList]);

  const act = useCallback(
    async (kind: 'archive' | 'unarchive' | 'duplicate') => {
      setWorking(kind);
      const response = await fetch(`/campaigns/${id}/${kind}`, {
        method: 'POST',
        ...(kind === 'duplicate' ? { body: JSON.stringify({ startDate }) } : {}),
      });
      setWorking('');
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
      const result = await response.json();
      if (kind === 'duplicate') {
        toaster.show(
          t(
            'campaign_duplicated',
            'Claude drafted the new campaign, review each post'
          ),
          'success'
        );
        setDuplicating(false);
        setView('posts');
        onDuplicated(result.id);
        return;
      }
      toaster.show(
        kind === 'archive'
          ? t('campaign_archived', 'Campaign archived')
          : t('campaign_unarchived', 'Campaign restored'),
        'success'
      );
      if (kind === 'archive') {
        onBack();
        return;
      }
      reload();
    },
    [id, startDate, reload]
  );

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
        <div className="flex gap-[8px] ms-auto">
          <Button
            secondary={view !== 'posts'}
            onClick={() => setView('posts')}
          >
            {t('campaign_view_posts', 'Posts')}
          </Button>
          <Button
            secondary={view !== 'results'}
            onClick={() => setView('results')}
          >
            {t('campaign_view_results', 'Results')}
          </Button>
          <Button
            secondary={true}
            onClick={() => setDuplicating(!duplicating)}
          >
            {t('campaign_duplicate', 'Run it again')}
          </Button>
          {data.status === 'ARCHIVED' ? (
            <Button
              secondary={true}
              onClick={() => act('unarchive')}
              loading={working === 'unarchive'}
            >
              {t('campaign_unarchive', 'Restore')}
            </Button>
          ) : (
            <Button
              secondary={true}
              onClick={() => act('archive')}
              loading={working === 'archive'}
            >
              {t('campaign_archive', 'Archive')}
            </Button>
          )}
        </div>
      </div>
      {duplicating && (
        <GrowthCard className="flex gap-[12px] items-end flex-wrap">
          <div className="w-[200px] mobile:w-full">
            <Input
              label={t('campaign_start', 'Start date (UK)')}
              name="duplicateStart"
              type="date"
              disableForm={true}
              value={startDate}
              onChange={(e) => e.target.value && setStartDate(e.target.value)}
            />
          </div>
          <Button
            onClick={() => act('duplicate')}
            loading={working === 'duplicate'}
          >
            {t('campaign_duplicate_button', 'Draft it again with Claude')}
          </Button>
          <div className="text-[12px] text-newTextColor/60 basis-full">
            {t(
              'campaign_duplicate_hint',
              'Same lead magnet, playbook and channels on the new date. Claude writes new posts, nothing is copied.'
            )}
          </div>
        </GrowthCard>
      )}
      {view === 'results' && <Results id={id} />}
      {(view === 'posts' ? days : []).map(([day, posts]) => (
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
  const [showArchived, setShowArchived] = useState(false);
  const archivedCount = (data || []).filter(
    (p: any) => p.status === 'ARCHIVED'
  ).length;
  const visible = (data || []).filter((p: any) =>
    showArchived ? p.status === 'ARCHIVED' : p.status !== 'ARCHIVED'
  );

  return (
    <GrowthSection
      title={t('campaigns', 'Campaigns')}
      description={t(
        'campaigns_description',
        'Launch a lead magnet across your channels. Give Claude a brief, it drafts a post for every plan time of every channel, and nothing is scheduled until you approve each post and it passes the compliance check. The links carry the campaign name, so sign-ups are credited to it.'
      )}
    >
      {!openId && !adding && (
        <div className="flex gap-[8px] flex-wrap">
          <Button onClick={() => setAdding(true)}>
            {t('campaign_new', 'New campaign')}
          </Button>
          {(!!archivedCount || showArchived) && (
            <Button
              secondary={true}
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived
                ? t('campaign_hide_archived', 'Back to campaigns')
                : t('campaign_show_archived', 'Archived ({{count}})', {
                    count: archivedCount,
                  })}
            </Button>
          )}
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
          onDuplicated={(newId) => {
            setOpenId(newId);
            mutate();
          }}
        />
      )}

      {!openId && !adding && (
        <div className="flex flex-col gap-[10px]">
          {!!data && !visible.length && (
            <GrowthCard className="text-[14px] text-newTextColor/60">
              {t('campaigns_none', 'No campaigns yet')}
            </GrowthCard>
          )}
          {visible.map((campaign: any) => (
            <GrowthCard
              key={campaign.id}
              className="flex gap-[12px] items-center flex-wrap"
            >
              <div className="flex-1 min-w-[200px]">
                <div className="text-[15px] font-semibold">{campaign.name}</div>
                <div className="text-[13px] text-newTextColor/60">
                  {campaign.profile === 'web_studio' &&
                    `${t('campaign_profile_web_studio_short', 'PXL Haus')} · `}
                  {campaign.playbook === 'lead_magnet_14'
                    ? t('campaign_playbook_14', 'Lead magnet, 14 days')
                    : t('campaign_playbook_7', 'Lead magnet, 7 days')}{' '}
                  · {campaign.total} {t('posts', 'posts')} ·{' '}
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
