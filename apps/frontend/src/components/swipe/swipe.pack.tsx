'use client';

import { FC, ReactNode, useCallback, useState } from 'react';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { checkTradingCompliance } from '@gitroom/helpers/utils/trading.compliance';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useXVoices } from '@gitroom/frontend/components/growth/growth.hooks';
import {
  useAiError,
  useOpenEditor,
} from '@gitroom/frontend/components/growth/x.inspiration';
import {
  CarouselSlide,
  SwipeCarousel,
} from '@gitroom/frontend/components/swipe/swipe.carousel';
import { SwipeEntry } from '@gitroom/frontend/components/swipe/swipe.hooks';

const inputClass =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] outline-none text-textColor';

interface Pack {
  xThread: string[];
  linkedinPost: string;
  instagramCaption: string;
  carouselSlides: CarouselSlide[];
  videoScript: string;
}

export const ComplianceNote: FC<{ text: string }> = ({ text }) => {
  const t = useT();
  const flags = checkTradingCompliance(text);
  if (!flags.length) {
    return null;
  }
  return (
    <div className="text-[12px] text-yellow-400">
      {t('compliance_check', 'Check before posting:')}{' '}
      {flags.map((p) => `${p.reason} ("${p.phrase}")`).join('; ')}
    </div>
  );
};

const Section: FC<{
  title: string;
  text: string;
  children?: ReactNode;
}> = ({ title, text, children }) => {
  const t = useT();
  const toaster = useToaster();
  return (
    <div className="border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[8px]">
      <div className="font-[600]">{title}</div>
      <div className="whitespace-pre-wrap break-words text-[14px]">{text}</div>
      <ComplianceNote text={text} />
      <div className="flex gap-[8px] flex-wrap">
        {children}
        <Button
          secondary={true}
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            toaster.show(t('swipe_copied', 'Copied'), 'success');
          }}
        >
          {t('swipe_copy', 'Copy')}
        </Button>
      </div>
    </div>
  );
};

// a post of the swipe file, or pasted text like a video transcript
export const SwipePack: FC<{ entry?: SwipeEntry }> = ({ entry }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modals = useModals();
  const openEditor = useOpenEditor();
  const aiError = useAiError();
  const { data: voices } = useXVoices();
  const withGuide = (
    (voices || []) as Array<{ handle: string; hasGuide: boolean }>
  ).filter((p) => p.hasGuide);
  const [text, setText] = useState('');
  const [voice, setVoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pack, setPack] = useState<Pack | null>(null);
  const voiceHandle = voice ?? withGuide[0]?.handle ?? '';

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/swipe/pack', {
        method: 'POST',
        body: JSON.stringify({
          ...(entry ? { entryId: entry.id } : { text }),
          ...(voiceHandle ? { voiceHandle } : {}),
        }),
      });
      const result = await response.json();
      const error = response.ok ? aiError(result) : result?.message;
      if (error) {
        toaster.show(error, 'warning');
        return;
      }
      setPack(result.pack);
    } finally {
      setLoading(false);
    }
  }, [entry, text, voiceHandle, aiError]);

  const carousel = useCallback(() => {
    if (pack) {
      modals.openModal({
        title: t('carousel_title', 'Carousel'),
        withCloseButton: true,
        size: '900px',
        children: (
          <SwipeCarousel
            caption={pack.instagramCaption}
            slides={pack.carouselSlides}
          />
        ),
      });
    }
  }, [pack, t]);

  return (
    <div className="flex flex-col gap-[14px]">
      {entry ? (
        <div className="whitespace-pre-wrap text-[13px] text-textItemBlur border border-newTableBorder rounded-[8px] p-[12px]">
          {entry.content}
        </div>
      ) : (
        <textarea
          className={clsx(inputClass, 'min-h-[160px]')}
          placeholder={t(
            'pack_paste',
            'Paste a post, an article or a video transcript'
          )}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      <div className="flex gap-[8px] flex-wrap">
        <select
          className={clsx(inputClass, 'max-w-[220px]')}
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
        <Button
          onClick={generate}
          loading={loading}
          disabled={loading || (!entry && !text.trim())}
        >
          {t('pack_generate', 'Create for all platforms')}
        </Button>
      </div>
      {!!pack && (
        <>
          <Section
            title={t('pack_x_thread', 'X thread')}
            text={pack.xThread.join('\n\n')}
          >
            <Button onClick={() => openEditor(pack.xThread)}>
              {t('swipe_open_composer', 'Open in composer as draft')}
            </Button>
          </Section>
          <Section
            title={t('pack_linkedin', 'LinkedIn post')}
            text={pack.linkedinPost}
          >
            <Button onClick={() => openEditor([pack.linkedinPost])}>
              {t('swipe_open_composer', 'Open in composer as draft')}
            </Button>
          </Section>
          <Section
            title={t('pack_instagram', 'Instagram carousel')}
            text={`${pack.instagramCaption}\n\n${pack.carouselSlides
              .map(
                (p, i) => `${i + 1}. ${p.title}${p.body ? `: ${p.body}` : ''}`
              )
              .join('\n')}`}
          >
            <Button onClick={carousel}>
              {t('pack_build_carousel', 'Build carousel images')}
            </Button>
          </Section>
          <Section
            title={t('pack_video', 'Short video script')}
            text={pack.videoScript}
          />
        </>
      )}
    </div>
  );
};

// text straight to slides
export const SwipeCarouselFromText: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const aiError = useAiError();
  const [text, setText] = useState('');
  const [slides, setSlides] = useState(6);
  const [loading, setLoading] = useState(false);
  const [carousel, setCarousel] = useState<{
    caption: string;
    slides: CarouselSlide[];
  } | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/swipe/carousel', {
        method: 'POST',
        body: JSON.stringify({ text, slides }),
      });
      const result = await response.json();
      const error = response.ok ? aiError(result) : result?.message;
      if (error) {
        toaster.show(error, 'warning');
        return;
      }
      setCarousel(result.carousel);
    } finally {
      setLoading(false);
    }
  }, [text, slides, aiError]);

  if (carousel) {
    return (
      <SwipeCarousel caption={carousel.caption} slides={carousel.slides} />
    );
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <textarea
        className={clsx(inputClass, 'min-h-[180px]')}
        placeholder={t('carousel_paste', 'Paste the text for the slides')}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex gap-[8px] items-center">
        <input
          type="number"
          min={3}
          max={12}
          className={clsx(inputClass, 'max-w-[90px]')}
          value={slides}
          onChange={(e) => setSlides(Number(e.target.value))}
        />
        <span className="text-[13px] text-textItemBlur">
          {t('carousel_slides', 'slides')}
        </span>
        <Button
          onClick={generate}
          loading={loading}
          disabled={loading || !text.trim()}
        >
          {t('carousel_write', 'Write the slides')}
        </Button>
      </div>
    </div>
  );
};
