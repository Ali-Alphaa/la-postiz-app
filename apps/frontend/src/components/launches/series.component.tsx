'use client';

import { FC, useEffect, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';

// A post that goes out every N minutes or hours during one day. The sends and
// their texts are approved here, nothing is scheduled until the post is added.

export interface SeriesPayload {
  intervalMinutes: number;
  slots: { date: string; content: string }[];
  // shown on the button, not sent
  label: string;
}

const MIN_MINUTES = 15;
const MAX_SENDS = 50;
const ZONES = [
  { id: 'UTC', label: 'UTC' },
  { id: 'America/New_York', label: 'US Eastern' },
  { id: 'America/Chicago', label: 'US Central' },
  { id: 'America/Los_Angeles', label: 'US Pacific' },
];
const ZONE_KEY = 'seriesTimezone';

const partsOf = (ms: number, timeZone: string) => {
  const parts: Record<string, number> = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(ms)) {
    if (type !== 'literal') {
      parts[type] = +value;
    }
  }
  return parts;
};

// minutes the zone is ahead of UTC at an instant
const offsetOf = (ms: number, timeZone: string) => {
  const p = partsOf(ms, timeZone);
  return (
    Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) -
    Math.floor(ms / 1000) * 1000
  );
};

// the instant a clock time happens on the same day (in the zone) as `ms`
const sameDayAt = (ms: number, timeZone: string, hour: number, minute: number) => {
  const p = partsOf(ms, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, hour, minute, 0);
  return wall - offsetOf(wall - offsetOf(ms, timeZone), timeZone);
};

const clock = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);

const toText = (html: string) =>
  html
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

const toHtml = (text: string) =>
  text
    .split('\n')
    .map(
      (line) =>
        `<p>${line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</p>`
    )
    .join('');

const readZone = () => {
  try {
    const saved = localStorage.getItem(ZONE_KEY);
    return ZONES.some((z) => z.id === saved) ? (saved as string) : 'UTC';
  } catch {
    return 'UTC';
  }
};

const field =
  'h-[40px] px-[10px] rounded-[8px] border border-newTextColor/10 bg-transparent outline-none focus:border-[#612BD3] text-[14px]';

