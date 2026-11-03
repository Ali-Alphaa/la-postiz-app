'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useOpenEditor } from '@gitroom/frontend/components/growth/x.inspiration';
import {
  BrandKit,
  useBrandKit,
} from '@gitroom/frontend/components/growth/growth.tools.hooks';

export interface CarouselSlide {
  title: string;
  body: string;
}

const WIDTH = 1080;
const HEIGHT = 1350;
const MARGIN = 96;
const FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';

const wrap = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) => {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
};

// the title shrinks until the text fits between the top bar and the footer
const drawSlide = (
  canvas: HTMLCanvasElement,
  slide: CarouselSlide,
  index: number,
  total: number,
  brand: BrandKit
) => {
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = brand.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = brand.accent;
  ctx.fillRect(MARGIN, MARGIN, 120, 12);

  const maxWidth = WIDTH - MARGIN * 2;
  const available = HEIGHT - MARGIN * 2 - 160;
  let titleSize = index === 0 ? 104 : 84;
  let bodySize = 46;
  let titleLines: string[] = [];
  let bodyLines: string[] = [];
  let height = 0;
  while (titleSize >= 40) {
    ctx.font = `700 ${titleSize}px ${FONT}`;
    titleLines = slide.title.trim()
      ? wrap(ctx, slide.title.trim(), maxWidth)
      : [];
    ctx.font = `400 ${bodySize}px ${FONT}`;
    bodyLines = slide.body.trim() ? wrap(ctx, slide.body.trim(), maxWidth) : [];
    height =
      titleLines.length * titleSize * 1.15 +
      (bodyLines.length ? 48 + bodyLines.length * bodySize * 1.4 : 0);
    if (height <= available) {
      break;
    }
    titleSize -= 6;
    bodySize = Math.max(30, bodySize - 2);
  }

  ctx.textBaseline = 'top';
  let y = Math.max(MARGIN + 80, (HEIGHT - height) / 2 - 20);
  ctx.fillStyle = brand.text;
  ctx.font = `700 ${titleSize}px ${FONT}`;
  for (const line of titleLines) {
    ctx.fillText(line, MARGIN, y);
    y += titleSize * 1.15;
  }
  y += 48;
  ctx.globalAlpha = 0.85;
  ctx.font = `400 ${bodySize}px ${FONT}`;
  for (const line of bodyLines) {
    ctx.fillText(line, MARGIN, y);
    y += bodySize * 1.4;
  }
  ctx.globalAlpha = 0.7;
  ctx.font = `500 32px ${FONT}`;
  ctx.fillText(brand.handle || '', MARGIN, HEIGHT - MARGIN - 32);
  const page = `${index + 1}/${total}`;
  ctx.fillText(
    page,
    WIDTH - MARGIN - ctx.measureText(page).width,
    HEIGHT - MARGIN - 32
  );
  ctx.globalAlpha = 1;
};

const SlidePreview: FC<{
  slide: CarouselSlide;
  index: number;
  total: number;
  brand: BrandKit;
  register: (index: number, canvas: HTMLCanvasElement | null) => void;
}> = ({ slide, index, total, brand, register }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (ref.current) {
      drawSlide(ref.current, slide, index, total, brand);
    }
  }, [slide, index, total, brand]);

  return (
    <canvas
      ref={(el) => {
        ref.current = el;
        register(index, el);
      }}
      className="w-[160px] h-[200px] rounded-[8px] border border-newTableBorder flex-shrink-0"
    />
  );
};

const COLORS: Array<['background' | 'text' | 'accent', string]> = [
  ['background', 'Background'],
  ['text', 'Text'],
  ['accent', 'Accent'],
];

export const SwipeCarousel: FC<{
  caption: string;
  slides: CarouselSlide[];
}> = (props) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const openEditor = useOpenEditor();
  const { data: saved, mutate } = useBrandKit();
  const [brand, setBrand] = useState<BrandKit | null>(null);
  const [slides, setSlides] = useState(props.slides);
  const [caption, setCaption] = useState(props.caption);
  const [loading, setLoading] = useState(false);
  const canvases = useRef<Record<number, HTMLCanvasElement | null>>({});
  const current = brand || saved;

  const register = useCallback(
    (index: number, canvas: HTMLCanvasElement | null) => {
      canvases.current[index] = canvas;
    },
    []
  );

  const changeBrand = useCallback(
    (key: keyof BrandKit, value: string) => {
      if (current) {
        setBrand({ ...current, [key]: value });
      }
    },
    [current]
  );

  const change = useCallback(
    (index: number, key: keyof CarouselSlide, value: string) =>
      setSlides((prev) =>
        prev.map((p, i) => (i === index ? { ...p, [key]: value } : p))
      ),
    []
  );

  const send = useCallback(async () => {
    if (!current) {
      return;
    }
    setLoading(true);
    try {
      await fetch('/growth-tools/brand', {
        method: 'PUT',
        body: JSON.stringify({
          background: current.background,
          text: current.text,
          accent: current.accent,
          handle: current.handle || null,
        }),
      });
      mutate();

      const images: Array<{ id: string; path: string }> = [];
      for (let index = 0; index < slides.length; index++) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvases.current[index]?.toBlob(resolve, 'image/jpeg', 0.92)
        );
        if (!blob) {
          throw new Error('render');
        }
        const body = new FormData();
        body.append('file', blob, `slide-${index + 1}.jpg`);
        const response = await fetch('/media/upload-simple', {
          method: 'POST',
          body,
        });
        if (!response.ok) {
          throw new Error('upload');
        }
        const { id, path } = await response.json();
        images.push({ id, path });
      }
      await openEditor([caption], undefined, images);
    } catch (err) {
      toaster.show(
        t('carousel_failed', 'Could not create the slides, try again'),
        'warning'
      );
    } finally {
      setLoading(false);
    }
  }, [current, slides, caption, t, mutate, openEditor]);

  if (!current) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex gap-[12px] flex-wrap items-center text-[13px]">
        {COLORS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-[6px]">
            <input
              type="color"
              value={current[key]}
              onChange={(e) => changeBrand(key, e.target.value)}
            />
            {label}
          </label>
        ))}
        <input
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[6px] text-textColor outline-none"
          placeholder={t('carousel_handle', '@handle on every slide')}
          value={current.handle || ''}
          maxLength={60}
          onChange={(e) => changeBrand('handle', e.target.value)}
        />
      </div>
      <div className="flex gap-[10px] overflow-x-auto pb-[6px]">
        {slides.map((slide, index) => (
          <SlidePreview
            key={index}
            slide={slide}
            index={index}
            total={slides.length}
            brand={current}
            register={register}
          />
        ))}
      </div>
      <div className="flex flex-col gap-[8px] max-h-[260px] overflow-y-auto">
        {slides.map((slide, index) => (
          <div key={index} className="flex gap-[8px]">
            <input
              className="flex-1 bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[10px] py-[6px] text-textColor outline-none text-[13px]"
              value={slide.title}
              onChange={(e) => change(index, 'title', e.target.value)}
            />
            <input
              className="flex-[2] bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[10px] py-[6px] text-textColor outline-none text-[13px]"
              value={slide.body}
              onChange={(e) => change(index, 'body', e.target.value)}
            />
          </div>
        ))}
      </div>
      <textarea
        className="bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-textColor outline-none text-[13px] min-h-[70px]"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
      />
      <Button onClick={send} loading={loading} disabled={loading}>
        {t('carousel_open', 'Create images and open in composer')}
      </Button>
    </div>
  );
};
