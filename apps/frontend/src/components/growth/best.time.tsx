'use client';

import { FC, Fragment, useCallback, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  ChannelSelect,
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import {
  errorMessage,
  useBestTime,
  useGrowthIntegrations,
} from '@gitroom/frontend/components/growth/growth.hooks';

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

export const BestTime: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const timezone = useMemo(() => getTimezone(), []);
  const [integration, setIntegration] = useState('');
  const [loading, setLoading] = useState('');
  const { mutate: reloadIntegrations } = useGrowthIntegrations();
  const { data, mutate, isLoading } = useBestTime(integration, timezone);

  const max = useMemo(
    () =>
      Math.max(
        1,
        ...(data?.heatmap || []).map((p: any) => p.avgEngagement as number)
      ),
    [data]
  );

  const cell = useCallback(
    (weekday: number, hour: number) =>
      (data?.heatmap || []).find(
        (p: any) => p.weekday === weekday && p.hour === hour
      ),
    [data]
  );

  const refresh = useCallback(async () => {
    setLoading('refresh');
    const response = await fetch(`/growth/engagement/${integration}/refresh`, {
      method: 'POST',
    });
    setLoading('');
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
    const { refreshed } = await response.json();
    toaster.show(
      t('analytics_refreshed', 'Analytics refreshed for {{refreshed}} posts', {
        refreshed,
      }),
      'success'
    );
    mutate();
  }, [integration]);

  const apply = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'replace_posting_times',
          'This replaces the current time slots of this channel, continue?'
        ),
        t('yes_replace', 'Yes, replace')
      ))
    ) {
      return;
    }
    setLoading('apply');
    const response = await fetch(`/growth/best-time/${integration}/apply`, {
      method: 'POST',
      body: JSON.stringify({ timezone }),
    });
    setLoading('');
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
    reloadIntegrations();
    toaster.show(
      t('posting_times_updated', 'The time slots of the channel were updated'),
      'success'
    );
  }, [integration, timezone]);

  return (
    <GrowthSection
      title={t('best_time_to_post', 'Best time to post')}
      description={t(
        'best_time_to_post_description',
        'The hours your published posts got the most engagement, in your timezone. Apply them as the time slots of the channel so new posts go there.'
      )}
    >
      <div className="flex gap-[12px] items-end flex-wrap">
        <ChannelSelect value={integration} onChange={setIntegration} />
        <Button
          secondary={true}
          onClick={refresh}
          loading={loading === 'refresh'}
          disabled={!integration}
        >
          {t('refresh_analytics', 'Refresh analytics')}
        </Button>
        <Button
          onClick={apply}
          loading={loading === 'apply'}
          disabled={!integration || !data?.topSlots?.length}
        >
          {t('use_as_time_slots', 'Use as time slots')}
        </Button>
      </div>

      {!!data && !isLoading && (
        <>
          {!data.supported && (
            <GrowthCard className="text-[14px] text-newTextColor/60">
              {t(
                'best_time_not_supported',
                "This platform doesn't provide post analytics, the suggestions below are the defaults."
              )}
            </GrowthCard>
          )}
          <GrowthCard>
            <div className="text-[15px] font-semibold mb-[8px]">
              {t('suggested_time_slots', 'Suggested time slots')} ({timezone})
            </div>
            <div className="text-[13px] text-newTextColor/60 mb-[12px]">
              {data.isDefault
                ? t(
                    'best_time_default',
                    'Only {{posts}} posts with analytics so far (10 are needed), these are the common engagement peaks: morning, lunch and after work.',
                    { posts: data.sampleSize }
                  )
                : t(
                    'best_time_based_on',
                    'Based on {{posts}} published posts of the last 6 months',
                    { posts: data.sampleSize }
                  )}
            </div>
            <div className="flex gap-[8px] flex-wrap">
              {(data.topSlots || []).map((slot: any) => (
                <div
                  key={slot.hour}
                  className="h-[40px] px-[16px] rounded-[8px] bg-[#612BD3]/10 border border-[#612BD3]/40 flex items-center gap-[8px] text-[14px]"
                >
                  <span className="font-semibold tabular-nums">
                    {hourLabel(slot.hour)}
                  </span>
                  {!data.isDefault && (
                    <span className="text-newTextColor/60 text-[12px]">
                      {slot.posts} {t('posts', 'posts')} ·{' '}
                      {Math.round(slot.avgEngagement)}{' '}
                      {t('avg_engagement', 'avg. engagement')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </GrowthCard>

          <GrowthCard className="overflow-x-auto">
            <div className="text-[15px] font-semibold mb-[12px]">
              {t('engagement_heatmap', 'Engagement heatmap')}
            </div>
            <div className="grid grid-cols-[40px_repeat(24,minmax(22px,1fr))] gap-[2px] min-w-[640px]">
              <div />
              {[...Array(24).keys()].map((hour) => (
                <div
                  key={hour}
                  className="text-[10px] text-newTextColor/60 text-center"
                >
                  {hour}
                </div>
              ))}
              {days.map((day, weekday) => (
                <Fragment key={day}>
                  <div className="text-[12px] text-newTextColor/60 flex items-center">
                    {t(day.toLowerCase(), day)}
                  </div>
                  {[...Array(24).keys()].map((hour) => {
                    const value = cell(weekday, hour);
                    return (
                      <div
                        key={`${weekday}-${hour}`}
                        data-tooltip-id="tooltip"
                        data-tooltip-content={
                          value
                            ? `${day} ${hourLabel(hour)}: ${
                                value.posts
                              } posts, ${Math.round(
                                value.avgEngagement
                              )} avg. engagement`
                            : `${day} ${hourLabel(hour)}`
                        }
                        className={clsx(
                          'h-[22px] rounded-[4px]',
                          !value && 'bg-newTableBorder/40'
                        )}
                        style={
                          value
                            ? {
                                backgroundColor: `rgba(97, 43, 211, ${
                                  0.15 + (0.85 * value.avgEngagement) / max
                                })`,
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </GrowthCard>
        </>
      )}
    </GrowthSection>
  );
};
