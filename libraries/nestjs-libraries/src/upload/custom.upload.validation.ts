import { BadRequestException } from '@nestjs/common';
import { pipeline, Readable, Transform } from 'stream';
import { IUploadProvider } from './upload.interface';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fileTypeStream } = require('file-type');

// What users may put in the media library, whether by multipart upload or
// from a remote URL; narrower than what storage itself accepts, no audio
export const UPLOAD_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);

// the music library only takes mp3, which every browser can decode
export const MUSIC_ALLOWED_MIME = new Set<string>(['audio/mpeg']);

export function getMaxSize(mimeType: string): number {
  if (mimeType.startsWith('image/')) {
    return 10 * 1024 * 1024; // 10 MB
  } else if (mimeType.startsWith('video/')) {
    return 1024 * 1024 * 1024; // 1 GB
  } else if (mimeType.startsWith('audio/')) {
    return 30 * 1024 * 1024; // 30 MB
  } else {
    throw new BadRequestException('Unsupported file type.');
  }
}

// Passes bytes through and fails once they exceed maxSize, so a body with a
// missing or lying Content-Length cannot be streamed into storage unbounded
export function maxSizeStream(maxSize: number) {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      if (total > maxSize) {
        return callback(new BadRequestException('File is too large.'));
      }
      callback(null, chunk);
    },
  });
}

// mp3 files whose leading tag is malformed hide their audio from file-type,
// so where mp3 is allowed the start of the file is checked for real frames
const MP3_SCAN_BYTES = 256 * 1024;
const MP3_FRAMES_NEEDED = 5;
const MP3_BITRATES = [
  // MPEG-1 Layer III, then MPEG-2/2.5 Layer III, in kbit/s
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];
const MP3_SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

// the length of the Layer III frame starting at `at`, or 0 if there is none
function mp3FrameLength(bytes: Uint8Array, at: number) {
  if (at + 4 > bytes.length || bytes[at] !== 0xff) {
    return 0;
  }
  const version = (bytes[at + 1] >> 3) & 3;
  const layer = (bytes[at + 1] >> 1) & 3;
  const bitrate = (bytes[at + 2] >> 4) & 15;
  const rate = (bytes[at + 2] >> 2) & 3;
  if (
    (bytes[at + 1] & 0xe0) !== 0xe0 ||
    version === 1 ||
    layer !== 1 ||
    bitrate === 0 ||
    bitrate === 15 ||
    rate === 3
  ) {
    return 0;
  }
  const kbps = MP3_BITRATES[version === 3 ? 0 : 1][bitrate];
  const sampleRate = MP3_SAMPLE_RATES[version][rate];
  const padding = (bytes[at + 2] >> 1) & 1;
  return Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
}

// true when a run of back to back audio frames starts somewhere in `bytes`
export function hasMp3Frames(bytes: Uint8Array) {
  for (let start = 0; start < bytes.length - 4; start++) {
    let at = start;
    let frames = 0;
    let length = mp3FrameLength(bytes, at);
    while (length && frames < MP3_FRAMES_NEEDED) {
      frames++;
      at += length;
      length = mp3FrameLength(bytes, at);
    }
    if (frames >= MP3_FRAMES_NEEDED) {
      return true;
    }
  }
  return false;
}

// reads the start of a stream and gives back a stream of the whole of it
async function readStart(stream: ReadableStream<Uint8Array>, size: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < size) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const start = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    start.set(chunk, offset);
    offset += chunk.length;
  }
  const whole = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(start);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { start, whole };
}

// Sniffs the real type from the first bytes, applies the per-type size cap
// and streams the rest into storage, so only the sniffing prefix and a few
// upload parts are ever in memory. Rejections are BadRequestException with
// the same messages the old buffer validation used. `declaredSize` is the
// Content-Length when the sender gave one; it may be absent or wrong, so the
// stream cap is what really enforces the limit
export async function uploadStreamToStorage(
  storage: IUploadProvider,
  webStream: ReadableStream,
  declaredSize = 0,
  allowed = UPLOAD_ALLOWED_MIME
) {
  let sniffed: ReadableStream & { fileType?: { mime: string; ext: string } };
  try {
    sniffed = await fileTypeStream(webStream);
  } catch (err) {
    throw new BadRequestException('Failed to read file', { cause: err });
  }
  let detected = sniffed.fileType;
  if (!detected && allowed.has('audio/mpeg')) {
    const { start, whole } = await readStart(sniffed, MP3_SCAN_BYTES);
    sniffed = whole;
    if (hasMp3Frames(start)) {
      detected = { mime: 'audio/mpeg', ext: 'mp3' };
    }
  }
  if (!detected || !allowed.has(detected.mime)) {
    await sniffed.cancel();
    throw new BadRequestException('Unsupported file type.');
  }

  const maxSize = getMaxSize(detected.mime);
  if (declaredSize > maxSize) {
    await sniffed.cancel();
    throw new BadRequestException('File is too large.');
  }

  // pipeline (not pipe) so failing the cap also tears down the source
  const body = pipeline(
    Readable.fromWeb(sniffed as any),
    maxSizeStream(maxSize),
    () => {}
  );

  try {
    const uploaded = await storage.uploadStream(
      body,
      detected.mime,
      detected.ext
    );
    return { ...uploaded, ext: detected.ext };
  } catch (err) {
    // The size cap rejects mid-upload with its own BadRequestException
    body.destroy();
    throw err;
  }
}
