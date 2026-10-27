'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
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
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import {
  errorMessage,
  useExperiments,
} from '@gitroom/frontend/components/growth/growth.hooks';
import {
  ChannelSelect,
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';

const emptyVariant = () => ({ content: '', date: '' });

// plain text to the html the editor stores
export const textToHtml = (text: string) =>
  text
    .split('\n')
    .map(
      (line) =>
        `<p>${line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</p>`
    )
    .join('');

const NewExperiment: FC<{ onCreated: () => void }> = ({ onCreated }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [integration, setIntegration] = useState('');
  const [name, setName] = useState('');
  const [evaluationHours, setEvaluationHours] = useState(48);
  const [variants, setVariants] = useState([emptyVariant(), emptyVariant()]);
  const [saving, setSaving] = useState(false);

  const change = useCallback(
    (index: number, key: 'content' | 'date', value: string) => {
      setVariants((prev) =>
        prev.map((p, i) => (i === index ? { ...p, [key]: value } : p))
      );
    },
    []
  );

  const create = useCallback(async () => {
    setSaving(true);
    const response = await fetch('/growth/experiments', {
      method: 'POST',
      body: JSON.stringify({
        integrationId: integration,
        name,
        evaluationHours: +evaluationHours,
        variants: variants.map((p) => ({
          content: textToHtml(p.content),
          // the picker is in the timezone of the user
          ...(p.date ? { date: newDayjs(p.date).utc().toISOString() } : {}),
        })),
      }),
    });
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
    toaster.show(
      t('ab_test_created', 'The variants were scheduled'),
      'success'
    );
    setName('');
    setVariants([emptyVariant(), emptyVariant()]);
    onCreated();
  }, [integration, name, evaluationHours, variants]);

  return (
    <GrowthCard className="flex flex-col gap-[12px]">
      <div className="text-[15px] font-semibold">
        {t('new_ab_test', 'New A/B test')}
      </div>
      <div className="flex gap-[12px] flex-wrap items-start">
        <ChannelSelect value={integration} onChange={setIntegration} />
        <div className="w-[300px] mobile:w-full">
          <Input
            label={t('name', 'Name')}
            name="name"
            disableForm={true}
            removeError={true}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="w-[200px] mobile:w-full">
          <Input
            label={t('evaluation_hours', 'Pick the winner after (hours)')}
            name="evaluationHours"
            type="number"
            disableForm={true}
            removeError={true}
            value={evaluationHours}
            onChange={(e) => setEvaluationHours(+e.target.value)}
          />
        </div>
      </div>
      {variants.map((variant, index) => (
        <div
          key={index}
          className="flex gap-[12px] items-start border border-newTableBorder rounded-[8px] p-[12px]"
        >
          <div className="w-[32px] h-[32px] rounded-full bg-[#612BD3] text-white flex items-center justify-center shrink-0">
            {String.fromCharCode(65 + index)}
          </div>
          <div className="flex-1 flex flex-col gap-[8px]">
            <Textarea
              label={t('caption', 'Caption')}
              name={`variant-${index}`}
              disableForm={true}
              value={variant.content}
              onChange={(e) => change(index, 'content', e.target.value)}
            />
            <div className="w-[260px] mobile:w-full">
              <Input
                label={t(
                  'publish_at_optional',
                  'Publish at (empty = next free time slot)'
                )}
                name={`date-${index}`}
                type="datetime-local"
                disableForm={true}
                removeError={true}
                value={variant.date}
                onChange={(e) => change(index, 'date', e.target.value)}
              />
            </div>
          </div>
          {variants.length > 2 && (
            <button
              type="button"
              className="text-red-400 text-[13px]"
              onClick={() =>
                setVariants((prev) => prev.filter((_, i) => i !== index))
              }
            >
              {t('remove', 'Remove')}
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-[12px]">
        {variants.length < 5 && (
          <Button
            secondary={true}
            onClick={() => setVariants((prev) => [...prev, emptyVariant()])}
          >
            {t('add_variant', 'Add variant')}
          </Button>
        )}
        <Button
          onClick={create}
          loading={saving}
          disabled={
            !integration || !name || variants.some((p) => !p.content.trim())
          }
        >
          {t('schedule_variants', 'Schedule variants')}
        </Button>
      </div>
    </GrowthCard>
  );
};

export const AbTests: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useExperiments();

  const action = useCallback(
    (id: string, path: string, method: string, success: string) => async () => {
      const response = await fetch(`/growth/experiments/${id}${path}`, {
        method,
      });
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
      toaster.show(success, 'success');
      mutate();
    },
    []
  );

  const remove = useCallback(
    (id: string) => async () => {
      if (
        !(await deleteDialog(
          t(
            'delete_ab_test',
            'Delete this A/B test? Its posts are kept in the calendar.'
          )
        ))
      ) {
        return;
      }
      await action(id, '', 'DELETE', t('deleted', 'Deleted'))();
    },
    [action]
  );

  return (
    <GrowthSection
      title={t('ab_tests', 'A/B tests')}
      description={t(
        'ab_tests_description',
        'Publish 2 to 5 captions on the same channel at different times. After the last one is published and the evaluation window passed, the one with the best engagement rate (or engagement when the platform has no impressions) wins.'
      )}
    >
      <NewExperiment onCreated={mutate} />
      {(data || []).map((experiment: any) => (
        <GrowthCard key={experiment.id} className="flex flex-col gap-[12px]">
          <div className="flex items-center gap-[12px] flex-wrap">
            {!!experiment.integration?.picture && (
              <img
                src={experiment.integration.picture}
                className="w-[28px] h-[28px] rounded-full"
                alt=""
              />
            )}
            <div className="text-[15px] font-semibold flex-1">
              {experiment.name}
              <span className="text-newTextColor/60 font-normal text-[13px] ms-[8px]">
                {experiment.integration?.name}
              </span>
            </div>
            <div
              className={clsx(
                'text-[12px] px-[8px] py-[4px] rounded-[6px]',
                experiment.status === 'RUNNING' && 'bg-[#612BD3]/20',
                experiment.status === 'COMPLETED' && 'bg-green-500/20',
                experiment.status === 'CANCELED' && 'bg-red-500/20'
              )}
            >
              {experiment.status === 'RUNNING'
                ? t('ab_running', 'Running, winner after {{date}}', {
                    date: fromUtc(experiment.evaluateAt).format(
                      'DD/MM/YYYY HH:mm'
                    ),
                  })
                : experiment.status === 'COMPLETED'
                ? t('completed', 'Completed')
                : t('canceled', 'Canceled')}
            </div>
            {experiment.status === 'RUNNING' && (
              <Button
                secondary={true}
                onClick={action(
                  experiment.id,
                  '/cancel',
                  'POST',
                  t('canceled', 'Canceled')
                )}
              >
                {t('cancel', 'Cancel')}
              </Button>
            )}
            {experiment.status === 'COMPLETED' &&
              !!experiment.winnerVariantId && (
                <Button
                  onClick={action(
                    experiment.id,
                    '/recycle-winner',
                    'POST',
                    t(
                      'winner_recycled',
                      'The winner was scheduled again in the next free time slot'
                    )
                  )}
                >
                  {t('recycle_winner', 'Recycle the winner')}
                </Button>
              )}
            <Button secondary={true} onClick={remove(experiment.id)}>
              {t('delete', 'Delete')}
            </Button>
          </div>
          <div className="grid grid-cols-[40px_1fr_140px_110px_110px_110px] mobile:grid-cols-[40px_1fr] gap-[8px] text-[13px] items-center">
            <div />
            <div className="text-newTextColor/60">
              {t('caption', 'Caption')}
            </div>
            <div className="text-newTextColor/60 mobile:hidden">
              {t('date', 'Date')}
            </div>
            <div className="text-newTextColor/60 mobile:hidden">
              {t('status', 'Status')}
            </div>
            <div className="text-newTextColor/60 mobile:hidden">
              {t('engagement', 'Engagement')}
            </div>
            <div className="text-newTextColor/60 mobile:hidden">
              {t('impressions', 'Impressions')}
            </div>
            {experiment.variants.map((variant: any) => (
              <div key={variant.id} className="contents">
                <div
                  className={clsx(
                    'w-[28px] h-[28px] rounded-full flex items-center justify-center',
                    experiment.winnerVariantId === variant.id
                      ? 'bg-green-600 text-white'
                      : 'bg-newTableBorder'
                  )}
                  data-tooltip-id="tooltip"
                  data-tooltip-content={
                    experiment.winnerVariantId === variant.id
                      ? t('winner', 'Winner')
                      : ''
                  }
                >
                  {variant.label}
                </div>
                <div className="truncate">
                  {variant.releaseURL ? (
                    <a
                      href={variant.releaseURL}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      {stripHtmlValidation('none', variant.content)}
                    </a>
                  ) : (
                    stripHtmlValidation('none', variant.content)
                  )}
                </div>
                <div className="mobile:hidden">
                  {fromUtc(variant.publishDate).format('DD/MM/YYYY HH:mm')}
                </div>
                <div className="mobile:hidden">{variant.state}</div>
                <div className="mobile:hidden">{variant.engagement ?? '-'}</div>
                <div className="mobile:hidden">
                  {variant.impressions ?? '-'}
                </div>
              </div>
            ))}
          </div>
        </GrowthCard>
      ))}
    </GrowthSection>
  );
};
