'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';

const inputClass =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] outline-none text-textColor';

export interface MusicTrack {
  id: string;
  title: string;
  artist: string | null;
  licence: string | null;
  path: string;
  duration: number | null;
}

export const useMusicTracks = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/music')).json();
  }, []);
  return useSWR<MusicTrack[]>('music-tracks', load);
};

const formatLength = (seconds: number | null) => {
  if (seconds === null || seconds === undefined) {
    return '';
  }
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

// the browser reads the length, the server never decodes audio
const readLength = (file: File) =>
  new Promise<number | null>((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () =>
      done(isFinite(audio.duration) ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });

const UploadForm: FC<{ done: () => void }> = ({ done }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [licence, setLicence] = useState('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    if (!file || !title.trim()) {
      toaster.show(
        t('music_need_file', 'Choose an mp3 and give it a title'),
        'warning'
      );
      return;
    }
    setSaving(true);
    const form = new FormData();
    form.append('file', file);
    form.append('title', title.trim());
    form.append('artist', artist.trim());
    form.append('licence', licence.trim());
    const length = await readLength(file);
    if (length !== null) {
      form.append('duration', String(Math.min(3600, length)));
    }
    const response = await fetch('/music', { method: 'POST', body: form });
    setSaving(false);
    if (!response.ok) {
      toaster.show(
        t('music_upload_failed', 'Could not add the track, only mp3 is accepted'),
        'warning'
      );
      return;
    }
    toaster.show(t('music_added', 'Track added'), 'success');
    done();
  }, [file, title, artist, licence, done, t]);

  return (
    <div className="border border-newTableBorder rounded-[8px] p-[16px] flex flex-col gap-[10px] max-w-[560px]">
      <input
        type="file"
        accept=".mp3,audio/mpeg"
        onChange={(e) => {
          const picked = e.target.files?.[0] || null;
          setFile(picked);
          if (picked && !title) {
            setTitle(picked.name.replace(/\.[^.]+$/, '').slice(0, 120));
          }
        }}
      />
      <input
        className={inputClass}
        value={title}
        maxLength={120}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('music_title', 'Title')}
      />
      <input
        className={inputClass}
        value={artist}
        maxLength={120}
        onChange={(e) => setArtist(e.target.value)}
        placeholder={t('music_artist', 'Artist')}
      />
      <input
        className={inputClass}
        value={licence}
        maxLength={200}
        onChange={(e) => setLicence(e.target.value)}
        placeholder={t('music_licence', 'Licence, like Mixkit Free License')}
      />
      <div className="flex">
        <Button loading={saving} onClick={save}>
          {t('music_add', 'Add track')}
        </Button>
      </div>
    </div>
  );
};

