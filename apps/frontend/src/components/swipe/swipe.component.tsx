'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { mutate as mutateSwr } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useXVoices } from '@gitroom/frontend/components/growth/growth.hooks';
import { GrowthCard } from '@gitroom/frontend/components/growth/channel.select';
import {
  useAiError,
  useOpenEditor,
} from '@gitroom/frontend/components/growth/x.inspiration';
import {
  SwipeEntry,
  useSwipeEntries,
  useSwipeRuns,
  useSwipeTechniques,
} from '@gitroom/frontend/components/swipe/swipe.hooks';

const inputClass =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] outline-none text-textColor';

const PLATFORMS = [
  { value: 'x', label: 'X' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'threads', label: 'Threads' },
];

const ORIGIN_LABEL: Record<SwipeEntry['origin'], string> = {
  NOTION: 'Notion',
  AI: 'Claude',
  LINK: 'Link',
  MANUAL: 'Manual',
};

// the known platforms, plus the one of the post when it is another one
const platformOptions = (current: string) =>
  PLATFORMS.some((p) => p.value === current)
    ? PLATFORMS
    : [...PLATFORMS, { value: current, label: current }];

const DEFAULT_TECHNIQUES = ['substitute', 'modify', 'reverse'];

// every list of entries is refreshed: an approved post moves between them
const reloadEntries = () =>
  mutateSwr(
    (key) => typeof key === 'string' && key.startsWith('swipe-entries-')
  );

const Chip: FC<{ children: string }> = ({ children }) => (
  <span className="text-[11px] px-[8px] py-[2px] rounded-full border border-newTableBorder text-textItemBlur">
    {children}
  </span>
);

