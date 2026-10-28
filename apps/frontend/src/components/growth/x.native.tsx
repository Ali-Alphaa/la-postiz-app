'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { weightedLength } from '@gitroom/helpers/utils/count.length';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Textarea } from '@gitroom/react/form/textarea';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  fromUtc,
  newDayjs,
} from '@gitroom/frontend/components/layout/set.timezone';
import {
  errorMessage,
  useXNative,
} from '@gitroom/frontend/components/growth/growth.hooks';
import { GrowthCard } from '@gitroom/frontend/components/growth/channel.select';

const MAX_LENGTH = 280;

const STATUS_CLASS: Record<string, string> = {
  pending: 'bg-orange-500 text-white',
  synced: 'bg-green-600 text-white',
  failed: 'bg-red-500 text-white',
  cancelled: 'border border-newTableBorder text-newTextColor/60',
};

const NativeForm: FC<{
  initial?: { id: string; text: string; scheduledAt: string };
  onDone: () => void;
}> = ({ initial, onDone }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [text, setText] = useState(initial?.text || '');
  const [date, setDate] = useState(
    initial ? fromUtc(initial.scheduledAt).format('YYYY-MM-DDTHH:mm') : ''
  );
  const [saving, setSaving] = useState(false);
  const length = weightedLength(text);

  const save = useCallback(async () => {
    setSaving(true);
    const response = await fetch(
      initial ? `/growth/x/native/${initial.id}` : '/growth/x/native',
      {
        method: initial ? 'PUT' : 'POST',
        body: JSON.stringify({
          text,
          // the picker is in the timezone of the user
          scheduledAt: newDayjs(date).utc().toISOString(),
        }),
      }
    );
    setSaving(false);
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
    onDone();
  }, [text, date, initial]);

  return (
    <div className="flex flex-col gap-[8px] border border-newTableBorder rounded-[8px] p-[12px]">
      <Textarea
        label={t('post', 'Post')}
        name={`native-${initial?.id || 'new'}`}
        disableForm={true}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div
        className={clsx(
          'text-[12px] text-end',
          length > MAX_LENGTH ? 'text-red-400' : 'text-newTextColor/60'
        )}
      >
        {length}/{MAX_LENGTH}
      </div>
      <div className="flex gap-[8px] items-end flex-wrap">
        <div className="w-[220px]">
          <Input
            label={t('schedule_at', 'Schedule at')}
            name={`native-date-${initial?.id || 'new'}`}
            type="datetime-local"
            disableForm={true}
            removeError={true}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Button
          onClick={save}
          loading={saving}
          disabled={!text.trim() || !date || length > MAX_LENGTH}
        >
          {initial ? t('save', 'Save') : t('add_to_queue', 'Add to queue')}
        </Button>
        <button
          type="button"
          className="text-[13px] underline text-newTextColor/60 pb-[10px]"
          onClick={onDone}
        >
          {t('cancel', 'Cancel')}
        </button>
      </div>
    </div>
  );
};

// Posts the extension puts into X's own scheduler (X Premium): free, X
// publishes them even when the computer is off
export const XNativeScheduler: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const { data, mutate } = useXNative();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState('');
  const [showAll, setShowAll] = useState(false);

  const cancel = useCallback(
    (id: string) => async () => {
      if (
        !(await deleteDialog(
          t(
            'x_native_cancel',
            'Remove this post from the queue? A post already synced must also be deleted in the scheduled posts of X.'
          )
        ))
      ) {
        return;
      }
      await fetch(`/growth/x/native/${id}`, { method: 'DELETE' });
      mutate();
    },
    []
  );

  const items = (data || []).filter(
    (p: any) => showAll || p.status !== 'cancelled'
  );
  const pending = (data || []).filter((p: any) => p.status === 'pending');

  return (
    <GrowthCard className="flex flex-col gap-[12px]">
      <div className="flex items-center gap-[12px] flex-wrap">
        <div className="text-[14px] font-[500] flex-1">
          {t('x_native_title', 'Scheduled in X (Premium)')}
        </div>
        {!adding && (
          <Button secondary={true} onClick={() => setAdding(true)}>
            {t('x_native_add_post', 'Add post')}
          </Button>
        )}
      </div>
      <div className="text-[13px] text-newTextColor/70">
        {t(
          'x_native_explainer',
          "Free via your X Premium scheduler. Open Chrome and click 'Sync to X scheduler' in the extension at least once before the first post time; X then posts it even if your PC is off."
        )}{' '}
        {t(
          'x_native_text_only',
          'Text only: no media and no threads (X does not schedule threads from the web).'
        )}
      </div>
      {!!pending.length && (
        <div className="text-[13px] text-orange-500">
          {t('x_native_waiting', '{{count}} waiting for the next sync', {
            count: pending.length,
          })}
        </div>
      )}
      {adding && (
        <NativeForm
          onDone={() => {
            setAdding(false);
            mutate();
          }}
        />
      )}
      {!items.length && !adding && (
        <div className="text-[13px] text-newTextColor/60">
          {t('x_native_empty', 'Nothing queued for the X scheduler')}
        </div>
      )}
      {items.map((item: any) =>
        editing === item.id ? (
          <NativeForm
            key={item.id}
            initial={item}
            onDone={() => {
              setEditing('');
              mutate();
            }}
          />
        ) : (
          <div
            key={item.id}
            className="flex gap-[12px] items-start border-t border-newTableBorder pt-[10px]"
          >
            <div className="flex flex-col gap-[4px] flex-1 min-w-0">
              <div className="flex items-center gap-[8px] text-[12px]">
                <span
                  className={clsx(
                    'px-[8px] py-[1px] rounded-full',
                    STATUS_CLASS[item.status]
                  )}
                >
                  {item.status === 'pending'
                    ? t('x_native_pending', 'waiting for sync')
                    : item.status === 'synced'
                    ? t('x_native_synced', 'in X scheduler')
                    : item.status === 'failed'
                    ? t('x_native_failed', 'failed')
                    : t('x_native_cancelled', 'cancelled')}
                </span>
                <span className="text-newTextColor/70">
                  {fromUtc(item.scheduledAt).format('DD/MM/YYYY HH:mm')}
                </span>
              </div>
              <div className="text-[14px] whitespace-pre-wrap break-words">
                {item.text}
              </div>
              {item.status === 'failed' && !!item.error && (
                <div className="text-[12px] text-red-400">{item.error}</div>
              )}
            </div>
            {(item.status === 'pending' || item.status === 'failed') && (
              <button
                type="button"
                className="text-[13px] underline text-newTextColor/70"
                onClick={() => setEditing(item.id)}
              >
                {t('edit', 'Edit')}
              </button>
            )}
            {item.status !== 'cancelled' && (
              <button
                type="button"
                className="text-[13px] text-red-400"
                onClick={cancel(item.id)}
              >
                {t('remove', 'Remove')}
              </button>
            )}
          </div>
        )
      )}
      {(data || []).some((p: any) => p.status === 'cancelled') && (
        <button
          type="button"
          className="text-[12px] underline text-newTextColor/60 self-start"
          onClick={() => setShowAll((prev) => !prev)}
        >
          {showAll
            ? t('hide_cancelled', 'Hide cancelled')
            : t('show_cancelled', 'Show cancelled')}
        </button>
      )}
    </GrowthCard>
  );
};
