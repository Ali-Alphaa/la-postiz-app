'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  errorMessage,
  useHashtagsHistory,
} from '@gitroom/frontend/components/growth/growth.hooks';
import {
  ChannelSelect,
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';

export interface HashtagItem {
  tag: string;
  uses: number;
  avgEngagement: number;
  lift: number;
}

// Hashtags ranked by the engagement of the posts that used them, and AI
// suggestions for a caption. `onInsert` is set when used from the editor.
export const HashtagSuggestions: FC<{
  integrationId?: string;
  content?: string;
  onInsert?: (tags: string[]) => void;
}> = ({ integrationId, content, onInsert }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data } = useHashtagsHistory(integrationId);
  const [ai, setAi] = useState<string[]>([]);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'unavailable'>(
    'idle'
  );
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = useCallback(
    (tag: string) => () => {
      setSelected((prev) =>
        prev.includes(tag) ? prev.filter((p) => p !== tag) : [...prev, tag]
      );
    },
    []
  );

  const suggest = useCallback(async () => {
    setAiState('loading');
    const response = await fetch('/growth/hashtags/ai', {
      method: 'POST',
      body: JSON.stringify({
        content,
        ...(integrationId ? { integrationId } : {}),
      }),
    });
    if (!response.ok) {
      setAiState('idle');
      toaster.show(
        await errorMessage(
          response,
          t('something_went_wrong', 'Something went wrong')
        ),
        'warning'
      );
      return;
    }
    const { available, hashtags } = await response.json();
    setAi(hashtags || []);
    setAiState(available ? 'idle' : 'unavailable');
  }, [content, integrationId]);

  const chip = (tag: string, extra?: string) => (
    <div
      key={tag}
      onClick={onInsert ? toggle(tag) : undefined}
      className={clsx(
        'h-[32px] px-[12px] rounded-[8px] border flex items-center gap-[6px] text-[13px]',
        onInsert && 'cursor-pointer select-none',
        selected.includes(tag)
          ? 'bg-[#612BD3] border-[#612BD3] text-white'
          : 'bg-newBgColorInner border-newTableBorder hover:border-[#612BD3]/40'
      )}
    >
      <span>#{tag}</span>
      {!!extra && (
        <span
          className={clsx(
            'text-[11px]',
            selected.includes(tag) ? 'text-white/80' : 'text-newTextColor/60'
          )}
        >
          {extra}
        </span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[8px]">
        <div className="text-[14px] font-semibold">
          {t('top_hashtags_history', 'Your best hashtags')}
        </div>
        {!data?.hashtags?.length ? (
          <div className="text-[13px] text-newTextColor/60">
            {t(
              'no_hashtags_history',
              'No hashtag was used in at least 2 published posts with analytics yet.'
            )}
          </div>
        ) : (
          <div className="flex gap-[6px] flex-wrap">
            {data.hashtags.map((p: HashtagItem) =>
              chip(
                p.tag,
                `${p.lift >= 1 ? '+' : ''}${Math.round(
                  (p.lift - 1) * 100
                )}% · ${p.uses}x`
              )
            )}
          </div>
        )}
        {!!data?.hashtags?.length && (
          <div className="text-[12px] text-newTextColor/60">
            {t(
              'hashtags_lift_explained',
              'Compared to the average engagement of all your posts ({{posts}} posts)',
              { posts: data.posts }
            )}
          </div>
        )}
      </div>

      {content !== undefined && (
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center gap-[12px]">
            <div className="text-[14px] font-semibold flex-1">
              {t('ai_hashtags', 'AI suggestions for this post')}
            </div>
            <button
              type="button"
              onClick={suggest}
              disabled={aiState === 'loading' || (content || '').length < 3}
              className="h-[32px] px-[12px] rounded-[8px] bg-[#612BD3] hover:bg-[#7640e0] disabled:opacity-50 text-white text-[13px]"
            >
              {aiState === 'loading'
                ? t('loading', 'Loading...')
                : t('suggest', 'Suggest')}
            </button>
          </div>
          {aiState === 'unavailable' && (
            <div className="text-[13px] text-newTextColor/60">
              {t(
                'ai_not_configured',
                'AI is not configured on this server (OPENAI_API_KEY)'
              )}
            </div>
          )}
          {!!ai.length && (
            <div className="flex gap-[6px] flex-wrap">
              {ai.map((p) => chip(p))}
            </div>
          )}
        </div>
      )}

      {!!onInsert && (
        <button
          type="button"
          disabled={!selected.length}
          onClick={() => onInsert(selected)}
          className="h-[40px] rounded-[8px] bg-btnPrimary disabled:opacity-50 text-white text-[14px]"
        >
          {t('insert_hashtags', 'Insert {{total}} hashtags', {
            total: selected.length,
          })}
        </button>
      )}
    </div>
  );
};

export const Hashtags: FC = () => {
  const t = useT();
  const [integration, setIntegration] = useState('');
  return (
    <GrowthSection
      title={t('hashtags', 'Hashtags')}
      description={t(
        'hashtags_description',
        'Hashtags from your published posts, ranked by how much more engagement their posts got than your average post. AI suggestions are available in the post editor.'
      )}
    >
      <ChannelSelect
        value={integration}
        onChange={setIntegration}
        allowAll={true}
      />
      <GrowthCard>
        <HashtagSuggestions integrationId={integration || undefined} />
      </GrowthCard>
    </GrowthSection>
  );
};
