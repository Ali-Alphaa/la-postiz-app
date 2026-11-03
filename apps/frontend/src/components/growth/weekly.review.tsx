'use client';

import { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import { useWeeklyReviews } from '@gitroom/frontend/components/growth/growth.tools.hooks';

export const WeeklyReviewPage: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useWeeklyReviews();
  const [loading, setLoading] = useState(false);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/growth-tools/weekly-reviews', {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok) {
        toaster.show(
          result?.message || t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      if (result.created) {
        toaster.show(t('weekly_ready', 'The review is ready'), 'success');
        mutate();
      } else {
        toaster.show(
          !result.available
            ? t(
                'claude_not_configured',
                'Claude is not configured on this server (ANTHROPIC_API_KEY)'
              )
            : result.error === 'no_data'
            ? t('weekly_no_data', 'No published posts with data last week')
            : t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
      }
    } finally {
      setLoading(false);
    }
  }, [t, mutate]);

  return (
    <GrowthSection
      title={t('weekly_review', 'Weekly review')}
      description={t(
        'weekly_review_description',
        'Each week Claude reviews what you published the week before: what worked, what to repeat and what to rework. You get a notification when it is ready.'
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <div>
          <Button onClick={generate} loading={loading} disabled={loading}>
            {t('weekly_generate', 'Review last week now')}
          </Button>
        </div>
        {!data?.length && (
          <div className="text-[13px] text-textItemBlur">
            {t('weekly_empty', 'No reviews yet.')}
          </div>
        )}
        {(data || []).map((review) => (
          <GrowthCard key={review.id} className="flex flex-col gap-[8px]">
            <div className="font-[600]">
              {t('weekly_week_of', 'Week of')}{' '}
              {new Date(review.weekStart).toLocaleDateString()}
            </div>
            <div className="whitespace-pre-wrap break-words text-[14px]">
              {review.summary}
            </div>
          </GrowthCard>
        ))}
      </div>
    </GrowthSection>
  );
};
