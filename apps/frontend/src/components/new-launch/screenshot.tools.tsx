'use client';

import React, { FC, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { SelectedIntegrations } from '@gitroom/frontend/components/new-launch/store';

const BUTTON =
  'select-none cursor-pointer rounded-[6px] mobile:rounded-[8px] w-[30px] h-[30px] mobile:w-[40px] mobile:h-[40px] bg-newColColor mobile:bg-newSettings flex justify-center items-center';

const toFile = (canvas: HTMLCanvasElement) =>
  new Promise<File | null>((resolve) => {
    canvas.toBlob((blob) => {
      resolve(
        blob
          ? new File([blob], `screenshot-${Date.now()}.png`, {
              type: 'image/png',
            })
          : null
      );
    }, 'image/png');
  });

// asks the browser for a window, tab or screen and keeps one frame of it
const grabScreen = async () => {
  const options: any = { video: true, audio: false };
  // stay on the post instead of jumping to what was picked
  if (typeof (window as any).CaptureController !== 'undefined') {
    options.controller = new (window as any).CaptureController();
    options.controller.setFocusBehavior?.('no-focus-change');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia(options);
  const video = document.createElement('video');
  try {
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // the first frames of a new capture can be empty
    await new Promise((resolve) => setTimeout(resolve, 300));

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    return canvas;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  }
};

const ScreenshotCrop: FC<{
  shot: HTMLCanvasElement;
  onSave: (canvas: HTMLCanvasElement) => void;
}> = ({ shot, onSave }) => {
  const t = useT();
  const [url] = useState(() => shot.toDataURL('image/png'));
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  // parts of the picture, from 0 to 1
  const [crop, setCrop] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const point = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const save = useCallback(() => {
    if (!crop) {
      onSave(shot);
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(crop.w * shot.width));
    canvas.height = Math.max(1, Math.round(crop.h * shot.height));
    canvas
      .getContext('2d')!
      .drawImage(
        shot,
        crop.x * shot.width,
        crop.y * shot.height,
        crop.w * shot.width,
        crop.h * shot.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
    onSave(canvas);
  }, [crop, shot, onSave]);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="text-[14px] text-textItemBlur">
        {t(
          'screenshot_crop_hint',
          'Drag over the picture to crop it, or add it as it is'
        )}
      </div>
      <div
        ref={box}
        className="relative self-center overflow-hidden select-none touch-none cursor-crosshair"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = point(e);
          setCrop(null);
        }}
        onPointerMove={(e) => {
          if (!start.current) {
            return;
          }
          const now = point(e);
          setCrop({
            x: Math.min(start.current.x, now.x),
            y: Math.min(start.current.y, now.y),
            w: Math.abs(now.x - start.current.x),
            h: Math.abs(now.y - start.current.y),
          });
        }}
        onPointerUp={() => {
          start.current = null;
          // a click is not a crop
          setCrop((p) => (p && p.w > 0.01 && p.h > 0.01 ? p : null));
        }}
      >
        <img
          src={url}
          draggable={false}
          className="block max-w-full max-h-[calc(100vh-330px)]"
          alt=""
        />
        {!!crop && (
          <div
            className="absolute border-2 border-white pointer-events-none shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.w * 100}%`,
              height: `${crop.h * 100}%`,
            }}
          />
        )}
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={save}>
          {t('screenshot_add', 'Add to post')}
        </Button>
      </div>
    </div>
  );
};

const POST_IMAGE_WIDTH = 1080;
const POST_IMAGE_PADDING = 80;
const POST_IMAGE_MIN_HEIGHT = 608;
const POST_IMAGE_MAX_HEIGHT = 1350;
const POST_IMAGE_AVATAR = 96;
const POST_IMAGE_THEMES = {
  dark: { background: '#14141c', text: '#ffffff', muted: '#8b8f98' },
  light: { background: '#ffffff', text: '#0f1419', muted: '#536471' },
};

