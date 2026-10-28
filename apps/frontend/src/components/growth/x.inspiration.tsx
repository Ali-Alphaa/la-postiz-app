'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { Textarea } from '@gitroom/react/form/textarea';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  fromUtc,
  newDayjs,
} from '@gitroom/frontend/components/layout/set.timezone';
import { AddEditModal } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import {
  errorMessage,
  GrowthIntegration,
  useGrowthIntegrations,
  useXLibrary,
  useXStatus,
  useXVoice,
  XLibraryFilters,
} from '@gitroom/frontend/components/growth/growth.hooks';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import { textToHtml } from '@gitroom/frontend/components/growth/ab.tests';

const X_MAX_CHARACTERS = 280;
const MAX_REPURPOSE = 10;

const HOOK_TYPES = [
  'question',
  'contrarian',
  'story',
  'list',
  'stat',
  'how-to',
  'announcement',
  'other',
];
const FORMATS = [
  'one-liner',
  'thread-starter',
  'list',
  'long-form',
  'media-led',
];

const defaultFilters: XLibraryFilters = {
  page: 1,
  search: '',
  topic: '',
  hookType: '',
  format: '',
  niche: 'on',
  source: '',
  minRatio: '',
  sort: 'ratio',
};

// the X channels of the organization: the library posts only to X
const useXChannels = () => {
  const { data } = useGrowthIntegrations();
  return useMemo(
    () => (data || []).filter((p) => p.identifier === 'x' && !p.disabled),
    [data]
  );
};

// a failed AI call, as a message for the user
const useAiError = () => {
  const t = useT();
  return useCallback(
    (result: { available: boolean; error: string | null }) => {
      if (!result.available) {
        return t(
          'claude_not_configured',
          'Claude is not configured on this server (ANTHROPIC_API_KEY)'
        );
      }
      if (result.error === 'refusal') {
        return t(
          'claude_refused',
          'Claude declined this request, try another tweet'
        );
      }
      if (result.error === 'rate_limited') {
        return t(
          'claude_rate_limited',
          'Claude is busy right now, try again in a minute'
        );
      }
      if (result.error) {
        return t('something_went_wrong', 'Something went wrong');
      }
      return '';
    },
    [t]
  );
};

