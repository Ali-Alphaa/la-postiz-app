'use client';

import { FC, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import { useRevenue } from '@gitroom/frontend/components/growth/growth.tools.hooks';

const Stat: FC<{ label: string; value: string | number }> = ({
  label,
  value,
}) => (
  <GrowthCard className="flex flex-col gap-[4px] flex-1 min-w-[140px]">
    <div className="text-[12px] text-textItemBlur">{label}</div>
    <div className="text-[24px] font-[600]">{value}</div>
  </GrowthCard>
);

export const Revenue: FC = () => {
  const t = useT();
  const [days, setDays] = useState(30);
  const { data } = useRevenue(days);

  return (
    <GrowthSection
      title={t('revenue_tracking', 'Revenue tracking')}
      description={t(
        'revenue_tracking_description',
        'Which post led to which signup or sale. Published links carry the post id in utm_content while UTM tracking is on, and your website reports each lead or sale to the Public API with those tags.'
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <div>
          <select
            className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-textColor"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {[7, 30, 90, 365].map((p) => (
              <option key={p} value={p}>
                {t('revenue_last', 'Last')} {p} {t('revenue_days', 'days')}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-[12px] flex-wrap">
          <Stat
            label={t('revenue_leads', 'Leads')}
            value={data?.totals?.leads ?? 0}
          />
          <Stat
            label={t('revenue_sales', 'Sales')}
            value={data?.totals?.sales ?? 0}
          />
          <Stat
            label={t('revenue_value', 'Sales value')}
            value={(data?.totals?.value ?? 0).toFixed(2)}
          />
          <Stat
            label={t('revenue_attributed', 'Traced to a post')}
            value={data?.totals?.attributed ?? 0}
          />
        </div>
        <GrowthCard className="flex flex-col gap-[8px]">
          <div className="font-[600]">
            {t('revenue_by_post', 'Posts that brought results')}
          </div>
          {!data?.posts?.length && (
            <div className="text-[13px] text-textItemBlur">
              {t(
                'revenue_no_posts',
                'Nothing traced to a post yet. Turn on UTM tracking, then publish a post with a link.'
              )}
            </div>
          )}
          {(data?.posts || []).map((post) => (
            <div
              key={post.id}
              className="border-t border-newTableBorder pt-[8px] text-[13px] flex gap-[12px] justify-between"
            >
              <div className="min-w-0 break-words">
                {post.url ? (
                  <a
                    href={post.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {post.text}
                  </a>
                ) : (
                  post.text
                )}
                <div className="text-[12px] text-textItemBlur">
                  {post.channel}
                </div>
              </div>
              <div className="whitespace-nowrap text-end">
                {post.leads} {t('revenue_leads_lower', 'leads')} · {post.sales}{' '}
                {t('revenue_sales_lower', 'sales')} · {post.value.toFixed(2)}
              </div>
            </div>
          ))}
        </GrowthCard>
        <GrowthCard className="flex flex-col gap-[8px]">
          <div className="font-[600]">
            {t('revenue_by_source', 'By source')}
          </div>
          {!data?.sources?.length && (
            <div className="text-[13px] text-textItemBlur">
              {t('revenue_no_data', 'No leads or sales reported yet.')}
            </div>
          )}
          {(data?.sources || []).map((row) => (
            <div
              key={row.source}
              className="text-[13px] flex justify-between gap-[12px]"
            >
              <span>{row.source}</span>
              <span>
                {row.leads} {t('revenue_leads_lower', 'leads')} · {row.sales}{' '}
                {t('revenue_sales_lower', 'sales')} · {row.value.toFixed(2)}
              </span>
            </div>
          ))}
        </GrowthCard>
      </div>
    </GrowthSection>
  );
};
