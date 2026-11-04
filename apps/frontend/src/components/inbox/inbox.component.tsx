'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { GrowthCard } from '@gitroom/frontend/components/growth/channel.select';
import { useAiError } from '@gitroom/frontend/components/growth/x.inspiration';
import { ComplianceNote } from '@gitroom/frontend/components/swipe/swipe.pack';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { LeadLinkPicker } from '@gitroom/frontend/components/lead-links/lead.links.component';

const inputClass =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] outline-none text-textColor';

type Status = 'OPEN' | 'REPLIED' | 'DONE';

interface InboxItem {
  id: string;
  kind: 'comment' | 'dm';
  authorName?: string | null;
  text: string;
  status: Status;
  reply?: string | null;
  receivedAt: string;
  dmSentAt?: string | null;
  dmError?: string | null;
  automationId?: string | null;
  integration: { id: string; name: string; providerIdentifier: string };
}

interface Channel {
  id: string;
  name: string;
  providerIdentifier: string;
  canSync: boolean;
  canPrivateReply: boolean;
  manualSyncOnly: boolean;
}

interface Automation {
  id: string;
  keyword: string;
  dmText: string;
  publicReply?: string | null;
  enabled: boolean;
  integrationId: string;
  sent: number;
  failed: number;
  integration: { name: string };
}

const useInboxItems = (status: Status, integrationId: string) => {
  const fetch = useFetch();
  const query = new URLSearchParams({
    status,
    ...(integrationId ? { integrationId } : {}),
  }).toString();
  const load = useCallback(async () => {
    return (await fetch(`/inbox?${query}`)).json();
  }, [query]);
  return useSWR<{ items: InboxItem[]; open: number }>(
    `inbox-items-${query}`,
    load,
    { refreshInterval: 60000 }
  );
};

const useInboxChannels = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/inbox/channels')).json();
  }, []);
  return useSWR<Channel[]>('inbox-channels', load);
};

const useAutomations = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/inbox/automations')).json();
  }, []);
  return useSWR<Automation[]>('inbox-automations', load);
};

export const InboxComponent: FC = () => {
  const t = useT();
  const [tab, setTab] = useState<'messages' | 'automations'>('messages');
  const tabs = [
    { key: 'messages' as const, label: t('inbox_messages', 'Messages') },
    {
      key: 'automations' as const,
      label: t('inbox_automations', 'Comment to DM'),
    },
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
      {tab === 'messages' ? <InboxMessages /> : <InboxAutomations />}
    </div>
  );
};

const InboxMessages: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [status, setStatus] = useState<Status>('OPEN');
  const [integrationId, setIntegrationId] = useState('');
  const [syncing, setSyncing] = useState(false);
  const { data, mutate } = useInboxItems(status, integrationId);
  const { data: channels } = useInboxChannels();

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const response = await fetch('/inbox/sync', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) {
        toaster.show(
          result?.message || t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      if (result.errors?.length) {
        toaster.show(
          result.errors
            .map(
              (p: { channel: string; error: string }) =>
                `${p.channel}: ${p.error}`
            )
            .join('; '),
          'warning'
        );
      } else {
        toaster.show(
          `${t('inbox_new', 'New messages:')} ${result.created}`,
          'success'
        );
      }
      mutate();
    } finally {
      setSyncing(false);
    }
  }, [t, mutate]);

  const paid = (channels || []).filter((p) => p.canSync && p.manualSyncOnly);

  return (
    <>
      <div className="flex gap-[8px] flex-wrap items-center">
        <select
          className={clsx(inputClass, 'max-w-[160px]')}
          value={status}
          onChange={(e) => setStatus(e.target.value as Status)}
        >
          <option value="OPEN">
            {t('inbox_open', 'Open')}
            {data?.open ? ` (${data.open})` : ''}
          </option>
          <option value="REPLIED">{t('inbox_replied', 'Replied')}</option>
          <option value="DONE">{t('inbox_done', 'Done')}</option>
        </select>
        <select
          className={clsx(inputClass, 'max-w-[220px]')}
          value={integrationId}
          onChange={(e) => setIntegrationId(e.target.value)}
        >
          <option value="">{t('inbox_all_channels', 'All channels')}</option>
          {(channels || [])
            .filter((p) => p.canSync)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
        <div className="flex-1" />
        <Button onClick={sync} loading={syncing} disabled={syncing}>
          {t('inbox_check_now', 'Check now')}
        </Button>
      </div>
      {!!paid.length && (
        <div className="text-[12px] text-textItemBlur">
          {paid.map((p) => p.name).join(', ')}:{' '}
          {t(
            'inbox_manual_note',
            'only read when you click Check now, because reading replies through this API costs money per request.'
          )}
        </div>
      )}
      {!data?.items?.length ? (
        <div className="text-textItemBlur py-[40px] text-center">
          {t('inbox_empty', 'Nothing here.')}
        </div>
      ) : (
        <div className="flex flex-col gap-[12px]">
          {data.items.map((item) => (
            <InboxCard key={item.id} item={item} reload={mutate} />
          ))}
        </div>
      )}
    </>
  );
};

