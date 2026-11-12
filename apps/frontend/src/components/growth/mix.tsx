'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import {
  errorMessage,
  useMixDay,
  useMixSuggest,
  useMixWeek,
} from '@gitroom/frontend/components/growth/growth.hooks';

const FORMATS = ['text', 'thread', 'image', 'carousel', 'video'];
const PILLARS = [
  'receipts',
  'rulebook',
  'risk_psychology',
  'student_stories',
  'behind_scenes',
  'offer',
  'other',
];
const CTAS = ['none', 'engage', 'comment_dm', 'link'];
const OPTIONS: Record<string, string[]> = {
  format: FORMATS,
  pillar: PILLARS,
  cta: CTAS,
};
const LABELS: Record<string, string> = {
  text: 'Text',
  thread: 'Thread',
  image: 'Image',
  carousel: 'Carousel',
  video: 'Video / reel',
  receipts: 'Receipts (proof)',
  rulebook: 'Rulebook (education)',
  risk_psychology: 'Risk & psychology',
  student_stories: 'Student stories',
  behind_scenes: 'Behind the scenes',
  offer: 'Offer',
  other: 'Other',
  none: 'No call to action',
  engage: 'Asks for replies',
  comment_dm: 'Comment to get it',
  link: 'Link / bio',
  unlabelled: 'Unlabelled',
};
const KIND_TITLES: Record<string, string> = {
  format: 'Format',
  pillar: 'Content pillar',
  cta: 'Call to action',
};
const STATE_STYLE: Record<string, string> = {
  PUBLISHED: 'bg-green-500/15 text-green-400',
  QUEUE: 'bg-[#612BD3]/15 text-[#a78bfa]',
  ERROR: 'bg-red-500/15 text-red-400',
};
const STATE_NAME: Record<string, string> = {
  PUBLISHED: 'Sent',
  QUEUE: 'Due',
  ERROR: 'Failed',
};

const ukToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(
    new Date()
  );

const shiftDate = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

const Chip: FC<{ label: string; value: number; tone: string }> = ({
  label,
  value,
  tone,
}) => (
  <div className={clsx('px-[14px] py-[8px] rounded-[8px] text-[14px]', tone)}>
    <span className="font-semibold tabular-nums text-[18px] me-[6px]">
      {value}
    </span>
    {label}
  </div>
);

const Suggestions: FC<{
  integrationId: string;
  onPick: (date: string) => void;
}> = ({ integrationId, onPick }) => {
  const t = useT();
  const { data, isLoading } = useMixSuggest(integrationId);
  return (
    <div className="flex gap-[8px] flex-wrap items-center">
      {isLoading && <div className="text-[13px]">{t('loading', 'Loading')}...</div>}
      {(data?.slots || []).map((slot: any) => (
        <button
          key={slot.date}
          className="h-[32px] px-[12px] rounded-[8px] bg-[#612BD3]/10 border border-[#612BD3]/40 text-[13px] tabular-nums"
          onClick={() => onPick(slot.date)}
        >
          {slot.label}
        </button>
      ))}
      {!!data && (
        <div className="text-[12px] text-newTextColor/60">
          {data.source === 'your_data'
            ? t('mix_from_your_data', 'From your own results (UK time)')
            : t(
                'mix_from_plan',
                'From the posting plan, until 10 posts have results (UK time)'
              )}
        </div>
      )}
    </div>
  );
};

const LabelSelect: FC<{
  kind: string;
  value: string | null;
  onChange: (value: string) => void;
}> = ({ kind, value, onChange }) => (
  <select
    className="h-[32px] bg-newBgColorInner px-[8px] outline-none border-newTableBorder border rounded-[8px] text-[13px]"
    value={value || ''}
    onChange={(e) => onChange(e.target.value)}
  >
    {!value && <option value="">{LABELS.unlabelled}</option>}
    {OPTIONS[kind].map((option) => (
      <option key={option} value={option}>
        {LABELS[option]}
      </option>
    ))}
  </select>
);

