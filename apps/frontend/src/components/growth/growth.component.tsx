'use client';

import { FC, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { SVGLine } from '@gitroom/frontend/components/launches/launches.component';
import { useGrowthSettings } from '@gitroom/frontend/components/growth/growth.hooks';
import { BestTime } from '@gitroom/frontend/components/growth/best.time';
import { Hashtags } from '@gitroom/frontend/components/growth/hashtags';
import { UtmSettings } from '@gitroom/frontend/components/growth/utm.settings';
import { Recycle } from '@gitroom/frontend/components/growth/recycle';
import { AbTests } from '@gitroom/frontend/components/growth/ab.tests';
import {
  Competitors,
  Inspiration,
} from '@gitroom/frontend/components/growth/competitors';
import {
  XInspiration,
  XVoice,
} from '@gitroom/frontend/components/growth/x.inspiration';

export const GrowthComponent: FC = () => {
  const t = useT();
  const url = useSearchParams();
  // loading the settings creates them, which turns on the engagement
  // collection the growth features are based on
  useGrowthSettings();

  const list = useMemo(
    () => [
      { tab: 'best_time', label: t('best_time_to_post', 'Best time to post') },
      { tab: 'hashtags', label: t('hashtags', 'Hashtags') },
      { tab: 'utm', label: t('utm_tracking', 'UTM tracking links') },
      {
        tab: 'recycle',
        label: t('evergreen_recycling', 'Evergreen recycling'),
      },
      { tab: 'ab_tests', label: t('ab_tests', 'A/B tests') },
      { tab: 'competitors', label: t('competitors', 'Competitors') },
      { tab: 'inspiration', label: t('inspiration', 'Inspiration') },
      { tab: 'x_inspiration', label: t('x_inspiration', 'X Inspiration') },
      { tab: 'x_voice', label: t('x_my_voice', 'X: My voice') },
    ],
    [t]
  );

  const [tab, setTab] = useState(() => {
    const requested = url.get('tab');
    return list.some((p) => p.tab === requested) ? requested! : 'best_time';
  });

  return (
    <>
      <div className="bg-newBgColorInner p-[20px] mobile:p-[12px] flex flex-col transition-all w-[260px] mobile:w-full">
        <div className="flex flex-1 flex-col gap-[15px] mobile:flex-row mobile:gap-[8px] mobile:overflow-x-auto mobile:pb-[6px] scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
          {list.map(({ tab: tabKey, label }) => (
            <div
              key={tabKey}
              className={clsx(
                'cursor-pointer flex items-center gap-[12px] group/profile hover:bg-boxHover rounded-e-[8px] mobile:shrink-0 mobile:whitespace-nowrap mobile:rounded-[8px] mobile:px-[12px] mobile:py-[8px]',
                tabKey === tab && 'bg-boxHover'
              )}
              onClick={() => setTab(tabKey)}
            >
              <div
                className={clsx(
                  'h-full w-[4px] rounded-s-[3px] opacity-0 group-hover/profile:opacity-100 transition-opacity mobile:hidden',
                  tabKey === tab && 'opacity-100'
                )}
              >
                <SVGLine />
              </div>
              {label}
            </div>
          ))}
        </div>
      </div>
      <div className="bg-newBgColorInner flex-1 min-w-0 flex-col flex p-[20px] mobile:p-[12px] gap-[12px] overflow-y-auto">
        {tab === 'best_time' && <BestTime />}
        {tab === 'hashtags' && <Hashtags />}
        {tab === 'utm' && <UtmSettings />}
        {tab === 'recycle' && <Recycle />}
        {tab === 'ab_tests' && <AbTests />}
        {tab === 'competitors' && <Competitors />}
        {tab === 'inspiration' && <Inspiration />}
        {tab === 'x_inspiration' && <XInspiration />}
        {tab === 'x_voice' && <XVoice />}
      </div>
    </>
  );
};
