'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import {
  errorMessage,
  useCompetitorProviders,
  useCompetitors,
  useGrowthIntegrations,
  useInspiration,
} from '@gitroom/frontend/components/growth/growth.hooks';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import { textToHtml } from '@gitroom/frontend/components/growth/ab.tests';

const Delta: FC<{ value: number | null }> = ({ value }) => {
  if (value === null || value === undefined) {
    return <span className="text-newTextColor/40">-</span>;
  }
  return (
    <span
      className={clsx(
        value > 0 && 'text-green-500',
        value < 0 && 'text-red-400'
      )}
    >
      {value > 0 ? '+' : ''}
      {value}
    </span>
  );
};

const ProviderSelect: FC<{
  value: string;
  onChange: (value: string) => void;
  allowAll?: boolean;
}> = ({ value, onChange, allowAll }) => {
  const t = useT();
  const { data } = useCompetitorProviders();
  return (
    <div className="w-[200px] mobile:w-full">
      <Select
        label={t('platform', 'Platform')}
        name="provider"
        disableForm={true}
        hideErrors={true}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {allowAll && <option value="">{t('all', 'All')}</option>}
        {!allowAll && <option value="">{t('select', 'Select')}</option>}
        {(data || []).map((p: any) => (
          <option key={p.identifier} value={p.identifier}>
            {p.name}
          </option>
        ))}
      </Select>
    </div>
  );
};