const Tally: FC<{ kinds: Record<string, Record<string, any>> }> = ({
  kinds,
}) => {
  const t = useT();
  return (
    <div className="grid grid-cols-3 mobile:grid-cols-1 gap-[12px]">
      {Object.keys(OPTIONS).map((kind) => (
        <GrowthCard key={kind}>
          <div className="text-[15px] font-semibold mb-[8px]">
            {KIND_TITLES[kind]}
          </div>
          <table className="w-full text-[13px]">
            <thead className="text-newTextColor/60 text-start">
              <tr>
                <th className="text-start font-normal" />
                <th className="text-end font-normal">{t('mix_sent', 'Sent')}</th>
                <th className="text-end font-normal">{t('mix_due', 'Due')}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(kinds[kind] || {}).map(([value, count]) => (
                <tr key={value}>
                  <td className="py-[2px]">{LABELS[value] || value}</td>
                  <td className="text-end tabular-nums">{count.sent}</td>
                  <td className="text-end tabular-nums">{count.due}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </GrowthCard>
      ))}
    </div>
  );
};

const Today: FC<{ mutate: () => void; data: any }> = ({ data, mutate }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [moving, setMoving] = useState('');

  const send = useCallback(
    async (url: string, method: string, body: any, done: string) => {
      const response = await fetch(url, {
        method,
        body: JSON.stringify(body),
      });
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
      toaster.show(done, 'success');
      setMoving('');
      mutate();
    },
    [mutate]
  );

  if (!data) {
    return null;
  }

  return (
    <>
      <div className="flex gap-[12px] flex-wrap">
        <Chip
          label={t('mix_sent', 'Sent')}
          value={data.totals.sent}
          tone="bg-green-500/10"
        />
        <Chip
          label={t('mix_due', 'Due')}
          value={data.totals.due}
          tone="bg-[#612BD3]/10"
        />
        <Chip
          label={t('mix_failed', 'Failed')}
          value={data.totals.failed}
          tone="bg-red-500/10"
        />
      </div>

      <Tally kinds={data.kinds} />

      <GrowthCard>
        <div className="text-[15px] font-semibold mb-[12px]">
          {t('mix_timeline', 'Timeline')} ({data.timezone})
        </div>
        {!data.items.length && (
          <div className="text-[14px] text-newTextColor/60">
            {t('mix_nothing_today', 'No posts on this day')}
          </div>
        )}
        <div className="flex flex-col gap-[12px]">
          {data.items.map((item: any) => (
            <div
              key={item.id}
              className="flex flex-col gap-[8px] border-b border-newTableBorder pb-[12px] last:border-0 last:pb-0"
            >
              <div className="flex gap-[10px] items-center flex-wrap">
                <span className="tabular-nums font-semibold w-[48px]">
                  {item.time}
                </span>
                <span
                  className={clsx(
                    'px-[8px] py-[2px] rounded-[6px] text-[12px]',
                    STATE_STYLE[item.state]
                  )}
                >
                  {STATE_NAME[item.state]}
                </span>
                <span className="text-[13px]">{item.channel}</span>
                <span className="text-[13px] text-newTextColor/60 truncate flex-1 min-w-[160px]">
                  {item.preview}
                </span>
              </div>
              <div className="flex gap-[8px] flex-wrap items-center ps-[58px] mobile:ps-0">
                {Object.keys(OPTIONS).map((kind) => (
                  <LabelSelect
                    key={kind}
                    kind={kind}
                    value={(item as any)[kind]}
                    onChange={(value) =>
                      send(
                        `/growth/mix/posts/${item.id}/label`,
                        'PUT',
                        { [kind]: value },
                        t('mix_label_saved', 'Label saved')
                      )
                    }
                  />
                ))}
                {item.state === 'QUEUE' && (
                  <Button
                    secondary={true}
                    onClick={() => setMoving(moving === item.id ? '' : item.id)}
                  >
                    {t('mix_move_best_time', 'Move to best time')}
                  </Button>
                )}
              </div>
              {moving === item.id && (
                <div className="ps-[58px] mobile:ps-0">
                  <Suggestions
                    integrationId={item.integrationId}
                    onPick={(date) =>
                      send(
                        `/growth/mix/posts/${item.id}/move`,
                        'POST',
                        { date },
                        t('mix_post_moved', 'The post was moved')
                      )
                    }
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </GrowthCard>
    </>
  );
};

const TargetEditor: FC<{ channel: any; onSaved: () => void }> = ({
  channel,
  onSaved,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const key = (kind: string, value: string) => `${kind}:${value}`;
  const [values, setValues] = useState<Record<string, number>>(() =>
    Object.fromEntries(
      channel.goals.map((p: any) => [key(p.kind, p.value), p.perWeek])
    )
  );
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    const response = await fetch(`/growth/mix/targets/${channel.integrationId}`, {
      method: 'PUT',
      body: JSON.stringify({
        targets: Object.entries(values).map(([name, perWeek]) => {
          const [kind, value] = name.split(':');
          return { kind, value, perWeek: perWeek || 0 };
        }),
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
    toaster.show(t('mix_targets_saved', 'Weekly targets saved'), 'success');
    onSaved();
  }, [values, channel.integrationId]);

  return (
    <div className="flex flex-col gap-[12px] mt-[12px]">
      <div className="grid grid-cols-3 mobile:grid-cols-1 gap-[12px]">
        {Object.keys(OPTIONS).map((kind) => (
          <div key={kind} className="flex flex-col gap-[6px]">
            <div className="text-[13px] font-semibold">{KIND_TITLES[kind]}</div>
            {OPTIONS[kind].map((value) => (
              <label
                key={value}
                className="flex justify-between items-center text-[13px] gap-[8px]"
              >
                {LABELS[value]}
                <input
                  type="number"
                  min={0}
                  max={200}
                  className="w-[64px] h-[30px] bg-newBgColorInner px-[8px] outline-none border-newTableBorder border rounded-[8px] text-end"
                  value={values[key(kind, value)] ?? ''}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [key(kind, value)]: Math.max(
                        0,
                        Math.min(200, +e.target.value || 0)
                      ),
                    })
                  }
                />
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-[8px] flex-wrap">
        <Button
          secondary={true}
          onClick={() =>
            setValues(
              Object.fromEntries(
                channel.suggested.map((p: any) => [
                  key(p.kind, p.value),
                  p.perWeek,
                ])
              )
            )
          }
        >
          {t('mix_use_suggested', 'Use the suggested pillar mix')}
        </Button>
        <Button onClick={save} loading={saving}>
          {t('save', 'Save')}
        </Button>
      </div>
    </div>
  );
};

const Week: FC<{ data: any; mutate: () => void }> = ({ data, mutate }) => {
  const t = useT();
  const [editing, setEditing] = useState('');

  if (!data) {
    return null;
  }

  return (
    <>
      <div className="grid grid-cols-7 mobile:grid-cols-2 gap-[8px]">
        {data.days.map((day: any) => (
          <GrowthCard key={day.date} className="!p-[12px]">
            <div className="text-[13px] font-semibold">
              {new Date(day.date + 'T12:00:00Z').toLocaleDateString(undefined, {
                weekday: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              })}
            </div>
            <div className="text-[12px] text-newTextColor/60 mt-[4px]">
              {day.sent} {t('mix_sent', 'sent')} · {day.due} {t('mix_due', 'due')}
              {!!day.failed && ` · ${day.failed} ${t('mix_failed', 'failed')}`}
            </div>
          </GrowthCard>
        ))}
      </div>

      {!data.channels.length && (
        <GrowthCard className="text-[14px] text-newTextColor/60">
          {t('mix_nothing_week', 'No posts this week')}
        </GrowthCard>
      )}

      {data.channels.map((channel: any) => (
        <GrowthCard key={channel.integrationId}>
          <div className="flex justify-between gap-[12px] flex-wrap items-center">
            <div className="text-[16px] font-semibold">{channel.name}</div>
            <div className="text-[13px] text-newTextColor/60">
              {channel.sent} {t('mix_sent', 'sent')} · {channel.due}{' '}
              {t('mix_due', 'due')}
              {!!channel.failed && ` · ${channel.failed} ${t('mix_failed', 'failed')}`}
            </div>
          </div>

          {!!channel.flags.length && (
            <div className="flex flex-col gap-[6px] mt-[12px]">
              {channel.flags.map((flag: any) => (
                <div
                  key={flag.code}
                  className={clsx(
                    'text-[13px] px-[12px] py-[8px] rounded-[8px]',
                    flag.severity === 'high'
                      ? 'bg-red-500/10'
                      : 'bg-yellow-500/10'
                  )}
                >
                  {flag.message} ({flag.postIds.length})
                </div>
              ))}
            </div>
          )}

          {!!channel.goals.length && (
            <table className="w-full text-[13px] mt-[12px]">
              <thead className="text-newTextColor/60">
                <tr>
                  <th className="text-start font-normal" />
                  <th className="text-end font-normal">
                    {t('mix_target', 'Target')}
                  </th>
                  <th className="text-end font-normal">{t('mix_sent', 'Sent')}</th>
                  <th className="text-end font-normal">{t('mix_due', 'Due')}</th>
                  <th className="text-end font-normal" />
                </tr>
              </thead>
              <tbody>
                {channel.goals.map((goal: any) => (
                  <tr key={goal.kind + goal.value}>
                    <td className="py-[2px]">
                      {LABELS[goal.value] || goal.value}
                    </td>
                    <td className="text-end tabular-nums">{goal.perWeek}</td>
                    <td className="text-end tabular-nums">{goal.sent}</td>
                    <td className="text-end tabular-nums">{goal.due}</td>
                    <td
                      className={clsx(
                        'text-end',
                        goal.status === 'short' && 'text-yellow-400',
                        goal.status === 'over' && 'text-red-400',
                        goal.status === 'met' && 'text-green-400'
                      )}
                    >
                      {goal.status === 'short'
                        ? t('mix_short', 'Needs more')
                        : goal.status === 'over'
                        ? t('mix_over', 'Too many')
                        : t('mix_met', 'On target')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!channel.goals.length && (
            <div className="text-[13px] text-newTextColor/60 mt-[12px]">
              {t(
                'mix_no_targets',
                'No weekly targets for this channel yet, set them to see the gaps.'
              )}
            </div>
          )}

          <div className="mt-[12px]">
            <Button
              secondary={true}
              onClick={() =>
                setEditing(
                  editing === channel.integrationId ? '' : channel.integrationId
                )
              }
            >
              {t('mix_edit_targets', 'Edit weekly targets')}
            </Button>
          </div>
          {editing === channel.integrationId && (
            <TargetEditor
              key={channel.integrationId}
              channel={channel}
              onSaved={() => {
                setEditing('');
                mutate();
              }}
            />
          )}
        </GrowthCard>
      ))}
    </>
  );
};

export const ScheduleMix: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const [view, setView] = useState<'today' | 'week'>('today');
  const [date, setDate] = useState(ukToday);
  const [labelling, setLabelling] = useState(false);
  const attempted = useRef(new Set<string>());
  const day = useMixDay(date);
  const week = useMixWeek(date);

  const reload = useCallback(() => {
    day.mutate();
    week.mutate();
  }, [day.mutate, week.mutate]);

  const unlabelled = (view === 'today' ? day.data : week.data)?.unlabelled || 0;

  // posts get their pillar and call to action once, the first time the page sees them
  useEffect(() => {
    const attempt = `${view}-${date}`;
    if (!unlabelled || attempted.current.has(attempt)) {
      return;
    }
    attempted.current.add(attempt);
    (async () => {
      setLabelling(true);
      for (let round = 0; round < 10; round++) {
        const response = await fetch('/growth/mix/label', { method: 'POST' });
        if (!response.ok) {
          break;
        }
        const { remaining, labelled: count } = await response.json();
        if (!remaining || !count) {
          break;
        }
      }
      setLabelling(false);
      reload();
    })();
  }, [unlabelled, view, date]);

  return (
    <GrowthSection
      title={t('schedule_mix', 'Schedule mix')}
      description={t(
        'schedule_mix_description',
        'What was sent and what is due, by format, content pillar and call to action, in UK time. Set weekly targets per channel to see the gaps. Pillar and call to action are labelled by Claude and you can change any label.'
      )}
    >
      <div className="flex gap-[12px] items-center flex-wrap">
        <Button
          secondary={view !== 'today'}
          onClick={() => setView('today')}
        >
          {t('mix_today', 'Day')}
        </Button>
        <Button secondary={view !== 'week'} onClick={() => setView('week')}>
          {t('mix_week', 'Week')}
        </Button>
        <Button
          secondary={true}
          onClick={() => setDate(shiftDate(date, view === 'week' ? -7 : -1))}
        >
          &larr;
        </Button>
        <input
          type="date"
          className="h-[42px] bg-newBgColorInner px-[12px] outline-none border-newTableBorder border rounded-[8px] text-[14px]"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <Button
          secondary={true}
          onClick={() => setDate(shiftDate(date, view === 'week' ? 7 : 1))}
        >
          &rarr;
        </Button>
        <Button secondary={true} onClick={() => setDate(ukToday())}>
          {t('today', 'Today')}
        </Button>
        {labelling && (
          <div className="text-[13px] text-newTextColor/60">
            {t('mix_labelling', 'Labelling posts...')}
          </div>
        )}
      </div>

      {view === 'today' && (
        <Today data={day.data} mutate={reload} />
      )}
      {view === 'week' && <Week data={week.data} mutate={reload} />}
    </GrowthSection>
  );
};
