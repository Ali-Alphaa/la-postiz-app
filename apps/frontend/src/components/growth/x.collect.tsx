'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';
import {
  errorMessage,
  useXFetcher,
} from '@gitroom/frontend/components/growth/growth.hooks';
import { GrowthCard } from '@gitroom/frontend/components/growth/channel.select';

const LIMIT = 40;

const Warning: FC = () => {
  const t = useT();
  return (
    <div className="text-[13px] text-yellow-500">
      {t(
        'x_fetcher_warning',
        'Unofficial X access: use guest mode or a spare account, never your main account. The browser extension stays the safe default.'
      )}
    </div>
  );
};

// The optional X fetcher: collect tweets of an account or of a search from
// the server, pick the ones to keep
export const XCollect: FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: status, mutate: mutateStatus } = useXFetcher();
  const [mode, setMode] = useState<'user' | 'search'>('user');
  const [handle, setHandle] = useState('');
  const [includeReplies, setIncludeReplies] = useState(false);
  const [query, setQuery] = useState('');
  const [searchMode, setSearchMode] = useState<'latest' | 'top'>('top');
  const [minLikes, setMinLikes] = useState('100');
  const [results, setResults] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState('');

  const failed = useCallback(async (response: Response) => {
    toaster.show(
      await errorMessage(
        response,
        t('something_went_wrong', 'Something went wrong')
      ),
      'warning'
    );
  }, []);

  const collect = useCallback(async () => {
    setBusy('collect');
    const response = await fetch(
      mode === 'user' ? '/growth/x/fetch/user' : '/growth/x/fetch/search',
      {
        method: 'POST',
        body: JSON.stringify(
          mode === 'user'
            ? { handle, limit: LIMIT, includeReplies }
            : {
                query,
                mode: searchMode,
                limit: LIMIT,
                ...(+minLikes > 0 ? { minLikes: +minLikes } : {}),
              }
        ),
      }
    );
    setBusy('');
    mutateStatus();
    if (!response.ok) {
      return failed(response);
    }
    const body = await response.json();
    setResults(body.tweets);
    setSelected([]);
  }, [mode, handle, includeReplies, query, searchMode, minLikes]);

  const save = useCallback(async () => {
    setBusy('save');
    const response = await fetch('/growth/x/fetch/save', {
      method: 'POST',
      body: JSON.stringify({ tweetIds: selected }),
    });
    setBusy('');
    mutateStatus();
    if (!response.ok) {
      return failed(response);
    }
    const { saved } = await response.json();
    toaster.show(
      t('tweets_saved', '{{count}} tweets saved', { count: saved }),
      'success'
    );
    setResults((prev) =>
      (prev || []).map((p) =>
        selected.includes(p.id) ? { ...p, inLibrary: true } : p
      )
    );
    setSelected([]);
    onSaved();
  }, [selected, onSaved]);

  const toggle = useCallback(
    (id: string) => () =>
      setSelected((prev) =>
        prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
      ),
    []
  );

  if (!status) {
    return null;
  }

  if (!status.enabled) {
    return (
      <GrowthCard className="flex flex-col gap-[6px] text-[13px]">
        <div className="text-[14px] font-[500]">
          {t('x_collect_title', 'Collect from X (optional)')}
        </div>
        <div className="text-newTextColor/70">
          {t(
            'x_fetcher_disabled',
            'The server can also read public tweets of an account or a search for you. It is off: to turn it on, set X_FETCHER_ENABLED=true on the backend (X_FETCHER_MODE=guest, or cookies with X_FETCHER_AUTH_TOKEN and X_FETCHER_CT0 of a spare account) and restart it. X_FETCHER_DAILY_LIMIT caps the requests per day (150 by default).'
          )}
        </div>
        <Warning />
      </GrowthCard>
    );
  }

  return (
    <GrowthCard className="flex flex-col gap-[12px]">
      <div className="flex items-center gap-[12px] flex-wrap">
        <div className="text-[14px] font-[500] flex-1">
          {t('x_collect_title', 'Collect from X (optional)')}
        </div>
        <div className="text-[12px] text-newTextColor/60">
          {t('x_fetcher_usage', '{{used}} / {{limit}} X requests today', {
            used: status.usedToday,
            limit: status.dailyLimit,
          })}
          {status.mode === 'cookies'
            ? ` · ${t('spare_account', 'spare account')}`
            : ` · ${t('guest_mode', 'guest mode')}`}
        </div>
      </div>
      <Warning />
      <div className="flex gap-[8px]">
        {(['user', 'search'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={clsx(
              'text-[13px] px-[12px] py-[4px] rounded-full border border-newTableBorder',
              mode === value && 'bg-boxHover'
            )}
          >
            {value === 'user'
              ? t('from_handle', 'From @handle')
              : t('from_search', 'From search')}
          </button>
        ))}
      </div>
      <div className="flex gap-[12px] items-end flex-wrap">
        {mode === 'user' ? (
          <>
            <div className="w-[240px] mobile:w-full">
              <Input
                label={t('handle', 'Handle')}
                name="fetchHandle"
                placeholder="@account"
                disableForm={true}
                removeError={true}
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-[6px] cursor-pointer text-[13px] pb-[10px]">
              <input
                type="checkbox"
                checked={includeReplies}
                onChange={(e) => setIncludeReplies(e.target.checked)}
                className="w-[16px] h-[16px] accent-[#612BD3]"
              />
              {t('include_replies', 'Include replies')}
            </label>
          </>
        ) : (
          <>
            <div className="flex-1 min-w-[240px]">
              <Input
                label={t('search_x', 'Search X')}
                name="fetchQuery"
                placeholder="forex risk management lang:en"
                maxLength={300}
                disableForm={true}
                removeError={true}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="w-[130px]">
              <Select
                label={t('sort_by', 'Sort by')}
                name="fetchMode"
                disableForm={true}
                hideErrors={true}
                value={searchMode}
                onChange={(e) => setSearchMode(e.target.value as any)}
              >
                <option value="top">{t('top', 'Top')}</option>
                <option value="latest">{t('latest', 'Latest')}</option>
              </Select>
            </div>
            <div className="w-[120px]">
              <Input
                label={t('min_likes', 'Min. likes')}
                name="fetchMinLikes"
                type="number"
                disableForm={true}
                removeError={true}
                value={minLikes}
                onChange={(e) => setMinLikes(e.target.value)}
              />
            </div>
          </>
        )}
        <Button
          onClick={collect}
          loading={busy === 'collect'}
          disabled={
            mode === 'user'
              ? !/^@?[A-Za-z0-9_]{1,15}$/.test(handle.trim())
              : !query.trim()
          }
        >
          {t('collect', 'Collect')}
        </Button>
      </div>

      {results && !results.length && (
        <div className="text-[13px] text-newTextColor/60">
          {t('no_tweets_found', 'No tweets found')}
        </div>
      )}
      {!!results?.length && (
        <>
          <div className="flex gap-[12px] items-center flex-wrap text-[13px]">
            <span>
              {t('selected_tweets', '{{count}} selected', {
                count: selected.length,
              })}
            </span>
            <button
              type="button"
              className="underline text-newTextColor/70"
              onClick={() =>
                setSelected(
                  results
                    .filter((p) => p.viral && !p.inLibrary)
                    .map((p) => p.id)
                )
              }
            >
              {t('select_all_viral', 'Select all viral')}
            </button>
            <Button
              onClick={save}
              loading={busy === 'save'}
              disabled={!selected.length}
            >
              {t('save_selected', 'Save selected')}
            </Button>
          </div>
          <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[8px] max-h-[600px] overflow-y-auto">
            {results.map((tweet) => (
              <label
                key={tweet.id}
                className={clsx(
                  'flex gap-[8px] items-start border rounded-[8px] p-[10px] cursor-pointer',
                  tweet.viral ? 'border-[#612BD3]' : 'border-newTableBorder',
                  tweet.inLibrary && 'opacity-60'
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(tweet.id)}
                  disabled={tweet.inLibrary}
                  onChange={toggle(tweet.id)}
                  className="w-[16px] h-[16px] mt-[2px] accent-[#612BD3]"
                />
                <div className="flex flex-col gap-[4px] min-w-0 flex-1">
                  <div className="flex items-center gap-[6px] flex-wrap text-[12px]">
                    <span className="text-newTextColor/80">
                      @{tweet.authorHandle}
                    </span>
                    {tweet.postedAt && (
                      <span className="text-newTextColor/50">
                        {fromUtc(tweet.postedAt).format('DD/MM/YYYY')}
                      </span>
                    )}
                    {tweet.ratio ? (
                      <span className="px-[6px] rounded-full bg-[#612BD3] text-white">
                        {t('times_usual', '{{ratio}}× usual', {
                          ratio: Math.round(tweet.ratio * 10) / 10,
                        })}
                      </span>
                    ) : null}
                    {tweet.viral && (
                      <span className="text-[#612BD3] font-[500]">
                        {t('viral', 'viral')}
                      </span>
                    )}
                    {tweet.inLibrary && (
                      <span className="text-newTextColor/60">
                        {t('already_saved', 'already saved')}
                      </span>
                    )}
                  </div>
                  <div className="text-[13px] whitespace-pre-wrap break-words line-clamp-6">
                    {tweet.text}
                  </div>
                  <div className="text-[12px] text-newTextColor/60">
                    {tweet.likes} {t('likes', 'likes')} · {tweet.reposts}{' '}
                    {t('reposts', 'reposts')} · {tweet.replies}{' '}
                    {t('replies', 'replies')}
                    {tweet.views !== null
                      ? ` · ${tweet.views} ${t('views', 'views')}`
                      : ''}
                  </div>
                </div>
              </label>
            ))}
          </div>
        </>
      )}
    </GrowthCard>
  );
};
