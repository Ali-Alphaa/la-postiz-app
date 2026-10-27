'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Slider } from '@gitroom/react/form/slider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import {
  errorMessage,
  useGrowthIntegrations,
  useRecycle,
} from '@gitroom/frontend/components/growth/growth.hooks';
import {
  ChannelSelect,
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';

const defaults = {
  enabled: false,
  minAgeDays: 30,
  minGapDays: 90,
  postsPerWeek: 1,
  percentile: 80,
};

const fields = [
  {
    key: 'minAgeDays',
    label: 'Only posts older than (days)',
    translation: 'recycle_min_age',
  },
  {
    key: 'minGapDays',
    label: 'Days between two recycles of the same post',
    translation: 'recycle_min_gap',
  },
  {
    key: 'postsPerWeek',
    label: 'Recycled posts per week',
    translation: 'recycle_per_week',
  },
  {
    key: 'percentile',
    label: 'Engagement percentile (80 = top 20% posts)',
    translation: 'recycle_percentile',
  },
] as const;

export const Recycle: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useRecycle();
  const { data: integrations } = useGrowthIntegrations();
  const [integration, setIntegration] = useState('');
  const [values, setValues] = useState<typeof defaults>(defaults);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const current = (data?.settings || []).find(
      (p: any) => p.integrationId === integration
    );
    setValues(current ? { ...defaults, ...current } : defaults);
  }, [data, integration]);

  const names = useMemo(
    () =>
      (integrations || []).reduce(
        (all, p) => ({ ...all, [p.id]: p.name }),
        {} as Record<string, string>
      ),
    [integrations]
  );

  const save = useCallback(async () => {
    setSaving(true);
    const response = await fetch(`/growth/recycle/${integration}`, {
      method: 'PUT',
      body: JSON.stringify({
        enabled: values.enabled,
        minAgeDays: +values.minAgeDays,
        minGapDays: +values.minGapDays,
        postsPerWeek: +values.postsPerWeek,
        percentile: +values.percentile,
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
    mutate();
    toaster.show(t('settings_saved', 'Settings saved'), 'success');
  }, [integration, values]);

  return (
    <GrowthSection
      title={t('evergreen_recycling', 'Evergreen recycling')}
      description={t(
        'evergreen_recycling_description',
        'Re-schedules your best performing posts into the next free time slot of the channel. Only original posts with analytics are picked, never the same post twice within the gap.'
      )}
    >
      <ChannelSelect value={integration} onChange={setIntegration} />
      {!!integration && (
        <GrowthCard className="flex flex-col gap-[12px] max-w-[600px]">
          <div className="flex items-center gap-[12px]">
            <Slider
              value={values.enabled ? 'on' : 'off'}
              onChange={(value) =>
                setValues((prev) => ({ ...prev, enabled: value === 'on' }))
              }
              fill={true}
            />
            <div className="text-[14px]">
              {t('recycle_enabled', 'Recycle the top posts of this channel')}
            </div>
          </div>
          {fields.map((field) => (
            <Input
              key={field.key}
              label={t(field.translation, field.label)}
              name={field.key}
              type="number"
              disableForm={true}
              value={values[field.key]}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [field.key]: e.target.value as any,
                }))
              }
            />
          ))}
          <div>
            <Button onClick={save} loading={saving}>
              {t('save', 'Save')}
            </Button>
          </div>
        </GrowthCard>
      )}

      <GrowthCard>
        <div className="text-[15px] font-semibold mb-[12px]">
          {t('recent_recycles', 'Recent recycles')}
        </div>
        {!data?.recycles?.length ? (
          <div className="text-[13px] text-newTextColor/60">
            {t('no_recycles', 'No post was recycled yet')}
          </div>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {data.recycles.map((p: any) => (
              <div
                key={p.id}
                className="flex gap-[12px] items-center border-b border-newTableBorder pb-[8px] text-[13px]"
              >
                <div className="w-[160px] shrink-0 text-newTextColor/60">
                  {names[p.integrationId] || ''}
                </div>
                <div className="flex-1 truncate">
                  {stripHtmlValidation('none', p.sourcePost?.content || '')}
                </div>
                <div className="shrink-0 text-newTextColor/60">
                  {p.recycledPost?.deletedAt
                    ? t('deleted', 'Deleted')
                    : fromUtc(p.recycledPost?.publishDate).format(
                        'DD/MM/YYYY HH:mm'
                      )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GrowthCard>
    </GrowthSection>
  );
};