const wrapText = (
  context: CanvasRenderingContext2D,
  text: string,
  width: number
) =>
  text.split('\n').flatMap((paragraph) => {
    const lines: string[] = [];
    let line = '';
    for (const word of paragraph.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (context.measureText(next).width <= width) {
        line = next;
        continue;
      }
      if (line) {
        lines.push(line);
      }
      // a word wider than the image, like a long link, breaks where it has to
      line = '';
      for (const char of Array.from(word)) {
        if (line && context.measureText(line + char).width > width) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line);
    return lines;
  });

// null when the picture is missing or its host doesn't allow reading it
const loadPicture = (src: string) =>
  new Promise<HTMLImageElement | null>((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    // a slow picture shouldn't hold the image back
    setTimeout(() => resolve(null), 5000);
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });

const drawPost = async (
  canvas: HTMLCanvasElement,
  text: string,
  channel: { name: string; display: string; picture: string },
  theme: keyof typeof POST_IMAGE_THEMES
) => {
  const colors = POST_IMAGE_THEMES[theme];
  const family = getComputedStyle(document.body).fontFamily;
  await Promise.all([
    document.fonts.load(`700 38px ${family}`),
    document.fonts.load(`400 38px ${family}`),
  ]).catch(() => null);
  const picture = await loadPicture(channel.picture);

  const context = canvas.getContext('2d')!;
  const textWidth = POST_IMAGE_WIDTH - POST_IMAGE_PADDING * 2;
  const measure = (size: number) => {
    context.font = `400 ${size}px ${family}`;
    const lines = wrapText(context, text, textWidth);
    const lineHeight = Math.round(size * 1.4);
    const content = POST_IMAGE_AVATAR + 44 + lines.length * lineHeight;
    return { size, lines, lineHeight, content };
  };
  // the longer the post, the smaller the text, to keep it a postable shape
  const sizes = [44, 38, 32];
  const layout =
    sizes
      .map(measure)
      .find((p) => p.content + POST_IMAGE_PADDING * 2 <= POST_IMAGE_MAX_HEIGHT) ||
    measure(28);

  // changing the size also resets the canvas
  canvas.width = POST_IMAGE_WIDTH;
  canvas.height = Math.max(
    POST_IMAGE_MIN_HEIGHT,
    layout.content + POST_IMAGE_PADDING * 2
  );
  context.fillStyle = colors.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.textBaseline = 'alphabetic';

  const top = (canvas.height - layout.content) / 2;
  const radius = POST_IMAGE_AVATAR / 2;
  context.save();
  context.beginPath();
  context.arc(
    POST_IMAGE_PADDING + radius,
    top + radius,
    radius,
    0,
    Math.PI * 2
  );
  context.clip();
  if (picture) {
    context.drawImage(
      picture,
      POST_IMAGE_PADDING,
      top,
      POST_IMAGE_AVATAR,
      POST_IMAGE_AVATAR
    );
  } else {
    context.fillStyle = colors.muted;
    context.fillRect(
      POST_IMAGE_PADDING,
      top,
      POST_IMAGE_AVATAR,
      POST_IMAGE_AVATAR
    );
    context.fillStyle = colors.background;
    context.font = `700 44px ${family}`;
    context.textAlign = 'center';
    context.fillText(
      Array.from(channel.name || '?')[0].toUpperCase(),
      POST_IMAGE_PADDING + radius,
      top + radius + 16
    );
    context.textAlign = 'start';
  }
  context.restore();

  const nameLeft = POST_IMAGE_PADDING + POST_IMAGE_AVATAR + 24;
  context.fillStyle = colors.text;
  context.font = `700 38px ${family}`;
  context.fillText(
    channel.name,
    nameLeft,
    top + (channel.display ? 42 : radius + 13)
  );
  if (channel.display) {
    context.fillStyle = colors.muted;
    context.font = `400 30px ${family}`;
    context.fillText(channel.display, nameLeft, top + 84);
  }

  context.fillStyle = colors.text;
  context.font = `400 ${layout.size}px ${family}`;
  layout.lines.forEach((line, index) => {
    context.fillText(
      line,
      POST_IMAGE_PADDING,
      top + POST_IMAGE_AVATAR + 44 + layout.size + index * layout.lineHeight
    );
  });
};

const PostImage: FC<{
  text: string;
  channels: SelectedIntegrations[];
  onSave: (canvas: HTMLCanvasElement) => void;
}> = ({ text, channels, onSave }) => {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState<keyof typeof POST_IMAGE_THEMES>('dark');
  const [channelIndex, setChannelIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const { name, display, picture } = channels[channelIndex].integration;

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    // drawn aside, so a slower earlier choice can't replace a newer one
    const next = document.createElement('canvas');
    drawPost(next, text, { name, display, picture }, theme).then(() => {
      if (cancelled || !canvas.current) {
        return;
      }
      canvas.current.width = next.width;
      canvas.current.height = next.height;
      canvas.current.getContext('2d')!.drawImage(next, 0, 0);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [text, name, display, picture, theme]);

  const chip = (selected: boolean) =>
    clsx(
      'cursor-pointer rounded-[4px] px-[10px] h-[30px] flex items-center text-[12px] border',
      selected
        ? 'bg-[#612BD3] border-[#612BD3] text-white'
        : 'bg-newColColor border-newBgLineColor'
    );

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap gap-[8px]">
        <div onClick={() => setTheme('dark')} className={chip(theme === 'dark')}>
          {t('post_image_dark', 'Dark')}
        </div>
        <div
          onClick={() => setTheme('light')}
          className={chip(theme === 'light')}
        >
          {t('post_image_light', 'Light')}
        </div>
        {channels.length > 1 &&
          channels.map((channel, index) => (
            <div
              key={channel.integration.id}
              onClick={() => setChannelIndex(index)}
              className={chip(index === channelIndex)}
            >
              {channel.integration.name}
            </div>
          ))}
      </div>
      <canvas
        ref={canvas}
        className="self-center max-w-full max-h-[calc(100vh-330px)] w-auto h-auto rounded-[8px] border border-newColColor"
      />
      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!ready}
          onClick={() => onSave(canvas.current!)}
        >
          {t('screenshot_add', 'Add to post')}
        </Button>
      </div>
    </div>
  );
};

export const ScreenshotTools: FC<{
  text: string;
  channels: SelectedIntegrations[];
  onFiles: (files: File[]) => void;
}> = ({ text, channels, onFiles }) => {
  const t = useT();
  const modals = useModals();
  const toaster = useToaster();
  // phones can't capture their screen from a page
  const [canCapture, setCanCapture] = useState(false);
  useEffect(() => {
    setCanCapture(!!navigator.mediaDevices?.getDisplayMedia);
  }, []);

  const attach = useCallback(
    async (canvas: HTMLCanvasElement, close: () => void) => {
      close();
      const file = await toFile(canvas);
      if (file) {
        onFiles([file]);
      }
    },
    [onFiles]
  );

  const capture = useCallback(async () => {
    let shot: HTMLCanvasElement;
    try {
      shot = await grabScreen();
    } catch (e) {
      // closing the browser's picker is not a failure
      if ((e as Error)?.name !== 'NotAllowedError') {
        toaster.show(
          t('screenshot_failed', 'Could not take the screenshot'),
          'warning'
        );
      }
      return;
    }

    modals.openModal({
      title: t('screenshot_capture', 'Take a screenshot'),
      size: '80%',
      children: (close) => (
        <ScreenshotCrop
          shot={shot}
          onSave={(canvas) => attach(canvas, close)}
        />
      ),
    });
  }, [attach, t]);

  const postImage = useCallback(() => {
    if (!text.trim()) {
      toaster.show(t('post_image_no_text', 'Write your post first'), 'warning');
      return;
    }
    if (!channels.length) {
      toaster.show(
        t('post_image_no_channel', 'Select a channel first'),
        'warning'
      );
      return;
    }

    modals.openModal({
      title: t('post_image', 'Turn this post into an image'),
      size: '720px',
      children: (close) => (
        <PostImage
          text={text}
          channels={channels}
          onSave={(canvas) => attach(canvas, close)}
        />
      ),
    });
  }, [text, channels, attach, t]);

  return (
    <>
      {canCapture && (
        <div
          onClick={capture}
          data-tooltip-id="tooltip"
          data-tooltip-content={t('screenshot_capture', 'Take a screenshot')}
          className={BUTTON}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            className="mobile:w-[20px] mobile:h-[20px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 8V6a3 3 0 0 1 3-3h2M16 3h2a3 3 0 0 1 3 3v2M21 16v2a3 3 0 0 1-3 3h-2M8 21H6a3 3 0 0 1-3-3v-2" />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
        </div>
      )}
      <div
        onClick={postImage}
        data-tooltip-id="tooltip"
        data-tooltip-content={t('post_image', 'Turn this post into an image')}
        className={BUTTON}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          className="mobile:w-[20px] mobile:h-[20px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <circle cx="8" cy="9" r="1.5" />
          <path d="M12 8h5M7 13.5h10M7 16.5h7" />
        </svg>
      </div>
    </>
  );
};