export const SwipeComponent: FC = () => {
  const [tab, setTab] = useState<'library' | 'inbox' | 'toolkit'>('library');
  const { data: inbox } = useSwipeEntries('INBOX', {});
  const t = useT();

  const tabs = [
    { key: 'library' as const, label: t('swipe_library', 'Library') },
    {
      key: 'inbox' as const,
      label: `${t('swipe_inbox', 'Inbox')}${
        inbox?.length ? ` (${inbox.length})` : ''
      }`,
    },
    { key: 'toolkit' as const, label: t('swipe_toolkit', 'Toolkit') },
  ];

  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all">
      <div className="flex gap-[8px]">
        {tabs.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setTab(p.key)}
            className={clsx(
              'px-[16px] py-[8px] rounded-[8px] font-[600]',
              tab === p.key
                ? 'bg-boxFocused text-textItemFocused'
                : 'text-textItemBlur hover:bg-boxFocused'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {tab === 'library' && <SwipeLibrary />}
      {tab === 'inbox' && <SwipeInbox />}
      {tab === 'toolkit' && <SwipeToolkit />}
    </div>
  );
};

const EntryMeta: FC<{ entry: SwipeEntry }> = ({ entry }) => {
  const t = useT();
  return (
    <>
      <div className="whitespace-pre-wrap break-words text-[14px]">
        {entry.content}
      </div>
      {!!entry.whyItWorks && (
        <div className="text-[12px] text-textItemBlur">
          <b>{t('swipe_why_it_works', 'Why it works:')}</b> {entry.whyItWorks}
        </div>
      )}
      <div className="text-[12px] text-textItemBlur flex gap-[8px] flex-wrap">
        {!!entry.author && <span>{entry.author}</span>}
        {!!entry.sourceUrl && (
          <a
            href={entry.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {t('swipe_source', 'Source')}
          </a>
        )}
        {!!entry.lastRepurposedAt && (
          <span>
            {t('swipe_repurposed', 'Repurposed')}{' '}
            {new Date(entry.lastRepurposedAt).toLocaleDateString()}
          </span>
        )}
      </div>
    </>
  );
};

const SwipeLibrary: FC = () => {
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [formatTag, setFormatTag] = useState('');
  const [collection, setCollection] = useState('');
  const [starred, setStarred] = useState(false);
  const { data } = useSwipeEntries('LIBRARY', {
    q,
    formatTag,
    collection,
    starred,
  });
  const { data: all } = useSwipeEntries('LIBRARY', {});

  // the search is sent after the user stops typing
  useEffect(() => {
    const timeout = setTimeout(() => setQ(search), 400);
    return () => clearTimeout(timeout);
  }, [search]);

  const modals = useModals();
  const t = useT();

  const unique = (values: Array<string | null | undefined>) =>
    Array.from(new Set(values.filter(Boolean))).sort() as string[];
  const formats = unique((all || []).map((p) => p.formatTag));
  const collections = unique((all || []).map((p) => p.collection));

  const edit = useCallback(
    (entry?: SwipeEntry) => () => {
      modals.openModal({
        title: entry
          ? t('swipe_edit_post', 'Edit post')
          : t('swipe_add_post', 'Add post'),
        withCloseButton: true,
        children: (close) => (
          <SwipeEntryForm
            entry={entry}
            done={() => {
              close();
              reloadEntries();
            }}
          />
        ),
      });
    },
    [t]
  );

  return (
    <>
      <div className="flex gap-[8px] flex-wrap items-center">
        <input
          className={clsx(inputClass, 'max-w-[280px]')}
          placeholder={t('swipe_search', 'Search posts, authors, tags')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className={clsx(inputClass, 'max-w-[220px]')}
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
        >
          <option value="">
            {t('swipe_all_collections', 'All collections')}
          </option>
          {collections.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className={clsx(inputClass, 'max-w-[220px]')}
          value={formatTag}
          onChange={(e) => setFormatTag(e.target.value)}
        >
          <option value="">{t('swipe_all_formats', 'All formats')}</option>
          {formats.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-[6px] cursor-pointer">
          <input
            type="checkbox"
            checked={starred}
            onChange={(e) => setStarred(e.target.checked)}
          />
          {t('swipe_starred_only', 'Starred only')}
        </label>
        <div className="flex-1" />
        <Button onClick={edit()}>{t('swipe_add_post', 'Add post')}</Button>
      </div>
      {!data?.length ? (
        <div className="text-textItemBlur py-[40px] text-center">
          {t(
            'swipe_empty',
            'Nothing here yet. Add a post, or approve what Claude finds from the Inbox.'
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 mobile:grid-cols-1 gap-[16px]">
          {data.map((entry) => (
            <SwipeCard key={entry.id} entry={entry} edit={edit(entry)} />
          ))}
        </div>
      )}
    </>
  );
};

const SwipeCard: FC<{ entry: SwipeEntry; edit: () => void }> = ({
  entry,
  edit,
}) => {
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const t = useT();

  const star = useCallback(async () => {
    await fetch(`/swipe/${entry.id}/star`, {
      method: 'PUT',
      body: JSON.stringify({ starred: !entry.starred }),
    });
    reloadEntries();
  }, [entry]);

  const remove = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('swipe_delete_confirm', 'Are you sure you want to delete this post?')
      ))
    ) {
      return;
    }
    await fetch(`/swipe/${entry.id}`, { method: 'DELETE' });
    toaster.show(t('swipe_deleted', 'Post deleted'), 'success');
    reloadEntries();
  }, [entry, t]);

  const repurpose = useCallback(() => {
    modals.openModal({
      title: t('swipe_repurpose_post', 'Repurpose post'),
      withCloseButton: true,
      size: '800px',
      children: <SwipeRepurpose entry={entry} />,
    });
  }, [entry, t]);

  return (
    <GrowthCard className="flex flex-col gap-[12px]">
      <div className="flex gap-[6px] flex-wrap items-center">
        <Chip>{entry.platform.toUpperCase()}</Chip>
        {!!entry.formatTag && <Chip>{entry.formatTag}</Chip>}
        <Chip>{ORIGIN_LABEL[entry.origin]}</Chip>
        <div className="flex-1" />
        <button
          type="button"
          onClick={star}
          title={t('swipe_star', 'Star')}
          className={entry.starred ? 'text-yellow-400' : 'text-textItemBlur'}
        >
          {entry.starred ? '★' : '☆'}
        </button>
      </div>
      <EntryMeta entry={entry} />
      <div className="flex gap-[8px] items-center mt-auto">
        <Button onClick={repurpose}>{t('swipe_repurpose', 'Repurpose')}</Button>
        <Button secondary={true} onClick={edit}>
          {t('edit', 'Edit')}
        </Button>
        <button
          type="button"
          className="text-[13px] text-red-400 ms-auto"
          onClick={remove}
        >
          {t('delete', 'Delete')}
        </button>
      </div>
    </GrowthCard>
  );
};

const SwipeRepurpose: FC<{ entry: SwipeEntry }> = ({ entry }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const openEditor = useOpenEditor();
  const aiError = useAiError();
  const { data: techniques } = useSwipeTechniques();
  const { data: voices } = useXVoices();
  const withGuide = (
    (voices || []) as Array<{
      handle: string;
      hasGuide: boolean;
    }>
  ).filter((p) => p.hasGuide);
  const [picked, setPicked] = useState<string[]>(DEFAULT_TECHNIQUES);
  const [platform, setPlatform] = useState(entry.platform);
  const [topic, setTopic] = useState('');
  // null until the user chooses: their first voice, or the tone of the source
  const [voice, setVoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<
    Array<{ technique: string; content: string }>
  >([]);
  const t = useT();
  const voiceHandle = voice ?? withGuide[0]?.handle ?? '';

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/swipe/${entry.id}/repurpose`, {
        method: 'POST',
        body: JSON.stringify({
          techniques: picked,
          platform,
          ...(topic ? { topic } : {}),
          ...(voiceHandle ? { voiceHandle } : {}),
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        toaster.show(
          result?.message || t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      const error = aiError(result);
      if (error) {
        toaster.show(error, 'warning');
        return;
      }
      setVariants(result.variants || []);
      reloadEntries();
    } finally {
      setLoading(false);
    }
  }, [picked, platform, topic, voiceHandle, entry, aiError, t]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="whitespace-pre-wrap text-[13px] text-textItemBlur border border-newTableBorder rounded-[8px] p-[12px]">
        {entry.content}
      </div>
      <div className="flex gap-[8px] flex-wrap">
        {(techniques || []).map((tech) => (
          <button
            key={tech.key}
            type="button"
            title={tech.hint}
            onClick={() =>
              setPicked((prev) =>
                prev.includes(tech.key)
                  ? prev.filter((p) => p !== tech.key)
                  : [...prev, tech.key]
              )
            }
            className={clsx(
              'px-[12px] py-[6px] rounded-full border',
              picked.includes(tech.key)
                ? 'border-boxFocused bg-boxFocused text-textItemFocused'
                : 'border-newTableBorder text-textItemBlur'
            )}
          >
            {tech.label}
          </button>
        ))}
      </div>
      <div className="flex gap-[8px] flex-wrap">
        <select
          className={clsx(inputClass, 'max-w-[150px]')}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          {platformOptions(platform).map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <select
          className={clsx(inputClass, 'max-w-[200px]')}
          value={voiceHandle}
          onChange={(e) => setVoice(e.target.value)}
        >
          <option value="">
            {t('swipe_source_tone', 'Tone of the source')}
          </option>
          {withGuide.map((p) => (
            <option key={p.handle} value={p.handle}>
              @{p.handle}
            </option>
          ))}
        </select>
        <input
          className={clsx(inputClass, 'flex-1 min-w-[200px]')}
          placeholder={t(
            'swipe_topic_optional',
            'Topic to write about (optional)'
          )}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>
      <Button
        onClick={generate}
        loading={loading}
        disabled={!picked.length || loading}
      >
        {t('swipe_generate', 'Generate variants')}
      </Button>
      {variants.map((variant, index) => (
        <div
          key={index}
          className="border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[8px]"
        >
          <div>
            <Chip>{variant.technique}</Chip>
          </div>
          <div className="whitespace-pre-wrap">{variant.content}</div>
          <div className="flex gap-[8px]">
            <Button onClick={() => openEditor([variant.content])}>
              {t('swipe_open_composer', 'Open in composer as draft')}
            </Button>
            <Button
              secondary={true}
              onClick={async () => {
                await navigator.clipboard.writeText(variant.content);
                toaster.show(t('swipe_copied', 'Copied'), 'success');
              }}
            >
              {t('swipe_copy', 'Copy')}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};

const SwipeEntryForm: FC<{ entry?: SwipeEntry; done: () => void }> = ({
  entry,
  done,
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const [content, setContent] = useState(entry?.content || '');
  const [platform, setPlatform] = useState(entry?.platform || 'x');
  const [author, setAuthor] = useState(entry?.author || '');
  const [sourceUrl, setSourceUrl] = useState(entry?.sourceUrl || '');
  const [formatTag, setFormatTag] = useState(entry?.formatTag || '');
  const [collection, setCollection] = useState(entry?.collection || '');
  const [tags, setTags] = useState((entry?.topicTags || []).join(', '));
  const [why, setWhy] = useState(entry?.whyItWorks || '');
  const t = useT();

  const save = useCallback(async () => {
    const response = await fetch(entry ? `/swipe/${entry.id}` : '/swipe', {
      method: entry ? 'PUT' : 'POST',
      body: JSON.stringify({
        content,
        platform,
        author: author || null,
        sourceUrl: sourceUrl || null,
        formatTag: formatTag || null,
        collection: collection || null,
        whyItWorks: why || null,
        topicTags: tags
          .split(',')
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean),
      }),
    });
    if (!response.ok) {
      toaster.show(
        response.status === 409
          ? t(
              'swipe_duplicate',
              'This post is already in your swipe file or inbox'
            )
          : t('swipe_save_failed', 'Could not save: check the original URL'),
        'warning'
      );
      return;
    }
    toaster.show(t('swipe_saved', 'Saved'), 'success');
    done();
  }, [
    entry,
    content,
    platform,
    author,
    sourceUrl,
    formatTag,
    collection,
    tags,
    why,
    t,
  ]);

  return (
    <div className="flex flex-col gap-[10px] min-w-[500px] mobile:min-w-0">
      <textarea
        className={clsx(inputClass, 'min-h-[140px]')}
        placeholder={t('swipe_post_text', 'Post text')}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <div className="flex gap-[8px]">
        <select
          className={clsx(inputClass, 'max-w-[140px]')}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          {platformOptions(platform).map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          placeholder={t('swipe_author', 'Author')}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
      </div>
      <input
        className={inputClass}
        placeholder={t('swipe_source_url', 'Original URL')}
        value={sourceUrl}
        onChange={(e) => setSourceUrl(e.target.value)}
      />
      <div className="flex gap-[8px]">
        <input
          className={inputClass}
          placeholder={t('swipe_format', 'Format (e.g. Hook & Sinker)')}
          value={formatTag}
          onChange={(e) => setFormatTag(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={t('swipe_collection', 'Collection')}
          value={collection}
          onChange={(e) => setCollection(e.target.value)}
        />
      </div>
      <input
        className={inputClass}
        placeholder={t('swipe_tags', 'Topic tags, comma separated')}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
      />
      <textarea
        className={inputClass}
        placeholder={t('swipe_why', 'Why it works')}
        value={why}
        onChange={(e) => setWhy(e.target.value)}
      />
      <Button onClick={save} disabled={!content.trim()}>
        {t('save', 'Save')}
      </Button>
    </div>
  );
};

const SwipeInbox: FC = () => {
  const { data } = useSwipeEntries('INBOX', {});
  const { mutate: mutateRuns } = useSwipeRuns();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const aiError = useAiError();
  const t = useT();
  const [topic, setTopic] = useState('');
  const [platform, setPlatform] = useState<'x' | 'instagram' | 'both'>('x');
  const [count, setCount] = useState(5);
  const [finding, setFinding] = useState(false);
  const [link, setLink] = useState('');
  const [linkText, setLinkText] = useState('');

  const find = useCallback(async () => {
    setFinding(true);
    try {
      const response = await fetch('/swipe/find', {
        method: 'POST',
        body: JSON.stringify({ topic, platform, count }),
      });
      const result = await response.json();
      const error = response.ok ? aiError(result) : result?.message;
      if (error) {
        toaster.show(error, 'warning');
        return;
      }
      toaster.show(
        `${t('swipe_found', 'Found')} ${result.found} (${result.searches} ${t(
          'swipe_searches',
          'searches'
        )})`,
        'success'
      );
      reloadEntries();
      mutateRuns();
    } finally {
      setFinding(false);
    }
  }, [topic, platform, count, aiError, t]);

  const addLink = useCallback(async () => {
    const response = await fetch('/swipe/link', {
      method: 'POST',
      body: JSON.stringify({
        url: link,
        ...(linkText ? { content: linkText } : {}),
      }),
    });
    if (!response.ok) {
      toaster.show(
        (await response.json())?.message ||
          t('something_went_wrong', 'Something went wrong'),
        'warning'
      );
      return;
    }
    setLink('');
    setLinkText('');
    reloadEntries();
  }, [link, linkText, t]);

  const approve = useCallback(
    (id: string) => async () => {
      await fetch(`/swipe/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'LIBRARY' }),
      });
      reloadEntries();
    },
    []
  );

  const reject = useCallback(
    (id: string) => async () => {
      await fetch(`/swipe/${id}`, { method: 'DELETE' });
      reloadEntries();
    },
    []
  );

  const edit = useCallback(
    (entry: SwipeEntry) => () => {
      modals.openModal({
        title: t('swipe_edit_post', 'Edit post'),
        withCloseButton: true,
        children: (close) => (
          <SwipeEntryForm
            entry={entry}
            done={() => {
              close();
              reloadEntries();
            }}
          />
        ),
      });
    },
    [t]
  );

  return (
    <>
      <GrowthCard className="flex flex-col gap-[12px]">
        <div className="font-[600]">
          {t('swipe_find_examples', 'Find examples with Claude')}
        </div>
        <div className="flex gap-[8px] flex-wrap">
          <input
            className={clsx(inputClass, 'flex-1 min-w-[220px]')}
            placeholder={t(
              'swipe_topic',
              'Topic, e.g. trading psychology hooks'
            )}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
          <select
            className={clsx(inputClass, 'max-w-[140px]')}
            value={platform}
            onChange={(e) =>
              setPlatform(e.target.value as 'x' | 'instagram' | 'both')
            }
          >
            <option value="x">X</option>
            <option value="instagram">Instagram</option>
            <option value="both">{t('swipe_both', 'Both')}</option>
          </select>
          <input
            type="number"
            min={1}
            max={10}
            className={clsx(inputClass, 'max-w-[90px]')}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
          <Button onClick={find} loading={finding} disabled={!topic || finding}>
            {t('swipe_find', 'Find')}
          </Button>
        </div>
        <div className="text-[12px] text-textItemBlur">
          {t(
            'swipe_find_note',
            'Public web search only, at most 8 searches per run. Results wait here for your approval.'
          )}
        </div>
        <div className="flex gap-[8px] flex-wrap">
          <input
            className={clsx(inputClass, 'flex-1 min-w-[220px]')}
            placeholder={t('swipe_paste_link', 'Paste a post link')}
            value={link}
            onChange={(e) => setLink(e.target.value)}
          />
          <input
            className={clsx(inputClass, 'flex-1 min-w-[220px]')}
            placeholder={t(
              'swipe_link_text',
              'Post text (needed for non-X links)'
            )}
            value={linkText}
            onChange={(e) => setLinkText(e.target.value)}
          />
          <Button onClick={addLink} disabled={!link}>
            {t('swipe_add_link', 'Add link')}
          </Button>
        </div>
      </GrowthCard>
      {!data?.length ? (
        <div className="text-textItemBlur py-[24px] text-center">
          {t('swipe_inbox_empty', 'The inbox is empty.')}
        </div>
      ) : (
        <div className="grid grid-cols-3 mobile:grid-cols-1 gap-[16px]">
          {data.map((entry) => (
            <GrowthCard key={entry.id} className="flex flex-col gap-[12px]">
              <div className="flex gap-[6px] flex-wrap">
                <Chip>{entry.platform.toUpperCase()}</Chip>
                <Chip>{ORIGIN_LABEL[entry.origin]}</Chip>
              </div>
              <EntryMeta entry={entry} />
              <div className="flex gap-[8px] items-center mt-auto">
                <Button onClick={approve(entry.id)}>
                  {t('swipe_approve', 'Approve')}
                </Button>
                <Button secondary={true} onClick={edit(entry)}>
                  {t('edit', 'Edit')}
                </Button>
                <button
                  type="button"
                  className="text-[13px] text-red-400 ms-auto"
                  onClick={reject(entry.id)}
                >
                  {t('swipe_reject', 'Reject')}
                </button>
              </div>
            </GrowthCard>
          ))}
        </div>
      )}
    </>
  );
};