export const Competitors: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useCompetitors();
  const [provider, setProvider] = useState('');
  const [handle, setHandle] = useState('');
  const [adding, setAdding] = useState(false);

  const add = useCallback(async () => {
    setAdding(true);
    const response = await fetch('/growth/competitors', {
      method: 'POST',
      body: JSON.stringify({ provider, handle }),
    });
    setAdding(false);
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
    setHandle('');
    mutate();
  }, [provider, handle]);

  const remove = useCallback(
    (competitor: any) => async () => {
      if (
        !(await deleteDialog(
          t('stop_tracking', 'Stop tracking {{name}}?', {
            name: competitor.name || competitor.handle,
          })
        ))
      ) {
        return;
      }
      await fetch(`/growth/competitors/${competitor.id}`, {
        method: 'DELETE',
      });
      mutate();
    },
    []
  );

  return (
    <GrowthSection
      title={t('competitors', 'Competitors')}
      description={t(
        'competitors_description',
        'Track public accounts on platforms with a free public API. Followers and engagement are refreshed once a day.'
      )}
    >
      <GrowthCard className="flex gap-[12px] items-end flex-wrap">
        <ProviderSelect value={provider} onChange={setProvider} />
        <div className="w-[300px] mobile:w-full">
          <Input
            label={t('handle', 'Handle')}
            name="handle"
            placeholder="name.bsky.social / user@mastodon.social"
            disableForm={true}
            removeError={true}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
          />
        </div>
        <Button
          onClick={add}
          loading={adding}
          disabled={!provider || handle.trim().length < 2}
        >
          {t('track', 'Track')}
        </Button>
      </GrowthCard>

      <GrowthCard className="overflow-x-auto">
        {!data?.length ? (
          <div className="text-[13px] text-newTextColor/60">
            {t('no_competitors', 'You are not tracking any account yet')}
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_100px_100px_100px_120px_120px_80px] gap-[10px] text-[13px] items-center min-w-[780px]">
            <div className="text-newTextColor/60">
              {t('account', 'Account')}
            </div>
            <div className="text-newTextColor/60">
              {t('followers', 'Followers')}
            </div>
            <div className="text-newTextColor/60">{t('7_days', '7 Days')}</div>
            <div className="text-newTextColor/60">
              {t('30_days', '30 Days')}
            </div>
            <div className="text-newTextColor/60">
              {t('avg_engagement', 'avg. engagement')}
            </div>
            <div className="text-newTextColor/60">
              {t('last_sync', 'Last sync')}
            </div>
            <div />
            {data.map((competitor: any) => (
              <div key={competitor.id} className="contents">
                <a
                  href={competitor.profileUrl || '#'}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-[8px] min-w-0"
                >
                  {!!competitor.picture && (
                    <img
                      src={competitor.picture}
                      className="w-[28px] h-[28px] rounded-full"
                      alt=""
                    />
                  )}
                  <div className="flex flex-col min-w-0">
                    <span className="truncate">{competitor.name}</span>
                    <span className="truncate text-newTextColor/60 text-[12px]">
                      {competitor.provider} · {competitor.handle}
                    </span>
                  </div>
                </a>
                <div>{competitor.followers ?? '-'}</div>
                <div>
                  <Delta value={competitor.followersDelta7} />
                </div>
                <div>
                  <Delta value={competitor.followersDelta30} />
                </div>
                <div>
                  {competitor.avgEngagement === null
                    ? '-'
                    : Math.round(competitor.avgEngagement * 10) / 10}
                </div>
                <div className="text-newTextColor/60">
                  {competitor.lastSyncedAt
                    ? fromUtc(competitor.lastSyncedAt).format('DD/MM HH:mm')
                    : '-'}
                </div>
                <div>
                  <button
                    type="button"
                    className="text-red-400"
                    onClick={remove(competitor)}
                  >
                    {t('remove', 'Remove')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </GrowthCard>
    </GrowthSection>
  );
};

export const Inspiration: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const [provider, setProvider] = useState('');
  const [rewriting, setRewriting] = useState('');
  const { data } = useInspiration(provider);
  const { data: integrations } = useGrowthIntegrations();

  const openEditor = useCallback(
    async (content: string) => {
      const date = (await (await fetch('/posts/find-slot')).json()).date;
      const list = (integrations || []).filter((p) => !p.disabled) as any[];
      modal.openModal({
        id: 'add-edit-modal',
        closeOnClickOutside: false,
        removeLayout: true,
        closeOnEscape: false,
        withCloseButton: false,
        askClose: true,
        fullScreen: true,
        classNames: {
          modal: 'w-[100%] max-w-[1400px] text-textColor',
        },
        children: (
          <AddEditModal
            allIntegrations={list}
            integrations={list}
            onlyValues={[{ content: textToHtml(content) }]}
            reopenModal={() => {}}
            mutate={() => {}}
            date={fromUtc(date)}
          />
        ),
        size: '80%',
        title: ``,
      });
    },
    [integrations]
  );

  const rewrite = useCallback(
    (id: string) => async () => {
      setRewriting(id);
      const response = await fetch(`/growth/inspiration/${id}/rewrite`, {
        method: 'POST',
      });
      setRewriting('');
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
      const { available, content } = await response.json();
      if (!available) {
        toaster.show(
          t(
            'ai_not_configured',
            'AI is not configured on this server (OPENAI_API_KEY)'
          ),
          'warning'
        );
        return;
      }
      if (!content) {
        toaster.show(
          t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      openEditor(content);
    },
    [openEditor]
  );

  return (
    <GrowthSection
      title={t('inspiration', 'Inspiration')}
      description={t(
        'inspiration_description',
        'The best performing posts of the accounts you track, from the last 30 days. Start a draft from one, or let AI write an original post inspired by it.'
      )}
    >
      <ProviderSelect value={provider} onChange={setProvider} allowAll={true} />
      {!data?.length ? (
        <GrowthCard className="text-[13px] text-newTextColor/60">
          {t(
            'no_inspiration',
            'No posts yet, track some accounts in the Competitors tab'
          )}
        </GrowthCard>
      ) : (
        <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[12px]">
          {data.map((post: any) => (
            <GrowthCard key={post.id} className="flex flex-col gap-[10px]">
              <div className="flex items-center gap-[8px]">
                {!!post.competitor.picture && (
                  <img
                    src={post.competitor.picture}
                    className="w-[28px] h-[28px] rounded-full"
                    alt=""
                  />
                )}
                <div className="flex flex-col flex-1 min-w-0">
                  <span className="truncate text-[14px]">
                    {post.competitor.name}
                  </span>
                  <span className="truncate text-[12px] text-newTextColor/60">
                    {post.competitor.handle} ·{' '}
                    {fromUtc(post.publishedAt).format('DD/MM/YYYY')}
                  </span>
                </div>
                <a
                  href={post.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[12px] underline text-newTextColor/60"
                >
                  {t('open', 'Open')}
                </a>
              </div>
              <div className="text-[14px] whitespace-pre-wrap break-words flex-1">
                {post.content}
              </div>
              <div className="text-[12px] text-newTextColor/60">
                {post.likes} {t('likes', 'likes')} · {post.reposts}{' '}
                {t('reposts', 'reposts')} · {post.replies}{' '}
                {t('replies', 'replies')}
              </div>
              <div className="flex gap-[8px]">
                <Button
                  secondary={true}
                  onClick={() => openEditor(post.content)}
                >
                  {t('use_as_draft', 'Use as draft')}
                </Button>
                <Button
                  onClick={rewrite(post.id)}
                  loading={rewriting === post.id}
                >
                  {t('rewrite_with_ai', 'Rewrite with AI')}
                </Button>
              </div>
            </GrowthCard>
          ))}
        </div>
      )}
    </GrowthSection>
  );
};
