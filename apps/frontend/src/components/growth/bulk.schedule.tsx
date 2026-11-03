'use client';

import { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { checkTradingCompliance } from '@gitroom/helpers/utils/trading.compliance';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import {
  GrowthIntegration,
  useGrowthIntegrations,
} from '@gitroom/frontend/components/growth/growth.hooks';

const TEMPLATE =
  'date,channel,content\n2026-12-01 09:00,My X account,"Your post text, commas are fine in quotes"\n';

// rows of a CSV file: quoted values may hold commas, new lines and "" for a quote
const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(value);
      value = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((p) => p.some((cell) => cell.trim()));
};

interface Row {
  line: number;
  date: string;
  channel: string;
  content: string;
  integrationId?: string;
  iso?: string;
  error?: string;
  warning?: string;
}

const toRows = (text: string, integrations: GrowthIntegration[]): Row[] => {
  const [header, ...lines] = parseCsv(text.replace(/^﻿/, ''));
  if (!header) {
    return [];
  }
  const column = (name: string) =>
    header.findIndex((p) => p.trim().toLowerCase() === name);
  const [dateAt, channelAt, contentAt] = [
    column('date'),
    column('channel'),
    column('content'),
  ];
  if (dateAt < 0 || channelAt < 0 || contentAt < 0) {
    return [
      {
        line: 1,
        date: '',
        channel: '',
        content: '',
        error: 'The header must have date, channel and content columns',
      },
    ];
  }

  const active = integrations.filter((p) => !p.disabled);
  return lines.map((cells, index) => {
    const date = (cells[dateAt] || '').trim();
    const channel = (cells[channelAt] || '').trim();
    const content = (cells[contentAt] || '').trim();
    const matches = active.filter((p) =>
      [p.name, p.display, p.identifier]
        .filter(Boolean)
        .some((name) => name!.toLowerCase() === channel.toLowerCase())
    );
    const parsed = new Date(date.replace(' ', 'T'));
    const flags = checkTradingCompliance(content);
    return {
      line: index + 2,
      date,
      channel,
      content,
      integrationId: matches.length === 1 ? matches[0].id : undefined,
      iso: isNaN(parsed.getTime()) ? undefined : parsed.toISOString(),
      warning: flags[0]?.reason,
      error: !content
        ? 'The content is empty'
        : isNaN(parsed.getTime())
        ? 'The date is not valid'
        : matches.length > 1
        ? 'More than one channel matches this name'
        : !matches.length
        ? 'Channel not found'
        : undefined,
    };
  });
};

export const BulkSchedule: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: integrations } = useGrowthIntegrations();
  const [text, setText] = useState('');
  const [type, setType] = useState<'draft' | 'schedule'>('draft');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<
    Array<{ row: number; ok: boolean; error?: string }>
  >([]);

  const rows = useMemo(
    () => toRows(text, integrations || []),
    [text, integrations]
  );
  const valid = rows.filter((p) => !p.error);

  const pickFile = useCallback(async (file?: File) => {
    if (file) {
      setResults([]);
      setText(await file.text());
    }
  }, []);

  const download = useCallback(() => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'postiz-bulk-template.csv';
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const submit = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/growth-tools/bulk', {
        method: 'POST',
        body: JSON.stringify({
          type,
          rows: valid.map((p) => ({
            integrationId: p.integrationId,
            date: p.iso,
            content: p.content,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        toaster.show(
          result?.message || t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      setResults(result.results);
      toaster.show(
        `${t('bulk_created', 'Created')} ${result.created} / ${valid.length}`,
        result.created === valid.length ? 'success' : 'warning'
      );
    } finally {
      setLoading(false);
    }
  }, [valid, type, t]);

  return (
    <GrowthSection
      title={t('bulk_scheduling', 'Bulk scheduling')}
      description={t(
        'bulk_scheduling_description',
        'Upload a CSV with date, channel and content columns. The channel is its name or handle. Dates use your local time. Text only: add media in the calendar afterwards.'
      )}
    >
      <GrowthCard className="flex flex-col gap-[12px]">
        <div className="flex gap-[8px] flex-wrap items-center">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          <Button secondary={true} onClick={download}>
            {t('bulk_template', 'Download template')}
          </Button>
          <select
            className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-textColor ms-auto"
            value={type}
            onChange={(e) => setType(e.target.value as 'draft' | 'schedule')}
          >
            <option value="draft">{t('bulk_as_drafts', 'As drafts')}</option>
            <option value="schedule">
              {t('bulk_schedule_them', 'Schedule them')}
            </option>
          </select>
          <Button
            onClick={submit}
            loading={loading}
            disabled={!valid.length || loading}
          >
            {t('bulk_import', 'Import')} {valid.length || ''}
          </Button>
        </div>
        {!!rows.length && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="text-start text-textItemBlur">
                <tr>
                  <th className="text-start p-[6px]">
                    {t('bulk_line', 'Line')}
                  </th>
                  <th className="text-start p-[6px]">
                    {t('bulk_date', 'Date')}
                  </th>
                  <th className="text-start p-[6px]">
                    {t('bulk_channel', 'Channel')}
                  </th>
                  <th className="text-start p-[6px]">
                    {t('bulk_content', 'Content')}
                  </th>
                  <th className="text-start p-[6px]">
                    {t('bulk_check', 'Check')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const position = valid.indexOf(row);
                  const result = results.find((p) => p.row === position + 1);
                  return (
                    <tr
                      key={row.line}
                      className="border-t border-newTableBorder align-top"
                    >
                      <td className="p-[6px]">{row.line}</td>
                      <td className="p-[6px] whitespace-nowrap">{row.date}</td>
                      <td className="p-[6px]">{row.channel}</td>
                      <td className="p-[6px] max-w-[420px] break-words">
                        {row.content.slice(0, 180)}
                      </td>
                      <td className="p-[6px]">
                        {row.error || result?.error ? (
                          <span className="text-red-400">
                            {row.error || result?.error}
                          </span>
                        ) : result?.ok ? (
                          <span className="text-green-400">
                            {t('bulk_done', 'Created')}
                          </span>
                        ) : row.warning ? (
                          <span className="text-yellow-400">{row.warning}</span>
                        ) : (
                          t('bulk_ok', 'OK')
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GrowthCard>
    </GrowthSection>
  );
};
