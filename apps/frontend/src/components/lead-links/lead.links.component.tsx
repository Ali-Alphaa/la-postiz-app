'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  useDecisionModal,
  useModals,
} from '@gitroom/frontend/components/layout/new-modal';
import { GrowthCard } from '@gitroom/frontend/components/growth/channel.select';
import { useAiError } from '@gitroom/frontend/components/growth/x.inspiration';
import { ComplianceNote } from '@gitroom/frontend/components/swipe/swipe.pack';

const inputClass =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] outline-none text-textColor';

const MAX_TEXT = 240;
const MAX_COPIES = 5;
const TONES = ['formal', 'balanced', 'casual'];
const PLATFORMS = [
  { value: 'x', label: 'X' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'other', label: 'Other' },
];

interface LeadVersion {
  id: string;
  name: string;
  text: string;
}

interface LeadMessage {
  id: string;
  position: number;
  label: string;
  tone: string;
  original: string;
  aiDrafted: boolean;
  versions: LeadVersion[];
  defaultVersion: string;
  updatedAt: string;
}

interface LeadMagnet {
  id: string;
  title: string;
  url: string;
  coverUrl?: string | null;
  description?: string | null;
  code: string;
  archivedAt?: string | null;
  messages: LeadMessage[];
}

const useLeadMagnets = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/lead-links')).json();
  }, []);
  return useSWR<LeadMagnet[]>('lead-links', load);
};

const versionText = (message: LeadMessage, id: string) =>
  id === 'original'
    ? message.original
    : message.versions.find((p) => p.id === id)?.text || '';

const withLink = (
  text: string,
  magnet: LeadMagnet,
  message: LeadMessage,
  platform: string
) => {
  const position = String(message.position).padStart(2, '0');
  const url = new URL(magnet.url);
  url.searchParams.set('src', `${platform}-${magnet.code}-${position}`);
  return `${text}\n\n${url.toString()}`;
};

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const copyCover = async (url: string) => {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((p) => (p ? resolve(p) : reject()), 'image/png')
  );
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
};