const TrackRow: FC<{ track: MusicTrack; reload: () => void }> = ({
  track,
  reload,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const mediaDirectory = useMediaDirectory();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist || '');
  const [licence, setLicence] = useState(track.licence || '');

  const save = useCallback(async () => {
    if (!title.trim()) {
      return;
    }
    const response = await fetch(`/music/${track.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        title: title.trim(),
        artist: artist.trim(),
        licence: licence.trim(),
      }),
    });
    if (!response.ok) {
      toaster.show(t('music_save_failed', 'Could not save the track'), 'warning');
      return;
    }
    setEditing(false);
    reload();
  }, [title, artist, licence, track.id, fetch, reload, toaster, t]);

  const remove = useCallback(async () => {
    if (
      !(await deleteDialog(
        t('music_delete', 'Remove this track from the music library?'),
        t('remove', 'Remove')
      ))
    ) {
      return;
    }
    const response = await fetch(`/music/${track.id}`, { method: 'DELETE' });
    if (!response.ok) {
      toaster.show(
        t('music_remove_failed', 'Could not remove the track'),
        'warning'
      );
      return;
    }
    toaster.show(t('music_removed', 'Track removed'), 'success');
    reload();
  }, [track.id, fetch, reload, toaster, t]);

  return (
    <div className="border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[8px]">
      {editing ? (
        <div className="flex flex-col gap-[8px]">
          <input
            className={inputClass}
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
          />
          <input
            className={inputClass}
            value={artist}
            maxLength={120}
            onChange={(e) => setArtist(e.target.value)}
            placeholder={t('music_artist', 'Artist')}
          />
          <input
            className={inputClass}
            value={licence}
            maxLength={200}
            onChange={(e) => setLicence(e.target.value)}
            placeholder={t('music_licence', 'Licence, like Mixkit Free License')}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-[2px]">
          <div className="font-[600]">{track.title}</div>
          <div className="text-[12px] text-textItemBlur">
            {[track.artist, formatLength(track.duration), track.licence]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      )}
      <audio
        controls={true}
        preload="none"
        src={mediaDirectory.set(track.path)}
        className="w-full h-[36px]"
      />
      <div className="flex gap-[8px]">
        {editing ? (
          <Button onClick={save}>{t('save', 'Save')}</Button>
        ) : (
          <Button secondary={true} onClick={() => setEditing(true)}>
            {t('edit', 'Edit')}
          </Button>
        )}
        <Button secondary={true} onClick={remove}>
          {t('remove', 'Remove')}
        </Button>
      </div>
    </div>
  );
};

export const MusicComponent: FC = () => {
  const t = useT();
  const { data, mutate } = useMusicTracks();
  const [adding, setAdding] = useState(false);

  return (
    <div className="bg-newBgColorInner p-[20px] flex flex-1 flex-col gap-[15px] transition-all">
      <div className="flex gap-[8px] items-center">
        <Button onClick={() => setAdding(!adding)}>
          {t('music_add', 'Add track')}
        </Button>
      </div>
      <div className="text-[13px] text-textItemBlur max-w-[640px]">
        {t(
          'music_rights',
          'Only add music you are allowed to use in your posts. Tracks stay on your server and are mixed into videos in your browser.'
        )}
      </div>
      {adding && (
        <UploadForm
          done={() => {
            setAdding(false);
            mutate();
          }}
        />
      )}
      {data && !data.length && (
        <div className="text-[13px] text-textItemBlur">
          {t('music_none', 'No tracks yet')}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-[12px]">
        {(data || []).map((track) => (
          <TrackRow key={track.id} track={track} reload={() => mutate()} />
        ))}
      </div>
    </div>
  );
};

const SAMPLE_RATE = 48000;
// the whole video is read into the browser, so very large ones are refused
const MAX_SOURCE_SIZE = 300 * 1024 * 1024;
const FRAME_RATE = 30;
const MAX_WIDTH = 1080;
const MAX_HEIGHT = 1920;

interface MusicSettings {
  start: number;
  musicVolume: number;
  videoVolume: number;
  fade: number;
  seconds: number;
}

class MusicError extends Error {}

// the music, and the video's own sound when it is kept, as one track
const mixAudio = async (
  duration: number,
  song: ArrayBuffer,
  settings: MusicSettings,
  original: Array<{ buffer: AudioBuffer; timestamp: number }>
) => {
  const context = new OfflineAudioContext(
    2,
    Math.ceil(duration * SAMPLE_RATE),
    SAMPLE_RATE
  );
  const music = await context.decodeAudioData(song);

  const musicGain = context.createGain();
  musicGain.gain.setValueAtTime(settings.musicVolume, 0);
  if (settings.fade > 0 && duration > settings.fade) {
    musicGain.gain.setValueAtTime(
      settings.musicVolume,
      duration - settings.fade
    );
    musicGain.gain.linearRampToValueAtTime(0, duration);
  }
  musicGain.connect(context.destination);

  const musicSource = context.createBufferSource();
  musicSource.buffer = music;
  // a short track starts again from the top
  musicSource.loop = true;
  musicSource.connect(musicGain);
  musicSource.start(0, Math.min(settings.start, Math.max(0, music.duration - 1)));

  if (original.length) {
    const videoGain = context.createGain();
    videoGain.gain.value = settings.videoVolume;
    videoGain.connect(context.destination);
    for (const part of original) {
      const source = context.createBufferSource();
      source.buffer = part.buffer;
      source.connect(videoGain);
      source.start(Math.max(0, part.timestamp));
    }
  }

  return context.startRendering();
};

// hands the mixed sound over a second at a time, next to the video, so the
// muxer never holds one track waiting for the other
const audioFeeder = (
  mixed: AudioBuffer,
  add: (buffer: AudioBuffer) => Promise<void>
) => {
  let position = 0;
  return async (until: number) => {
    const end = Math.min(mixed.length, Math.ceil(until * SAMPLE_RATE));
    while (position < end) {
      const length = Math.min(SAMPLE_RATE, end - position);
      const part = new AudioBuffer({
        length,
        numberOfChannels: mixed.numberOfChannels,
        sampleRate: SAMPLE_RATE,
      });
      for (let channel = 0; channel < mixed.numberOfChannels; channel++) {
        part.copyToChannel(
          mixed.getChannelData(channel).subarray(position, position + length),
          channel
        );
      }
      position += length;
      await add(part);
    }
  };
};

const loadImage = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new MusicError('image'));
    image.src = url;
  });

const makeMusicVideo = async (
  sourceUrl: string,
  isVideo: boolean,
  songUrl: string,
  settings: MusicSettings,
  onProgress: (value: number) => void
) => {
  const mediabunny = await import('mediabunny');
  if (
    !(await mediabunny.canEncodeAudio('aac', {
      numberOfChannels: 2,
      sampleRate: SAMPLE_RATE,
      bitrate: 128000,
    }))
  ) {
    throw new MusicError('aac');
  }

  const song = await (await fetch(songUrl)).arrayBuffer();
  const output = new mediabunny.Output({
    format: new mediabunny.Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new mediabunny.BufferTarget(),
  });
  const audioSource = new mediabunny.AudioBufferSource({
    codec: 'aac',
    bitrate: 128000,
  });

  if (isVideo) {
    const response = await fetch(sourceUrl);
    if (+(response.headers.get('content-length') || 0) > MAX_SOURCE_SIZE) {
      throw new MusicError('large');
    }
    const input = new mediabunny.Input({
      source: new mediabunny.BlobSource(await response.blob()),
      formats: mediabunny.ALL_FORMATS,
    });
    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      const decoderConfig = await videoTrack?.getDecoderConfig();
      if (!videoTrack?.codec || !decoderConfig) {
        throw new MusicError('video');
      }
      const duration = await input.computeDuration();

      const original: Array<{ buffer: AudioBuffer; timestamp: number }> = [];
      const audioTrack =
        settings.videoVolume > 0 ? await input.getPrimaryAudioTrack() : null;
      if (audioTrack && (await audioTrack.canDecode())) {
        for await (const part of new mediabunny.AudioBufferSink(
          audioTrack
        ).buffers()) {
          original.push(part);
        }
      }
      const feed = audioFeeder(
        await mixAudio(duration, song, settings, original),
        (buffer) => audioSource.add(buffer)
      );

      // the picture is copied as it is, only the sound is encoded
      const videoSource = new mediabunny.EncodedVideoPacketSource(
        videoTrack.codec
      );
      output.addVideoTrack(videoSource, { rotation: videoTrack.rotation });
      output.addAudioTrack(audioSource);
      await output.start();

      let first = true;
      for await (const packet of new mediabunny.EncodedPacketSink(
        videoTrack
      ).packets()) {
        await feed(packet.timestamp + 1);
        await videoSource.add(packet, first ? { decoderConfig } : undefined);
        first = false;
        onProgress(Math.min(1, packet.timestamp / duration));
      }
      await feed(duration);
    } finally {
      input.dispose();
    }
  } else {
    const image = await loadImage(sourceUrl);
    const scale = Math.min(
      1,
      MAX_WIDTH / image.naturalWidth,
      MAX_HEIGHT / image.naturalHeight
    );
    // encoders want even sizes
    const width = Math.max(2, Math.round((image.naturalWidth * scale) / 2) * 2);
    const height = Math.max(
      2,
      Math.round((image.naturalHeight * scale) / 2) * 2
    );
    if (!(await mediabunny.canEncodeVideo('avc', { width, height }))) {
      throw new MusicError('avc');
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(image, 0, 0, width, height);

    const feed = audioFeeder(
      await mixAudio(settings.seconds, song, settings, []),
      (buffer) => audioSource.add(buffer)
    );
    const videoSource = new mediabunny.CanvasSource(canvas, {
      codec: 'avc',
      bitrate: mediabunny.QUALITY_HIGH,
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: FRAME_RATE });
    output.addAudioTrack(audioSource);
    await output.start();

    const frames = settings.seconds * FRAME_RATE;
    for (let frame = 0; frame < frames; frame++) {
      await feed(frame / FRAME_RATE + 1);
      await videoSource.add(frame / FRAME_RATE, 1 / FRAME_RATE);
      onProgress(frame / frames);
    }
    await feed(settings.seconds);
  }

  await output.finalize();
  return new File(
    [output.target.buffer!],
    `music-${Date.now()}.mp4`,
    { type: 'video/mp4' }
  );
};

const Slider: FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  shown: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, shown, onChange }) => (
  <label className="flex flex-col gap-[4px] text-[13px]">
    <div className="flex justify-between">
      <span>{label}</span>
      <span className="text-textItemBlur">{shown}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(+e.target.value)}
    />
  </label>
);

const chip = (selected: boolean) =>
  clsx(
    'cursor-pointer rounded-[4px] px-[10px] h-[30px] flex items-center text-[12px] border',
    selected
      ? 'bg-[#612BD3] border-[#612BD3] text-white'
      : 'bg-newColColor border-newBgLineColor'
  );

const MusicMaker: FC<{
  pictures: Array<{ id: string; path: string }>;
  onSave: (file: File, replaceId: string | null) => void;
}> = ({ pictures, onSave }) => {
  const t = useT();
  const toaster = useToaster();
  const mediaDirectory = useMediaDirectory();
  const { data: tracks } = useMusicTracks();
  const [sourceId, setSourceId] = useState(pictures[0]?.id || '');
  const [trackId, setTrackId] = useState('');
  const [start, setStart] = useState(0);
  const [musicVolume, setMusicVolume] = useState(80);
  const [videoVolume, setVideoVolume] = useState(100);
  const [fade, setFade] = useState(2);
  const [seconds, setSeconds] = useState(15);
  const [replace, setReplace] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ file: File; url: string } | null>(
    null
  );
  const resultUrl = useRef('');
  const open = useRef(true);

  useEffect(() => {
    if (!trackId && tracks?.length) {
      setTrackId(tracks[0].id);
    }
  }, [tracks, trackId]);

  // the preview video is only kept while the window is open
  useEffect(() => {
    return () => {
      open.current = false;
      if (resultUrl.current) {
        URL.revokeObjectURL(resultUrl.current);
      }
    };
  }, []);

  const source = pictures.find((p) => p.id === sourceId);
  const track = tracks?.find((p) => p.id === trackId);
  const isVideo = !!source && hasExtension(source.path, 'mp4');

  const create = useCallback(async () => {
    if (!source || !track) {
      return;
    }
    setProgress(0);
    try {
      const file = await makeMusicVideo(
        mediaDirectory.set(source.path),
        isVideo,
        mediaDirectory.set(track.path),
        {
          start,
          musicVolume: musicVolume / 100,
          videoVolume: videoVolume / 100,
          fade,
          seconds,
        },
        setProgress
      );
      // closed while it was being made
      if (!open.current) {
        return;
      }
      if (resultUrl.current) {
        URL.revokeObjectURL(resultUrl.current);
      }
      resultUrl.current = URL.createObjectURL(file);
      setResult({ file, url: resultUrl.current });
    } catch (e) {
      if (!open.current) {
        return;
      }
      const reason = e instanceof MusicError ? e.message : '';
      toaster.show(
        reason === 'aac' || reason === 'avc'
          ? t(
              'music_unsupported',
              'This browser cannot make the video, use Chrome or Edge on a computer'
            )
          : reason === 'large'
          ? t('music_too_large', 'This video is too large, the limit is 300 MB')
          : t('music_failed', 'Could not add the music to this video'),
        'warning'
      );
    }
    if (open.current) {
      setProgress(null);
    }
  }, [source, track, isVideo, start, musicVolume, videoVolume, fade, seconds]);

  if (!pictures.length) {
    return (
      <div className="text-[14px] text-textItemBlur">
        {t(
          'music_need_media',
          'Attach a video or a picture to this post first'
        )}
      </div>
    );
  }

  if (tracks && !tracks.length) {
    return (
      <div className="text-[14px] text-textItemBlur">
        {t('music_need_track', 'Add a track on the Music page first')}
      </div>
    );
  }

  if (result) {
    return (
      <div className="flex flex-col gap-[16px]">
        <video
          src={result.url}
          controls={true}
          className="self-center max-w-full max-h-[calc(100vh-330px)] rounded-[8px]"
        />
        <div className="flex justify-end gap-[8px]">
          <Button secondary={true} onClick={() => setResult(null)}>
            {t('music_change', 'Change settings')}
          </Button>
          <Button
            onClick={() => onSave(result.file, replace ? sourceId : null)}
          >
            {t('screenshot_add', 'Add to post')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">
          {t('music_source', 'Video or picture')}
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {pictures.map((picture) => (
            <div
              key={picture.id}
              onClick={() => setSourceId(picture.id)}
              className={clsx(
                'w-[64px] h-[64px] rounded-[6px] overflow-hidden cursor-pointer border-2',
                picture.id === sourceId
                  ? 'border-[#612BD3]'
                  : 'border-transparent'
              )}
            >
              {hasExtension(picture.path, 'mp4') ? (
                <video
                  src={mediaDirectory.set(picture.path)}
                  muted={true}
                  preload="metadata"
                  className="w-full h-full object-cover"
                />
              ) : (
                <img
                  src={mediaDirectory.set(picture.path)}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-[6px]">
        <div className="text-[14px]">{t('music_track', 'Track')}</div>
        <div className="flex flex-wrap gap-[8px]">
          {(tracks || []).map((item) => (
            <div
              key={item.id}
              onClick={() => {
                setTrackId(item.id);
                setStart(0);
              }}
              className={chip(item.id === trackId)}
            >
              {item.title}
            </div>
          ))}
        </div>
        {!!track && (
          <audio
            controls={true}
            preload="none"
            src={mediaDirectory.set(track.path)}
            className="w-full h-[36px]"
          />
        )}
      </div>
      <div className="grid grid-cols-2 mobile:grid-cols-1 gap-[16px]">
        <Slider
          label={t('music_start', 'Music starts at')}
          value={start}
          min={0}
          max={Math.max(0, Math.floor((track?.duration || 60) - 1))}
          shown={formatLength(start)}
          onChange={setStart}
        />
        <Slider
          label={t('music_volume', 'Music volume')}
          value={musicVolume}
          min={0}
          max={100}
          shown={`${musicVolume}%`}
          onChange={setMusicVolume}
        />
        {isVideo ? (
          <Slider
            label={t('music_video_volume', 'Video sound')}
            value={videoVolume}
            min={0}
            max={100}
            shown={videoVolume ? `${videoVolume}%` : t('music_off', 'Off')}
            onChange={setVideoVolume}
          />
        ) : (
          <div className="flex flex-col gap-[4px] text-[13px]">
            <span>{t('music_length', 'Video length')}</span>
            <div className="flex gap-[8px]">
              {[10, 15, 30].map((value) => (
                <div
                  key={value}
                  onClick={() => setSeconds(value)}
                  className={chip(seconds === value)}
                >
                  {value}s
                </div>
              ))}
            </div>
          </div>
        )}
        <Slider
          label={t('music_fade', 'Fade out')}
          value={fade}
          min={0}
          max={5}
          shown={fade ? `${fade}s` : t('music_off', 'Off')}
          onChange={setFade}
        />
      </div>
      <label className="flex gap-[8px] items-center text-[13px]">
        <input
          type="checkbox"
          checked={replace}
          onChange={(e) => setReplace(e.target.checked)}
        />
        {t('music_replace', 'Replace the original in this post')}
      </label>
      <div className="flex justify-end">
        <Button
          disabled={!source || !track}
          loading={progress !== null}
          onClick={create}
        >
          {t('music_create', 'Create video')}
        </Button>
      </div>
      {progress !== null && (
        <div className="text-[13px] text-textItemBlur text-end">
          {Math.round(progress * 100)}%
        </div>
      )}
    </div>
  );
};

// the composer button, shown where the browser can encode the video
export const MusicBox: FC<{
  pictures: Array<{ id: string; path: string }>;
  // replaceId is the attachment the new video takes the place of
  onFile: (file: File, replaceId: string | null) => void;
}> = ({ pictures, onFile }) => {
  const t = useT();
  const modals = useModals();
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (typeof AudioEncoder === 'undefined' || typeof VideoEncoder === 'undefined') {
      return;
    }
    AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: SAMPLE_RATE,
      numberOfChannels: 2,
      bitrate: 128000,
    })
      .then((result) => setSupported(!!result.supported))
      .catch(() => setSupported(false));
  }, []);

  const open = useCallback(() => {
    modals.openModal({
      title: t('music_add_to_post', 'Add music'),
      size: '720px',
      children: (close) => (
        <MusicMaker
          pictures={pictures}
          onSave={(file, replaceId) => {
            close();
            onFile(file, replaceId);
          }}
        />
      ),
    });
  }, [pictures, onFile, t]);

  if (!supported) {
    return null;
  }

  return (
    <div
      onClick={open}
      data-tooltip-id="tooltip"
      data-tooltip-content={t('music_add_to_post', 'Add music')}
      className="select-none cursor-pointer rounded-[6px] mobile:rounded-[8px] w-[30px] h-[30px] mobile:w-[40px] mobile:h-[40px] bg-newColColor mobile:bg-newSettings flex justify-center items-center"
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
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
};