export const SeriesEditor: FC<{
  // when the first send goes out (UTC milliseconds)
  start: number;
  // the post as written in the editor (HTML)
  baseHtml: string;
  integrationId?: string;
  isX: boolean;
  maxLength: number;
  initial?: SeriesPayload;
  onApprove: (series: SeriesPayload | undefined) => void;
}> = ({ start, baseHtml, integrationId, isX, maxLength, initial, onApprove }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const baseText = useMemo(() => toText(baseHtml), [baseHtml]);

  const [tz, setTz] = useState(readZone);
  const [unit, setUnit] = useState<'minutes' | 'hours'>(
    initial && initial.intervalMinutes % 60 ? 'minutes' : 'hours'
  );
  const [amount, setAmount] = useState(
    initial
      ? String(
          initial.intervalMinutes % 60
            ? initial.intervalMinutes
            : initial.intervalMinutes / 60
        )
      : '1'
  );
  const [stopAt, setStopAt] = useState('');
  const [maxSends, setMaxSends] = useState('');
  const [texts, setTexts] = useState<string[]>(
    initial?.slots.map((p) => toText(p.content)) || []
  );
  const [busy, setBusy] = useState<number | 'all' | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(ZONE_KEY, tz);
    } catch {
      // the zone is only remembered for next time
    }
  }, [tz]);

  const intervalMinutes = Math.round(
    (parseFloat(amount) || 0) * (unit === 'hours' ? 60 : 1)
  );

  // the times of the sends: from the first one until the stop time (the end of
  // that day when empty), at most the number of sends asked for
  const times = useMemo(() => {
    if (intervalMinutes < MIN_MINUTES) {
      return [] as number[];
    }
    const [h, m] = /^\d{1,2}:\d{2}$/.test(stopAt)
      ? stopAt.split(':').map(Number)
      : [23, 59];
    const end = sameDayAt(start, tz, Math.min(h, 23), Math.min(m, 59));
    const limit = Math.min(MAX_SENDS, parseInt(maxSends, 10) || MAX_SENDS);
    const all: number[] = [];
    for (
      let at = start;
      at <= end && all.length < limit;
      at += intervalMinutes * 60000
    ) {
      all.push(at);
    }
    return all;
  }, [start, tz, intervalMinutes, stopAt, maxSends]);

  const slotText = (i: number) => texts[i] ?? baseText;

  const generate = async (count: number, integration?: string) => {
    const response = await fetch('/posts/series/variations', {
      method: 'POST',
      body: JSON.stringify({
        text: baseText,
        count,
        maxLength,
        ...(integration ? { integrationId: integration } : {}),
      }),
    });
    if (!response.ok) {
      const { message } = await response.json().catch(() => ({}));
      toaster.show(
        typeof message === 'string'
          ? message
          : t('series_variations_failed', 'Could not write the versions'),
        'warning'
      );
      return null;
    }
    return ((await response.json()).variations || []) as string[];
  };

  const generateAll = async () => {
    setBusy('all');
    const variations = await generate(times.length, integrationId);
    setBusy(null);
    if (variations) {
      setTexts(variations);
    }
  };

  const generateOne = async (index: number) => {
    setBusy(index);
    const variations = await generate(Math.max(2, 2), integrationId);
    setBusy(null);
    if (variations?.[0]) {
      setTexts((all) =>
        times.map((_, i) => (i === index ? variations[0] : all[i] ?? baseText))
      );
    }
  };

  const setOne = (index: number, text: string) =>
    setTexts(times.map((_, i) => (i === index ? text : slotText(i))));

  const tooLong = times.some((_, i) => slotText(i).length > maxLength);
  const ready = times.length >= 2 && !tooLong;

  const approve = () => {
    onApprove({
      intervalMinutes,
      label: `${times.length}x ${t('every', 'every')} ${amount} ${
        unit === 'hours' ? t('hours', 'hours') : t('minutes', 'minutes')
      }`,
      slots: times.map((at, i) => ({
        date: new Date(at).toISOString().slice(0, 19),
        // an untouched text goes out as it was written in the editor
        content:
          slotText(i) === baseText ? baseHtml : toHtml(slotText(i)),
      })),
    });
  };

  return (
    <div className="flex flex-col gap-[16px] w-full text-[14px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <span className="font-[600]">{t('series_every', 'Every')}</span>
        <input
          value={amount}
          inputMode="decimal"
          aria-label={t('series_interval', 'Interval')}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          className={`${field} w-[70px] text-center`}
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as 'minutes' | 'hours')}
          className={field}
        >
          <option value="minutes">{t('minutes', 'minutes')}</option>
          <option value="hours">{t('hours', 'hours')}</option>
        </select>
        <span className="font-[600]">{t('series_until', 'until')}</span>
        <input
          value={stopAt}
          placeholder={t('series_end_of_day', 'end of day')}
          aria-label={t('series_stop_at', 'Stop at (HH:MM)')}
          onChange={(e) => setStopAt(e.target.value.replace(/[^\d:]/g, ''))}
          className={`${field} w-[110px] text-center`}
        />
        <span className="font-[600]">{t('series_max', 'max')}</span>
        <input
          value={maxSends}
          placeholder={String(MAX_SENDS)}
          inputMode="numeric"
          aria-label={t('series_max_sends', 'Most sends')}
          onChange={(e) => setMaxSends(e.target.value.replace(/\D/g, ''))}
          className={`${field} w-[60px] text-center`}
        />
        <select
          value={tz}
          onChange={(e) => setTz(e.target.value)}
          aria-label={t('series_time_zone', 'Time zone')}
          className={field}
        >
          {ZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
      </div>

      {intervalMinutes > 0 && intervalMinutes < MIN_MINUTES && (
        <div className="text-[#FF3F3F]">
          {t('series_min', 'The shortest interval is 15 minutes.')}
        </div>
      )}
      {isX && (
        <div className="text-[#E6A23C]">
          {t(
            'series_x_warning',
            'X may limit or flag repeated posts. Variations help; keep it to a few a day.'
          )}
        </div>
      )}

      <div className="flex items-center gap-[10px]">
        <Button
          type="button"
          loading={busy === 'all'}
          disabled={times.length < 2 || !baseText}
          onClick={generateAll}
        >
          {t('series_generate', 'Generate variations with Claude')}
        </Button>
        <span className="opacity-70">
          {times.length < 2
            ? t('series_need_two', 'Needs at least two sends')
            : `${times.length} ${t('series_sends', 'sends')}`}
        </span>
      </div>

      <div className="flex flex-col gap-[10px] max-h-[360px] overflow-y-auto pe-[6px]">
        {times.map((at, i) => (
          <div
            key={at}
            className="flex gap-[10px] items-start border border-newTextColor/10 rounded-[8px] p-[10px]"
          >
            <div className="w-[64px] shrink-0 font-[600] pt-[6px]">
              {clock(at, tz)}
            </div>
            <div className="flex-1 flex flex-col gap-[6px]">
              <textarea
                value={slotText(i)}
                rows={3}
                onChange={(e) => setOne(i, e.target.value)}
                className="w-full bg-transparent border border-newTextColor/10 rounded-[6px] p-[8px] outline-none focus:border-[#612BD3]"
              />
              <div className="flex items-center gap-[12px] text-[12px] opacity-80">
                <span
                  className={slotText(i).length > maxLength ? 'text-[#FF3F3F]' : ''}
                >
                  {slotText(i).length}/{maxLength}
                </span>
                <button
                  type="button"
                  className="underline"
                  onClick={() => generateOne(i)}
                >
                  {busy === i
                    ? t('series_writing', 'Writing...')
                    : t('series_regenerate', 'Rewrite this one')}
                </button>
                <button
                  type="button"
                  className="underline"
                  onClick={() => setOne(i, baseText)}
                >
                  {t('series_original', 'Back to original')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-between gap-[10px]">
        <Button type="button" secondary onClick={() => onApprove(undefined)}>
          {t('series_remove', 'No repeat during the day')}
        </Button>
        <Button type="button" disabled={!ready} onClick={approve}>
          {t('series_approve', 'Approve all sends')}
        </Button>
      </div>
    </div>
  );
};