const LeadMessageCard: FC<{
  magnet: LeadMagnet;
  message: LeadMessage;
  platform: string;
  reload: () => unknown;
}> = ({ magnet, message, platform, reload }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const aiError = useAiError();
  const decision = useDecisionModal();
  const [selected, setSelected] = useState(message.defaultVersion);
  const [text, setText] = useState('');
  const [label, setLabel] = useState(message.label);
  const [tone, setTone] = useState(message.tone);
  const [copyName, setCopyName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setText(versionText(message, selected));
  }, [selected, message.updatedAt]);

  useEffect(() => {
    setLabel(message.label);
    setTone(message.tone);
  }, [message.updatedAt]);

  const locked = selected === 'original' && !!message.original;
  const unsaved = text !== versionText(message, selected);

  const selectVersion = useCallback(
    async (next: string) => {
      if (
        unsaved &&
        !(await decision.open({
          title: t('unsaved_style_guide', 'Unsaved changes'),
          description: t(
            'lead_unsaved',
            'Your changes to this version are not saved. Switch and lose them?'
          ),
          approveLabel: t('lead_switch', 'Switch'),
          cancelLabel: t('keep_editing', 'Keep editing'),
        }))
      ) {
        return;
      }
      setSelected(next);
    },
    [unsaved, t]
  );

  const save = useCallback(
    async (change: {
      versions?: LeadVersion[];
      defaultVersion?: string;
      original?: string;
    }) => {
      setBusy(true);
      try {
        const response = await fetch(`/lead-links/messages/${message.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            label,
            tone,
            versions: message.versions,
            defaultVersion: message.defaultVersion,
            ...change,
          }),
        });
        if (!response.ok) {
          toaster.show(
            (await response.json())?.message ||
              t('something_went_wrong', 'Something went wrong'),
            'warning'
          );
          return false;
        }
        await reload();
        toaster.show(t('saved', 'Saved'), 'success');
        return true;
      } finally {
        setBusy(false);
      }
    },
    [message, label, tone, reload, t]
  );

  const saveCurrent = useCallback(() => {
    if (selected === 'original') {
      return save(message.original ? {} : { original: text });
    }
    return save({
      versions: message.versions.map((p) =>
        p.id === selected ? { ...p, text } : p
      ),
    });
  }, [selected, message, text, save]);

  const saveCopy = useCallback(async () => {
    const id = crypto.randomUUID().slice(0, 12);
    const saved = await save({
      versions: [...message.versions, { id, name: copyName.trim(), text }],
    });
    if (saved) {
      setCopyName('');
      setSelected(id);
    }
  }, [message, copyName, text, save]);

  const removeCopy = useCallback(async () => {
    if (
      !(await deleteDialog(t('lead_delete_copy', 'Delete this copy?'), 'Delete'))
    ) {
      return;
    }
    const saved = await save({
      versions: message.versions.filter((p) => p.id !== selected),
      defaultVersion:
        message.defaultVersion === selected
          ? 'original'
          : message.defaultVersion,
    });
    if (saved) {
      setSelected('original');
    }
  }, [message, selected, save, t]);

  const redraft = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(
        `/lead-links/messages/${message.id}/redraft`,
        { method: 'POST' }
      );
      const result = await response.json();
      const error = response.ok ? aiError(result) : result?.message;
      if (error) {
        toaster.show(error, 'warning');
        return;
      }
      toaster.show(t('lead_redrafted', 'New draft saved as a copy'), 'success');
      reload();
    } finally {
      setBusy(false);
    }
  }, [message, reload, aiError, t]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(
        withLink(text, magnet, message, platform)
      );
      toaster.show(t('lead_copied', 'Copied with the link'), 'success');
    } catch (err) {
      toaster.show(
        t('lead_copy_failed', 'Your browser blocked copying'),
        'warning'
      );
    }
  }, [text, magnet, message, platform, t]);

  return (
    <GrowthCard className="flex flex-col gap-[10px]">
      <div className="flex gap-[8px] flex-wrap items-center">
        <span className="font-[600]">#{message.position}</span>
        <input
          className={clsx(inputClass, 'flex-1 min-w-[200px]')}
          value={label}
          maxLength={100}
          onChange={(e) => setLabel(e.target.value)}
        />
        <select
          className={clsx(inputClass, 'max-w-[130px] capitalize')}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        >
          {TONES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className={clsx(inputClass, 'max-w-[220px]')}
          value={selected}
          onChange={(e) => selectVersion(e.target.value)}
        >
          <option value="original">
            {t('lead_original', 'Original')}
            {message.defaultVersion === 'original' ? ' ★' : ''}
          </option>
          {message.versions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {message.defaultVersion === p.id ? ' ★' : ''}
            </option>
          ))}
        </select>
        {message.aiDrafted && message.defaultVersion === 'original' && (
          <span className="text-[12px] text-textItemBlur">
            {t('lead_claude_draft', 'Claude draft')}
          </span>
        )}
      </div>
      <textarea
        className={clsx(inputClass, 'min-h-[90px]', locked && 'opacity-70')}
        readOnly={locked}
        value={text}
        placeholder={t('lead_write', 'Write this message')}
        onChange={(e) => setText(e.target.value)}
      />
      <div
        className={clsx(
          'text-[12px]',
          text.length > MAX_TEXT ? 'text-yellow-400' : 'text-textItemBlur'
        )}
      >
        {text.length} / {MAX_TEXT}
        {text.length > MAX_TEXT
          ? ` · ${t('lead_too_long', 'may not fit in an X reply with the link')}`
          : ''}
      </div>
      <ComplianceNote text={text} />
      <div className="flex gap-[8px] flex-wrap items-center">
        <Button onClick={copy} disabled={!text.trim()}>
          {t('lead_copy', 'Copy')}
        </Button>
        <Button secondary={true} onClick={saveCurrent} disabled={busy}>
          {t('save', 'Save')}
        </Button>
        {message.defaultVersion !== selected && (
          <Button
            secondary={true}
            onClick={() => save({ defaultVersion: selected })}
            disabled={busy || unsaved}
          >
            {t('lead_set_default', 'Set as default')}
          </Button>
        )}
        {selected !== 'original' && (
          <Button secondary={true} onClick={removeCopy} disabled={busy}>
            {t('lead_delete', 'Delete copy')}
          </Button>
        )}
        <Button
          secondary={true}
          onClick={redraft}
          loading={busy}
          disabled={busy || unsaved || message.versions.length >= MAX_COPIES}
        >
          {t('lead_redraft', 'Redraft with Claude')}
        </Button>
        {message.versions.length < MAX_COPIES && !!text.trim() && (
          <div className="flex gap-[8px] ms-auto">
            <input
              className={clsx(inputClass, 'max-w-[180px]')}
              placeholder={t('lead_copy_name', 'Name for a new copy')}
              maxLength={60}
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
            />
            <Button
              secondary={true}
              onClick={saveCopy}
              disabled={busy || !copyName.trim()}
            >
              {t('lead_save_copy', 'Save as copy')}
            </Button>
          </div>
        )}
      </div>
    </GrowthCard>
  );
};

const MagnetForm: FC<{
  magnet?: LeadMagnet;
  done: () => void;
}> = ({ magnet, done }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [title, setTitle] = useState(magnet?.title || '');
  const [url, setUrl] = useState(magnet?.url || '');
  const [coverUrl, setCoverUrl] = useState(magnet?.coverUrl || '');
  const [description, setDescription] = useState(magnet?.description || '');
  const [code, setCode] = useState(magnet?.code || '');
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch(
        magnet ? `/lead-links/magnets/${magnet.id}` : '/lead-links/magnets',
        {
          method: magnet ? 'PUT' : 'POST',
          body: JSON.stringify({
            title,
            url,
            code,
            ...(coverUrl ? { coverUrl } : {}),
            ...(description ? { description } : {}),
            archived: !!magnet?.archivedAt,
          }),
        }
      );
      if (!response.ok) {
        const message = (await response.json())?.message;
        toaster.show(
          Array.isArray(message)
            ? message.join(', ')
            : message || t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      done();
    } finally {
      setSaving(false);
    }
  }, [magnet, title, url, coverUrl, description, code, done, t]);

  return (
    <GrowthCard className="flex flex-col gap-[10px]">
      <input
        className={inputClass}
        placeholder={t('lead_title', 'Title')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <input
        className={inputClass}
        placeholder={t('lead_url', 'Link, like https://example.com/guide')}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <input
        className={inputClass}
        placeholder={t('lead_cover', 'Cover image link')}
        value={coverUrl}
        onChange={(e) => setCoverUrl(e.target.value)}
      />
      <input
        className={inputClass}
        placeholder={t('lead_code', 'Short code for tracking, like bt')}
        disabled={!!magnet}
        value={code}
        onChange={(e) => setCode(e.target.value.toLowerCase())}
      />
      <textarea
        className={clsx(inputClass, 'min-h-[90px]')}
        placeholder={t(
          'lead_description',
          'What it contains, Claude only describes what is written here'
        )}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div>
        <Button
          onClick={submit}
          loading={saving}
          disabled={!title.trim() || !url.trim() || !code.trim()}
        >
          {t('save', 'Save')}
        </Button>
      </div>
    </GrowthCard>
  );
};

const MagnetDetail: FC<{
  magnet: LeadMagnet;
  back: () => void;
  reload: () => void;
}> = ({ magnet, back, reload }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const aiError = useAiError();
  const [tone, setTone] = useState('');
  const [editing, setEditing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [platform, setPlatformState] = useState(() => {
    try {
      return localStorage.getItem('lead-links-platform') || 'x';
    } catch (err) {
      return 'x';
    }
  });

  const setPlatform = useCallback((value: string) => {
    setPlatformState(value);
    try {
      localStorage.setItem('lead-links-platform', value);
    } catch (err) {
      /** the choice is only remembered for convenience **/
    }
  }, []);

  const draftAll = useCallback(async () => {
    setDrafting(true);
    try {
      const response = await fetch(`/lead-links/magnets/${magnet.id}/draft`, {
        method: 'POST',
      });
      const result = await response.json();
      const error = response.ok ? aiError(result) : result?.message;
      if (error) {
        toaster.show(error, 'warning');
        return;
      }
      reload();
    } finally {
      setDrafting(false);
    }
  }, [magnet, reload, aiError]);

  const retire = useCallback(async () => {
    await fetch(`/lead-links/magnets/${magnet.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: magnet.title,
        url: magnet.url,
        code: magnet.code,
        ...(magnet.coverUrl ? { coverUrl: magnet.coverUrl } : {}),
        ...(magnet.description ? { description: magnet.description } : {}),
        archived: !magnet.archivedAt,
      }),
    });
    reload();
    back();
  }, [magnet, reload, back]);

  const copyImage = useCallback(async () => {
    try {
      await copyCover(magnet.coverUrl!);
      toaster.show(t('lead_image_copied', 'Cover copied'), 'success');
    } catch (err) {
      window.open(magnet.coverUrl!, '_blank', 'noopener');
      toaster.show(
        t('lead_image_opened', 'Could not copy it, the cover opened instead'),
        'warning'
      );
    }
  }, [magnet, t]);

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex gap-[8px] flex-wrap items-center">
        <Button secondary={true} onClick={back}>
          {t('back', 'Back')}
        </Button>
        <div className="font-[600] text-[18px]">{magnet.title}</div>
        <div className="flex gap-[8px] flex-wrap ms-auto">
          {magnet.messages.some((p) => !p.original) && (
            <Button onClick={draftAll} loading={drafting} disabled={drafting}>
              {t('lead_draft_all', 'Draft all with Claude')}
            </Button>
          )}
          {!!magnet.coverUrl && (
            <Button secondary={true} onClick={copyImage}>
              {t('lead_copy_image', 'Copy image')}
            </Button>
          )}
          <Button secondary={true} onClick={() => setEditing(!editing)}>
            {t('edit', 'Edit')}
          </Button>
          <Button secondary={true} onClick={retire}>
            {magnet.archivedAt
              ? t('lead_restore', 'Bring back')
              : t('lead_retire', 'Retire')}
          </Button>
        </div>
      </div>
      {editing && (
        <MagnetForm
          magnet={magnet}
          done={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      <div className="flex gap-[8px] flex-wrap">
        <select
          className={clsx(inputClass, 'max-w-[160px] capitalize')}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        >
          <option value="">{t('lead_all_tones', 'All tones')}</option>
          {TONES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className={clsx(inputClass, 'max-w-[160px]')}
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
        >
          {PLATFORMS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {magnet.messages
        .filter((p) => !tone || p.tone === tone)
        .map((message) => (
          <LeadMessageCard
            key={message.id}
            magnet={magnet}
            message={message}
            platform={platform}
            reload={reload}
          />
        ))}
    </div>
  );
};

export const LeadLinksComponent: FC = () => {
  const t = useT();
  const { data, mutate } = useLeadMagnets();
  const [openId, setOpenId] = useState('');
  const [adding, setAdding] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const open = (data || []).find((p) => p.id === openId);
  const list = (data || []).filter((p) => !p.archivedAt === !showRetired);

  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all">
      {open ? (
        <MagnetDetail
          magnet={open}
          back={() => setOpenId('')}
          reload={() => mutate()}
        />
      ) : (
        <>
          <div className="flex gap-[8px] items-center">
            <Button onClick={() => setAdding(!adding)}>
              {t('lead_add', 'Add lead magnet')}
            </Button>
            <Button
              secondary={true}
              onClick={() => setShowRetired(!showRetired)}
            >
              {showRetired
                ? t('lead_show_active', 'Show active')
                : t('lead_show_retired', 'Show retired')}
            </Button>
          </div>
          {adding && (
            <MagnetForm
              done={() => {
                setAdding(false);
                mutate();
              }}
            />
          )}
          {data && !list.length && (
            <div className="text-[13px] text-textItemBlur">
              {t('lead_none', 'No lead magnets here yet')}
            </div>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-[12px]">
            {list.map((magnet) => (
              <button
                key={magnet.id}
                type="button"
                onClick={() => setOpenId(magnet.id)}
                className="text-start border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[8px] hover:bg-boxFocused"
              >
                {!!magnet.coverUrl && (
                  <img
                    src={magnet.coverUrl}
                    alt=""
                    className="w-full aspect-[4/5] object-cover rounded-[6px]"
                  />
                )}
                <div className="font-[600]">{magnet.title}</div>
                <div className="text-[12px] text-textItemBlur">
                  {magnet.messages.filter((p) => p.original).length} / 10{' '}
                  {t('lead_messages', 'messages')}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// choosing a saved message while writing a post or a reply
export const LeadLinkPicker: FC<{
  platform: string;
  withCover?: boolean;
  onPick: (text: string, cover?: LeadMagnet) => void;
}> = ({ platform, withCover, onPick }) => {
  const t = useT();
  const { data } = useLeadMagnets();
  const [magnetId, setMagnetId] = useState('');
  const [tone, setTone] = useState('');
  const [attach, setAttach] = useState(true);
  const magnets = (data || []).filter((p) => !p.archivedAt);
  const magnet = magnets.find((p) => p.id === magnetId) || magnets[0];

  return (
    <div className="flex flex-col gap-[10px] min-w-[300px] max-w-[640px]">
      <div className="flex gap-[8px] flex-wrap">
        <select
          className={clsx(inputClass, 'flex-1 min-w-[180px]')}
          value={magnet?.id || ''}
          onChange={(e) => setMagnetId(e.target.value)}
        >
          {magnets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <select
          className={clsx(inputClass, 'max-w-[140px] capitalize')}
          value={tone}
          onChange={(e) => setTone(e.target.value)}
        >
          <option value="">{t('lead_all_tones', 'All tones')}</option>
          {TONES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      {withCover && !!magnet?.coverUrl && (
        <label className="flex gap-[8px] items-center text-[13px]">
          <input
            type="checkbox"
            checked={attach}
            onChange={(e) => setAttach(e.target.checked)}
          />
          {t('lead_attach', 'Attach the cover')}
        </label>
      )}
      <div className="flex flex-col gap-[8px] max-h-[420px] overflow-auto">
        {(magnet?.messages || [])
          .filter(
            (p) =>
              (!tone || p.tone === tone) &&
              !!versionText(p, p.defaultVersion)
          )
          .map((message) => {
            const text = versionText(message, message.defaultVersion);
            return (
              <button
                key={message.id}
                type="button"
                onClick={() =>
                  onPick(
                    withLink(text, magnet!, message, platform),
                    withCover && attach && magnet?.coverUrl
                      ? magnet
                      : undefined
                  )
                }
                className="text-start border border-newTableBorder rounded-[8px] p-[10px] text-[13px] hover:bg-boxFocused"
              >
                <div className="text-[12px] text-textItemBlur capitalize">
                  #{message.position} · {message.tone} · {message.label}
                </div>
                <div className="whitespace-pre-wrap break-words">{text}</div>
              </button>
            );
          })}
      </div>
    </div>
  );
};

export const LeadLinkBox: FC<{
  editor: any;
  identifier: string;
  appendImages?: (value: any[]) => void;
}> = ({ editor, identifier, appendImages }) => {
  const modals = useModals();
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();

  const open = useCallback(() => {
    modals.openModal({
      title: 'Lead Links',
      withCloseButton: true,
      children: (close) => (
        <LeadLinkPicker
          platform={identifier === 'global' ? 'post' : identifier.split('-')[0]}
          withCover={!!appendImages}
          onPick={async (text, cover) => {
            editor?.commands?.insertContent(
              text
                .split('\n')
                .map((line) => `<p>${escapeHtml(line)}</p>`)
                .join('')
            );
            editor?.commands?.focus();
            close();
            if (!cover) {
              return;
            }
            const response = await fetch(
              `/lead-links/magnets/${cover.id}/cover-media`,
              { method: 'POST' }
            );
            if (!response.ok) {
              toaster.show(
                t('lead_cover_failed', 'Could not attach the cover'),
                'warning'
              );
              return;
            }
            appendImages?.([await response.json()]);
          }}
        />
      ),
    });
  }, [editor, identifier, appendImages, t]);

  return (
    <div
      onClick={open}
      data-tooltip-id="tooltip"
      data-tooltip-content="Lead Links"
      className="select-none cursor-pointer rounded-[6px] mobile:rounded-[8px] w-[30px] h-[30px] mobile:w-[40px] mobile:h-[40px] bg-newColColor mobile:bg-newSettings flex justify-center items-center"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        className="mobile:w-[20px] mobile:h-[20px]"
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="M10 14a4 4 0 0 0 6 .4l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7M14 10a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