const useOpenEditor = () => {
  const fetch = useFetch();
  const modal = useModals();
  const { data: integrations } = useGrowthIntegrations();

  return useCallback(
    async (posts: string[], channelId?: string) => {
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
            selectedChannels={channelId ? [channelId] : []}
            onlyValues={posts.map((p) => ({ content: textToHtml(p) }))}
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
};

const AiWarning: FC = () => {
  const t = useT();
  return (
    <GrowthCard className="text-[13px] border-yellow-500/60">
      {t(
        'claude_not_configured_long',
        'Claude is not configured on this server: set ANTHROPIC_API_KEY (and optionally ANTHROPIC_MODEL) in the environment of the backend and restart it. Tweets are still saved, tagging and rewriting are off until then.'
      )}
    </GrowthCard>
  );
};

const SetupCard: FC = () => {
  const t = useT();
  return (
    <GrowthCard className="flex flex-col gap-[8px] text-[14px]">
      <div className="text-[16px] font-[500]">
        {t('x_setup_title', 'Fill your library from X')}
      </div>
      <ol className="list-decimal ps-[20px] flex flex-col gap-[4px] text-newTextColor/80">
        <li>
          {t(
            'x_setup_step_1',
            'Build the Postiz extension (pnpm run build:extension) and load apps/extension/dist in Chrome: chrome://extensions, Developer mode, Load unpacked.'
          )}
        </li>
        <li>
          {t(
            'x_setup_step_2',
            'Copy your API key from Settings → Public API.'
          )}
        </li>
        <li>
          {t(
            'x_setup_step_3',
            'Open the options of the extension (click its icon), enter the address of this Postiz and the API key, then Test connection.'
          )}
        </li>
        <li>
          {t(
            'x_setup_step_4',
            'Browse x.com as usual. Tweets with 3× their author’s usual likes are saved here, the "Save to Postiz" button saves any tweet, and opening your own profile teaches Claude your voice.'
          )}
        </li>
      </ol>
      <div className="text-[13px] text-newTextColor/60">
        {t(
          'x_setup_note',
          'The extension only reads the pages you open. It never scrolls, clicks, likes or posts on X.'
        )}
      </div>
    </GrowthCard>
  );
};

const AddTweet: FC<{ onSaved: () => void }> = ({ onSaved }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [needText, setNeedText] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    const response = await fetch('/growth/x/library', {
      method: 'POST',
      body: JSON.stringify({ url, ...(text.trim() ? { text } : {}) }),
    });
    setSaving(false);
    if (!response.ok) {
      const message = await errorMessage(
        response,
        t('something_went_wrong', 'Something went wrong')
      );
      // X didn't answer: the text can be pasted by hand
      if (/paste its text/i.test(message)) {
        setNeedText(true);
      }
      toaster.show(message, 'warning');
      return;
    }
    toaster.show(t('tweet_saved', 'Tweet saved'), 'success');
    setUrl('');
    setText('');
    setNeedText(false);
    onSaved();
  }, [url, text, onSaved]);

  return (
    <GrowthCard className="flex flex-col gap-[12px]">
      <div className="flex gap-[12px] items-end flex-wrap">
        <div className="flex-1 min-w-[260px]">
          <Input
            label={t('add_tweet_by_link', 'Add a tweet by its link')}
            name="tweetUrl"
            placeholder="https://x.com/user/status/123"
            disableForm={true}
            removeError={true}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
        <Button
          onClick={save}
          loading={saving}
          disabled={!/\/status(es)?\/\d+/.test(url)}
        >
          {t('save', 'Save')}
        </Button>
      </div>
      {needText && (
        <Textarea
          label={t(
            'tweet_text_fallback',
            'X could not read this tweet: paste its text'
          )}
          name="tweetText"
          disableForm={true}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
    </GrowthCard>
  );
};

const Chip: FC<{ children: string; onClick?: () => void }> = ({
  children,
  onClick,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="text-[12px] px-[8px] py-[2px] rounded-full border border-newTableBorder text-newTextColor/80 hover:bg-boxHover"
  >
    {children}
  </button>
);

const DraftEditor: FC<{
  index: number;
  posts: string[];
  onChange: (posts: string[]) => void;
}> = ({ index, posts, onChange }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[8px]">
      {posts.map((post, postIndex) => (
        <div key={postIndex} className="flex flex-col gap-[2px]">
          <Textarea
            label={
              posts.length > 1
                ? `${index + 1}.${postIndex + 1}`
                : t('variation', 'Variation') + ` ${index + 1}`
            }
            name={`draft-${index}-${postIndex}`}
            disableForm={true}
            value={post}
            onChange={(e) =>
              onChange(
                posts.map((p, i) => (i === postIndex ? e.target.value : p))
              )
            }
          />
          <div
            className={clsx(
              'text-[12px] text-end',
              post.length > X_MAX_CHARACTERS
                ? 'text-red-400'
                : 'text-newTextColor/60'
            )}
          >
            {post.length}/{X_MAX_CHARACTERS}
          </div>
        </div>
      ))}
    </div>
  );
};

// The drafts of a rewrite or the 5 variations of a repurpose. A repurpose
// can be posted from here, through the usual post creation of Postiz.
const Drafts: FC<{
  title: string;
  drafts: string[][];
  repurposeId?: string;
  onClose: () => void;
}> = ({ title, drafts: initial, repurposeId, onClose }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const openEditor = useOpenEditor();
  const channels = useXChannels();
  const [drafts, setDrafts] = useState(initial);
  const [channel, setChannel] = useState('');
  const [dates, setDates] = useState<Record<number, string>>({});
  const [posting, setPosting] = useState('');
  const [posted, setPosted] = useState<Record<number, string>>({});

  useEffect(() => setDrafts(initial), [initial]);
  useEffect(() => {
    if (!channel && channels.length) {
      setChannel(channels[0].id);
    }
  }, [channels, channel]);

  const post = useCallback(
    (index: number, type: 'now' | 'schedule') => async () => {
      setPosting(`${index}-${type}`);
      const response = await fetch(`/growth/x/repurpose/${repurposeId}/post`, {
        method: 'POST',
        body: JSON.stringify({
          index,
          integrationId: channel,
          posts: drafts[index],
          type,
          ...(type === 'schedule'
            ? { date: newDayjs(dates[index]).utc().toISOString() }
            : {}),
        }),
      });
      setPosting('');
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
      const { date } = await response.json();
      setPosted((prev) => ({ ...prev, [index]: date }));
      toaster.show(
        type === 'now'
          ? t('post_sent', 'Your post is being published')
          : t('post_scheduled', 'Your post is scheduled'),
        'success'
      );
    },
    [repurposeId, channel, drafts, dates]
  );

  return (
    <GrowthCard className="flex flex-col gap-[12px] border-[#612BD3]">
      <div className="flex items-center gap-[12px] flex-wrap">
        <div className="text-[16px] font-[500] flex-1">{title}</div>
        {!!repurposeId &&
          (channels.length ? (
            <div className="w-[260px] mobile:w-full">
              <Select
                label={t('x_channel', 'X channel')}
                name="xChannel"
                disableForm={true}
                hideErrors={true}
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
              >
                {channels.map((p: GrowthIntegration) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <div className="text-[13px] text-yellow-500">
              {t(
                'connect_x_first',
                'Connect an X channel first (Add Channel in the calendar) to post from here'
              )}
            </div>
          ))}
        <button
          type="button"
          className="text-[13px] text-newTextColor/60 underline"
          onClick={onClose}
        >
          {t('close', 'Close')}
        </button>
      </div>
      <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[12px]">
        {drafts.map((posts, index) => (
          <div
            key={index}
            className="flex flex-col gap-[8px] border border-newTableBorder rounded-[8px] p-[12px]"
          >
            <DraftEditor
              index={index}
              posts={posts}
              onChange={(value) =>
                setDrafts((prev) =>
                  prev.map((p, i) => (i === index ? value : p))
                )
              }
            />
            {posted[index] ? (
              <div className="text-[13px] text-green-500">
                {t('posted_for', 'Created for')}{' '}
                {fromUtc(posted[index]).format('DD/MM/YYYY HH:mm')} ·{' '}
                <a href="/launches" className="underline">
                  {t('open_calendar', 'Open the calendar')}
                </a>
              </div>
            ) : (
              <div className="flex gap-[8px] flex-wrap items-end">
                <Button
                  secondary={true}
                  onClick={() => openEditor(posts, channel || channels[0]?.id)}
                >
                  {t('open_in_editor', 'Open in editor')}
                </Button>
                {!!repurposeId && !!channels.length && (
                  <>
                    <Button
                      onClick={post(index, 'now')}
                      loading={posting === `${index}-now`}
                      disabled={!channel || !!posting}
                    >
                      {t('post_now', 'Post now')}
                    </Button>
                    <div className="w-[200px]">
                      <Input
                        label={t('schedule_at', 'Schedule at')}
                        name={`date-${index}`}
                        type="datetime-local"
                        disableForm={true}
                        removeError={true}
                        value={dates[index] || ''}
                        onChange={(e) =>
                          setDates((prev) => ({
                            ...prev,
                            [index]: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <Button
                      secondary={true}
                      onClick={post(index, 'schedule')}
                      loading={posting === `${index}-schedule`}
                      disabled={!channel || !dates[index] || !!posting}
                    >
                      {t('schedule', 'Schedule')}
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </GrowthCard>
  );
};

const TweetCard: FC<{
  tweet: any;
  selected: boolean;
  onSelect: () => void;
  onFilter: (key: 'topic' | 'hookType' | 'format', value: string) => void;
  onRewrite: () => void;
  rewriting: boolean;
  onHide: () => void;
}> = ({ tweet, selected, onSelect, onFilter, onRewrite, rewriting, onHide }) => {
  const t = useT();
  return (
    <GrowthCard
      className={clsx(
        'flex flex-col gap-[10px]',
        selected && '!border-[#612BD3]'
      )}
    >
      <div className="flex items-center gap-[8px]">
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          aria-label={t('select', 'Select')}
          className="w-[16px] h-[16px] accent-[#612BD3] cursor-pointer"
        />
        <div className="flex flex-col flex-1 min-w-0">
          <span className="truncate text-[14px]">
            {tweet.authorName || tweet.authorHandle}
          </span>
          <span className="truncate text-[12px] text-newTextColor/60">
            @{tweet.authorHandle}
            {tweet.postedAt
              ? ` · ${fromUtc(tweet.postedAt).format('DD/MM/YYYY')}`
              : ''}
          </span>
        </div>
        {tweet.ratio > 0 ? (
          <span className="text-[12px] px-[8px] py-[2px] rounded-full bg-[#612BD3] text-white whitespace-nowrap">
            {t('times_usual', '{{ratio}}× usual', {
              ratio: Math.round(tweet.ratio * 10) / 10,
            })}
          </span>
        ) : null}
        {tweet.source === 'manual' && (
          <span className="text-[12px] px-[8px] py-[2px] rounded-full border border-newTableBorder whitespace-nowrap">
            {t('saved_by_me', 'Saved by me')}
          </span>
        )}
        <a
          href={tweet.url}
          target="_blank"
          rel="noreferrer"
          className="text-[12px] underline text-newTextColor/60"
        >
          {t('open_on_x', 'Open on X')}
        </a>
      </div>
      <div className="text-[14px] whitespace-pre-wrap break-words flex-1">
        {tweet.text}
      </div>
      <div className="text-[12px] text-newTextColor/60">
        {tweet.likes} {t('likes', 'likes')} · {tweet.reposts}{' '}
        {t('reposts', 'reposts')} · {tweet.replies} {t('replies', 'replies')}
        {tweet.views !== null ? ` · ${tweet.views} ${t('views', 'views')}` : ''}
        {tweet.mediaType !== 'none' ? ` · ${tweet.mediaType}` : ''}
      </div>
      {(!!tweet.topics?.length || tweet.hookType || tweet.format) && (
        <div className="flex gap-[6px] flex-wrap">
          {tweet.topics.map((topic: string) => (
            <Chip key={topic} onClick={() => onFilter('topic', topic)}>
              {topic}
            </Chip>
          ))}
          {!!tweet.hookType && (
            <Chip onClick={() => onFilter('hookType', tweet.hookType)}>
              {`${t('hook', 'hook')}: ${tweet.hookType}`}
            </Chip>
          )}
          {!!tweet.format && (
            <Chip onClick={() => onFilter('format', tweet.format)}>
              {tweet.format}
            </Chip>
          )}
          {tweet.onNiche === false && (
            <Chip>{t('off_niche', 'off-niche')}</Chip>
          )}
        </div>
      )}
      <div className="flex gap-[8px] items-center">
        <Button onClick={onRewrite} loading={rewriting}>
          {t('rewrite_in_my_voice', 'Rewrite in my voice')}
        </Button>
        <button
          type="button"
          className="text-[13px] text-red-400 ms-auto"
          onClick={onHide}
        >
          {t('hide', 'Hide')}
        </button>
      </div>
    </GrowthCard>
  );
};

export const XInspiration: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const aiError = useAiError();
  const [filters, setFilters] = useState(defaultFilters);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [format, setFormat] = useState<'single' | 'thread'>('single');
  const [useMyVoice, setUseMyVoice] = useState(false);
  const [busy, setBusy] = useState('');
  const [drafts, setDrafts] = useState<{
    title: string;
    drafts: string[][];
    repurposeId?: string;
  } | null>(null);
  const { data: status, mutate: mutateStatus } = useXStatus();
  const { data, mutate } = useXLibrary(filters);

  // the search is sent after the user stops typing
  useEffect(() => {
    const timeout = setTimeout(
      () => setFilters((prev) => ({ ...prev, search, page: 1 })),
      400
    );
    return () => clearTimeout(timeout);
  }, [search]);

  const setFilter = useCallback(
    <K extends keyof XLibraryFilters>(key: K, value: XLibraryFilters[K]) =>
      setFilters((prev) => ({ ...prev, [key]: value, page: 1 })),
    []
  );

  const reload = useCallback(() => {
    mutate();
    mutateStatus();
  }, [mutate, mutateStatus]);

  const failed = useCallback(async (response: Response) => {
    toaster.show(
      await errorMessage(
        response,
        t('something_went_wrong', 'Something went wrong')
      ),
      'warning'
    );
  }, []);

  const analyze = useCallback(async () => {
    setBusy('analyze');
    const response = await fetch('/growth/x/library/analyze', {
      method: 'POST',
    });
    setBusy('');
    if (!response.ok) {
      return failed(response);
    }
    const result = await response.json();
    const message = aiError(result);
    if (message) {
      toaster.show(message, 'warning');
    } else {
      toaster.show(
        result.running
          ? t('analysis_running', 'The analysis is already running')
          : t('tweets_analyzed', '{{count}} tweets analyzed', {
              count: result.analyzed,
            }),
        'success'
      );
    }
    reload();
  }, [reload]);

  const rewrite = useCallback(
    (tweet: any) => async () => {
      setBusy(`rewrite-${tweet.id}`);
      const response = await fetch(`/growth/x/library/${tweet.id}/rewrite`, {
        method: 'POST',
        body: JSON.stringify({ format }),
      });
      setBusy('');
      if (!response.ok) {
        return failed(response);
      }
      const result = await response.json();
      const message = aiError(result);
      if (message || !result.drafts.length) {
        toaster.show(
          message || t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      setDrafts({
        title: t('drafts_in_your_voice', 'Drafts in your voice'),
        drafts: result.drafts,
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [format]
  );

  const repurpose = useCallback(async () => {
    setBusy('repurpose');
    const response = await fetch('/growth/x/repurpose', {
      method: 'POST',
      body: JSON.stringify({ tweetIds: selected, format, useMyVoice }),
    });
    setBusy('');
    if (!response.ok) {
      return failed(response);
    }
    const result = await response.json();
    const message = aiError(result);
    if (message) {
      toaster.show(message, 'warning');
      return;
    }
    setDrafts({
      title: t('five_variations', '5 variations'),
      drafts: result.variations,
      repurposeId: result.id,
    });
  }, [selected, format, useMyVoice]);

  const hide = useCallback(
    (id: string) => async () => {
      await fetch(`/growth/x/library/${id}`, { method: 'DELETE' });
      setSelected((prev) => prev.filter((p) => p !== id));
      reload();
    },
    [reload]
  );

  const toggle = useCallback(
    (id: string) => () =>
      setSelected((prev) =>
        prev.includes(id)
          ? prev.filter((p) => p !== id)
          : prev.length >= MAX_REPURPOSE
          ? prev
          : [...prev, id]
      ),
    []
  );

  const filtered =
    !!filters.search ||
    !!filters.topic ||
    !!filters.hookType ||
    !!filters.format ||
    !!filters.source ||
    !!filters.minRatio ||
    filters.niche !== 'on';

  return (
    <GrowthSection
      title={t('x_inspiration', 'X Inspiration')}
      description={t(
        'x_inspiration_description',
        'Tweets that did 3× better than their author’s usual, collected by the Postiz extension while you browse X, and the tweets you saved. Repurpose them into new posts.'
      )}
    >
      {status && !status.aiAvailable && <AiWarning />}
      {!!drafts && (
        <Drafts
          title={drafts.title}
          drafts={drafts.drafts}
          repurposeId={drafts.repurposeId}
          onClose={() => setDrafts(null)}
        />
      )}
      <AddTweet onSaved={reload} />
      <GrowthCard className="flex gap-[12px] items-end flex-wrap">
        <div className="w-[220px] mobile:w-full">
          <Input
            label={t('search', 'Search')}
            name="search"
            disableForm={true}
            removeError={true}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="w-[160px] mobile:w-full">
          <Select
            label={t('topic', 'Topic')}
            name="topic"
            disableForm={true}
            hideErrors={true}
            value={filters.topic}
            onChange={(e) => setFilter('topic', e.target.value)}
          >
            <option value="">{t('all', 'All')}</option>
            {(status?.topics || []).map((topic: string) => (
              <option key={topic} value={topic}>
                {topic}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[150px] mobile:w-full">
          <Select
            label={t('hook_type', 'Hook')}
            name="hookType"
            disableForm={true}
            hideErrors={true}
            value={filters.hookType}
            onChange={(e) => setFilter('hookType', e.target.value)}
          >
            <option value="">{t('all', 'All')}</option>
            {HOOK_TYPES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[150px] mobile:w-full">
          <Select
            label={t('format', 'Format')}
            name="format"
            disableForm={true}
            hideErrors={true}
            value={filters.format}
            onChange={(e) => setFilter('format', e.target.value)}
          >
            <option value="">{t('all', 'All')}</option>
            {FORMATS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-[170px] mobile:w-full">
          <Select
            label={t('niche', 'Niche')}
            name="niche"
            disableForm={true}
            hideErrors={true}
            value={filters.niche}
            onChange={(e) => setFilter('niche', e.target.value as any)}
          >
            <option value="on">{t('trading_markets', 'Trading & markets')}</option>
            <option value="off">{t('off_niche', 'off-niche')}</option>
            <option value="all">{t('all', 'All')}</option>
          </Select>
        </div>
        <div className="w-[160px] mobile:w-full">
          <Select
            label={t('saved_how', 'Saved')}
            name="source"
            disableForm={true}
            hideErrors={true}
            value={filters.source}
            onChange={(e) => setFilter('source', e.target.value as any)}
          >
            <option value="">{t('all', 'All')}</option>
            <option value="auto">{t('auto_captured', 'Auto-captured')}</option>
            <option value="manual">{t('saved_by_me', 'Saved by me')}</option>
          </Select>
        </div>
        <div className="w-[120px] mobile:w-full">
          <Input
            label={t('min_ratio', 'Min. × usual')}
            name="minRatio"
            type="number"
            disableForm={true}
            removeError={true}
            value={filters.minRatio}
            onChange={(e) => setFilter('minRatio', e.target.value)}
          />
        </div>
        <div className="w-[150px] mobile:w-full">
          <Select
            label={t('sort_by', 'Sort by')}
            name="sort"
            disableForm={true}
            hideErrors={true}
            value={filters.sort}
            onChange={(e) => setFilter('sort', e.target.value as any)}
          >
            <option value="ratio">{t('times_above_usual', '× above usual')}</option>
            <option value="likes">{t('likes', 'likes')}</option>
            <option value="recent">{t('recent', 'Recent')}</option>
          </Select>
        </div>
        {filtered && (
          <button
            type="button"
            className="text-[13px] underline text-newTextColor/60 pb-[10px]"
            onClick={() => {
              setSearch('');
              setFilters(defaultFilters);
            }}
          >
            {t('reset', 'Reset')}
          </button>
        )}
        {!!status?.toAnalyze && status?.aiAvailable && (
          <Button
            secondary={true}
            onClick={analyze}
            loading={busy === 'analyze'}
            className="ms-auto"
          >
            {t('analyze_pending', 'Analyze pending ({{count}})', {
              count: status.toAnalyze,
            })}
          </Button>
        )}
      </GrowthCard>

      <GrowthCard className="flex gap-[12px] items-center flex-wrap text-[14px]">
        <span>
          {selected.length
            ? t('selected_tweets', '{{count}} selected', {
                count: selected.length,
              })
            : t(
                'select_to_repurpose',
                'Select 1 to 10 tweets to repurpose them into 5 variations'
              )}
        </span>
        <div className="w-[140px]">
          <Select
            label=""
            name="draftFormat"
            disableForm={true}
            hideErrors={true}
            value={format}
            onChange={(e) => setFormat(e.target.value as any)}
          >
            <option value="single">{t('single_post', 'Single post')}</option>
            <option value="thread">{t('thread', 'Thread')}</option>
          </Select>
        </div>
        <label className="flex items-center gap-[6px] cursor-pointer">
          <input
            type="checkbox"
            checked={useMyVoice}
            onChange={(e) => setUseMyVoice(e.target.checked)}
            className="w-[16px] h-[16px] accent-[#612BD3]"
          />
          {t('use_my_voice', 'Use my voice instead of the source tone')}
        </label>
        <Button
          onClick={repurpose}
          loading={busy === 'repurpose'}
          disabled={!selected.length || !status?.aiAvailable}
        >
          {t('repurpose', 'Repurpose')}
        </Button>
        {!!selected.length && (
          <button
            type="button"
            className="text-[13px] underline text-newTextColor/60"
            onClick={() => setSelected([])}
          >
            {t('clear', 'Clear')}
          </button>
        )}
      </GrowthCard>

      {data && !data.results?.length ? (
        filtered ? (
          <GrowthCard className="text-[13px] text-newTextColor/60">
            {t('no_tweets_match', 'No tweets match these filters')}
          </GrowthCard>
        ) : (
          <SetupCard />
        )
      ) : (
        <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[12px]">
          {(data?.results || []).map((tweet: any) => (
            <TweetCard
              key={tweet.id}
              tweet={tweet}
              selected={selected.includes(tweet.id)}
              onSelect={toggle(tweet.id)}
              onFilter={setFilter}
              onRewrite={rewrite(tweet)}
              rewriting={busy === `rewrite-${tweet.id}`}
              onHide={hide(tweet.id)}
            />
          ))}
        </div>
      )}

      {(data?.pages || 0) > 1 && (
        <div className="flex gap-[12px] items-center justify-center text-[14px]">
          <Button
            secondary={true}
            disabled={filters.page <= 1}
            onClick={() =>
              setFilters((prev) => ({ ...prev, page: prev.page - 1 }))
            }
          >
            {t('previous', 'Previous')}
          </Button>
          <span>
            {filters.page} / {data.pages}
          </span>
          <Button
            secondary={true}
            disabled={filters.page >= data.pages}
            onClick={() =>
              setFilters((prev) => ({ ...prev, page: prev.page + 1 }))
            }
          >
            {t('next', 'Next')}
          </Button>
        </div>
      )}
    </GrowthSection>
  );
};

export const XVoice: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const aiError = useAiError();
  const { data, mutate } = useXVoice();
  const [styleGuide, setStyleGuide] = useState('');
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (data) {
      setStyleGuide(data.styleGuide || '');
    }
  }, [data]);

  const save = useCallback(async () => {
    setBusy('save');
    const response = await fetch('/growth/x/voice', {
      method: 'PUT',
      body: JSON.stringify({ styleGuide }),
    });
    setBusy('');
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
    toaster.show(t('saved', 'Saved'), 'success');
    mutate();
  }, [styleGuide]);

  const regenerate = useCallback(async () => {
    setBusy('generate');
    const response = await fetch('/growth/x/voice/generate', {
      method: 'POST',
    });
    setBusy('');
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
    const result = await response.json();
    const message = aiError(result);
    if (message) {
      toaster.show(message, 'warning');
      return;
    }
    setStyleGuide(result.styleGuide);
    mutate();
  }, []);

  return (
    <GrowthSection
      title={t('my_voice', 'My voice')}
      description={t(
        'my_voice_description',
        'Open your own X profile with the Postiz extension installed: your tweets are collected here and Claude writes a style guide from the best performing ones. "Rewrite in my voice" follows this guide; edit it as you like.'
      )}
    >
      {data && !data.aiAvailable && <AiWarning />}
      <GrowthCard className="flex flex-col gap-[12px]">
        <div className="text-[14px] text-newTextColor/80">
          {t('voice_samples', '{{count}} of your tweets collected', {
            count: data?.sampleCount || 0,
          })}
          {data?.handle ? ` (@${data.handle})` : ''}
          {data?.generatedAt
            ? ` · ${t('generated_at', 'generated')} ${fromUtc(
                data.generatedAt
              ).format('DD/MM/YYYY HH:mm')}`
            : ''}
        </div>
        <Textarea
          label={t('style_guide', 'Style guide')}
          name="styleGuide"
          disableForm={true}
          value={styleGuide}
          className="min-h-[360px]"
          onChange={(e) => setStyleGuide(e.target.value)}
        />
        <div className="flex gap-[8px]">
          <Button
            onClick={save}
            loading={busy === 'save'}
            disabled={styleGuide === (data?.styleGuide || '')}
          >
            {t('save', 'Save')}
          </Button>
          <Button
            secondary={true}
            onClick={regenerate}
            loading={busy === 'generate'}
            disabled={!data?.aiAvailable || (data?.sampleCount || 0) < 5}
          >
            {t('regenerate', 'Regenerate with Claude')}
          </Button>
        </div>
      </GrowthCard>
      {!!data?.best?.length && (
        <GrowthCard className="flex flex-col gap-[8px]">
          <div className="text-[14px] font-[500]">
            {t('best_tweets', 'Your best tweets')}
          </div>
          {data.best.map((tweet: any) => (
            <div
              key={tweet.id}
              className="text-[13px] whitespace-pre-wrap border-t border-newTableBorder pt-[8px]"
            >
              {tweet.text}
              <div className="text-newTextColor/60 mt-[4px]">
                {tweet.likes} {t('likes', 'likes')}
              </div>
            </div>
          ))}
        </GrowthCard>
      )}
    </GrowthSection>
  );
};