const SwipeToolkit: FC = () => {
  const { data: techniques } = useSwipeTechniques();
  const { data: runs } = useSwipeRuns();
  const t = useT();

  return (
    <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[16px]">
      <GrowthCard className="flex flex-col gap-[10px]">
        <div className="font-[600]">
          {t('swipe_originality_toolkit', 'Originality toolkit (SCAMPER)')}
        </div>
        {(techniques || []).map((tech) => (
          <div key={tech.key} className="text-[13px]">
            <b>{tech.label}.</b>{' '}
            <span className="text-textItemBlur">{tech.hint}</span>
          </div>
        ))}
        <div className="text-[12px] text-textItemBlur">
          {t(
            'swipe_voice_note',
            'Repurposing writes in your voice: edit it under Growth, X: My voice.'
          )}
        </div>
      </GrowthCard>
      <GrowthCard className="flex flex-col gap-[6px]">
        <div className="font-[600]">
          {t('swipe_recent_runs', 'Recent Claude searches')}
        </div>
        {!runs?.length && (
          <div className="text-[13px] text-textItemBlur">
            {t('swipe_no_runs', 'No searches yet.')}
          </div>
        )}
        {(runs || []).map((run) => (
          <div key={run.id} className="text-[13px] text-textItemBlur">
            {new Date(run.createdAt).toLocaleString()} · {run.topic} ·{' '}
            {run.found} {t('swipe_found_lower', 'found')} · {run.searches}{' '}
            {t('swipe_searches', 'searches')} ·{' '}
            {run.inputTokens + run.outputTokens} {t('swipe_tokens', 'tokens')}
          </div>
        ))}
      </GrowthCard>
    </div>
  );
};
