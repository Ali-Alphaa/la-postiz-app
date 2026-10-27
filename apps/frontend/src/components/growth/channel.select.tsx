'use client';

import { FC, ReactNode, useEffect } from 'react';
import { Select } from '@gitroom/react/form/select';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  GrowthIntegration,
  useGrowthIntegrations,
} from '@gitroom/frontend/components/growth/growth.hooks';

export const ChannelSelect: FC<{
  value: string;
  onChange: (id: string) => void;
  allowAll?: boolean;
  filter?: (integration: GrowthIntegration) => boolean;
}> = ({ value, onChange, allowAll, filter }) => {
  const t = useT();
  const { data } = useGrowthIntegrations();
  const list = (data || []).filter((p) => !filter || filter(p));

  // pick the first channel when one is required
  useEffect(() => {
    if (!allowAll && !value && list.length) {
      onChange(list[0].id);
    }
  }, [allowAll, value, list.length]);

  return (
    <div className="w-[300px] mobile:w-full">
      <Select
        label={t('channel', 'Channel')}
        name="channel"
        disableForm={true}
        hideErrors={true}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowAll && (
          <option value="">{t('all_channels', 'All channels')}</option>
        )}
        {list.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.identifier})
          </option>
        ))}
      </Select>
    </div>
  );
};

export const GrowthSection: FC<{
  title: string;
  description: string;
  children: ReactNode;
}> = ({ title, description, children }) => (
  <div className="flex flex-col gap-[16px]">
    <div>
      <h3 className="text-[20px] font-[500]">{title}</h3>
      <div className="text-[14px] text-newTextColor/60 mt-[4px]">
        {description}
      </div>
    </div>
    {children}
  </div>
);

export const GrowthCard: FC<{ children: ReactNode; className?: string }> = ({
  children,
  className,
}) => (
  <div
    className={`bg-newBgColorInner rounded-[12px] p-[20px] border border-newTableBorder ${
      className || ''
    }`}
  >
    {children}
  </div>
);