const InboxCard: FC<{ item: InboxItem; reload: () => void }> = ({
  item,
  reload,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const aiError = useAiError();
  const modals = useModals();
  const [text, setText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);

  const leadLink = useCallback(() => {
    modals.openModal({
      title: 'Lead Links',
      withCloseButton: true,
      children: (close) => (
        <LeadLinkPicker
          platform={item.integration.providerIdentifier.split('-')[0]}
          onPick={(value) => {
            setText((current) => (current ? `${current}\n\n${value}` : value));
            close();
          }}
        />
      ),
    });
  }, [item]);

  const draft = useCallback(async () => {
    setDrafting(true);
    try {
      const response = await fetch(`/inbox/${item.id}/draft`, {
        method: 'POST',
      });
      const result = await response.json();
      const error = response.ok ? aiError(result) : result?.message;
      if (error) {
        toaster.show(error, 'warning');
        return;
      }
      setText(result.draft);
    } finally {
      setDrafting(false);
    }
  }, [item, aiError]);

  const send = useCallback(async () => {
    setSending(true);
    try {
      const response = await fetch(`/inbox/${item.id}/reply`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        toaster.show(
          (await response.json())?.message ||
            t('something_went_wrong', 'Something went wrong'),
          'warning'
        );
        return;
      }
      toaster.show(t('inbox_sent', 'Reply sent'), 'success');
      setText('');
      reload();
    } finally {
      setSending(false);
    }
  }, [item, text, t, reload]);

  const mark = useCallback(
    (status: Status) => async () => {
      await fetch(`/inbox/${item.id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      reload();
    },
    [item, reload]
  );

  return (
    <GrowthCard className="flex flex-col gap-[10px]">
      <div className="text-[12px] text-textItemBlur flex gap-[8px] flex-wrap">
        <span>{item.integration.name}</span>
        <span>
          {item.kind === 'dm'
            ? t('inbox_kind_dm', 'DM')
            : t('inbox_kind_comment', 'Comment')}
        </span>
        {!!item.authorName && <span>{item.authorName}</span>}
        <span>{new Date(item.receivedAt).toLocaleString()}</span>
        {!!item.dmSentAt && (
          <span className="text-green-400">
            {t('inbox_dm_sent', 'Automatic DM sent')}
          </span>
        )}
        {!!item.dmError && (
          <span className="text-red-400">
            {t('inbox_dm_failed', 'Automatic DM failed:')} {item.dmError}
          </span>
        )}
      </div>
      <div className="whitespace-pre-wrap break-words text-[14px]">
        {item.text}
      </div>
      {!!item.reply && (
        <div className="text-[13px] text-textItemBlur whitespace-pre-wrap break-words">
          {t('inbox_you_replied', 'You replied:')} {item.reply}
        </div>
      )}
      {item.status === 'OPEN' ? (
        <>
          <textarea
            className={inputClass}
            placeholder={t('inbox_write', 'Write a reply')}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <ComplianceNote text={text} />
          <div className="flex gap-[8px] flex-wrap items-center">
            <Button onClick={send} loading={sending} disabled={!text.trim()}>
              {t('inbox_send', 'Send')}
            </Button>
            <Button
              secondary={true}
              onClick={draft}
              loading={drafting}
              disabled={drafting}
            >
              {t('inbox_draft', 'Draft with Claude')}
            </Button>
            <Button secondary={true} onClick={leadLink}>
              {t('lead_links', 'Lead Links')}
            </Button>
            <button
              type="button"
              className="text-[13px] text-textItemBlur ms-auto"
              onClick={mark('DONE')}
            >
              {t('inbox_mark_done', 'Mark done')}
            </button>
          </div>
        </>
      ) : (
        <div>
          <button
            type="button"
            className="text-[13px] text-textItemBlur"
            onClick={mark('OPEN')}
          >
            {t('inbox_reopen', 'Reopen')}
          </button>
        </div>
      )}
    </GrowthCard>
  );
};

const InboxAutomations: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: channels } = useInboxChannels();
  const { data: automations, mutate } = useAutomations();
  const capable = (channels || []).filter((p) => p.canPrivateReply);
  const [integrationId, setIntegrationId] = useState('');
  const [keyword, setKeyword] = useState('');
  const [dmText, setDmText] = useState('');
  const [publicReply, setPublicReply] = useState('');

  const create = useCallback(async () => {
    const response = await fetch('/inbox/automations', {
      method: 'POST',
      body: JSON.stringify({
        integrationId: integrationId || capable[0]?.id,
        keyword,
        dmText,
        enabled: true,
        ...(publicReply ? { publicReply } : {}),
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
    setKeyword('');
    setDmText('');
    setPublicReply('');
    mutate();
  }, [integrationId, capable, keyword, dmText, publicReply, t, mutate]);

  const toggle = useCallback(
    (p: Automation) => async () => {
      await fetch(`/inbox/automations/${p.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          integrationId: p.integrationId,
          keyword: p.keyword,
          dmText: p.dmText,
          enabled: !p.enabled,
          ...(p.publicReply ? { publicReply: p.publicReply } : {}),
        }),
      });
      mutate();
    },
    [mutate]
  );

  const remove = useCallback(
    (p: Automation) => async () => {
      if (
        await deleteDialog(
          t('inbox_delete_automation', 'Delete this automation?')
        )
      ) {
        await fetch(`/inbox/automations/${p.id}`, { method: 'DELETE' });
        mutate();
      }
    },
    [t, mutate]
  );

  if (!capable.length) {
    return (
      <GrowthCard className="flex flex-col gap-[8px]">
        <div className="font-[600]">
          {t('inbox_connect_title', 'Connect an Instagram channel first')}
        </div>
        <div className="text-[13px] text-textItemBlur">
          {t(
            'inbox_connect_note',
            'Comment to DM uses the official Instagram API. Connect an Instagram Business or Creator account with INSTAGRAM_DM_ACCESS=true on the server, so that it can also send messages.'
          )}
        </div>
      </GrowthCard>
    );
  }

  return (
    <>
      <GrowthCard className="flex flex-col gap-[10px] max-w-[640px]">
        <div className="font-[600]">
          {t('inbox_new_automation', 'New automation')}
        </div>
        <div className="text-[12px] text-textItemBlur">
          {t(
            'inbox_automation_note',
            'When someone comments the keyword on a post, they get this DM once. Checked every 5 minutes. Links are tagged so leads show under Revenue tracking. Instagram allows this within 7 days of the comment.'
          )}
        </div>
        <select
          className={inputClass}
          value={integrationId || capable[0]?.id}
          onChange={(e) => setIntegrationId(e.target.value)}
        >
          {capable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          className={inputClass}
          placeholder={t('inbox_keyword', 'Keyword, e.g. GUIDE')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <textarea
          className={clsx(inputClass, 'min-h-[90px]')}
          placeholder={t(
            'inbox_dm_text',
            'The DM, e.g. Here is your guide: https://thesigmatrader.com/free/'
          )}
          value={dmText}
          onChange={(e) => setDmText(e.target.value)}
        />
        <ComplianceNote text={dmText} />
        <input
          className={inputClass}
          placeholder={t(
            'inbox_public_reply',
            'Public reply to the comment (optional), e.g. Sent you a DM'
          )}
          value={publicReply}
          onChange={(e) => setPublicReply(e.target.value)}
        />
        <div>
          <Button
            onClick={create}
            disabled={keyword.trim().length < 2 || !dmText.trim()}
          >
            {t('inbox_create', 'Create')}
          </Button>
        </div>
      </GrowthCard>
      {(automations || []).map((p) => (
        <GrowthCard
          key={p.id}
          className="flex flex-col gap-[6px] max-w-[640px]"
        >
          <div className="flex gap-[8px] items-center">
            <b>{p.keyword}</b>
            <span className="text-[12px] text-textItemBlur">
              {p.integration.name} · {p.sent} {t('inbox_sent_lower', 'sent')}
              {p.failed ? ` · ${p.failed} ${t('inbox_failed', 'failed')}` : ''}
            </span>
            <button
              type="button"
              className="text-[13px] ms-auto"
              onClick={toggle(p)}
            >
              {p.enabled
                ? t('inbox_pause', 'Pause')
                : t('inbox_resume', 'Resume')}
            </button>
            <button
              type="button"
              className="text-[13px] text-red-400"
              onClick={remove(p)}
            >
              {t('delete', 'Delete')}
            </button>
          </div>
          <div className="text-[13px] whitespace-pre-wrap break-words">
            {p.dmText}
          </div>
        </GrowthCard>
      ))}
    </>
  );
};
