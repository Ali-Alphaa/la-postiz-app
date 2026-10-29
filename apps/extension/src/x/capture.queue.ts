import type { ParsedTweet } from './tweet.parser';

export const FLUSH_EVERY = 10_000;
export const FIRST_FLUSH_DELAY = 2_000;
// a tweet that was sent is sent again when its likes grew this much
export const RESEND_GROWTH = 1.2;
export const MAX_BATCH = 50;
// the public API reads up to 100kb of JSON
export const MAX_BATCH_BYTES = 90_000;
export const MAX_TEXT = 4_000;

export interface QueueItem {
  id: string;
  text: string;
  // null when the page doesn't show it
  likes: number | null;
}

// The posts seen on the page (tweets, Instagram posts, TikTok videos),
// waiting to be sent. Ids that were sent in this page session are not sent
// again, unless their likes grew.
export class CaptureQueue<T extends QueueItem = ParsedTweet> {
  private sent = new Map<string, number>();
  private waiting = new Map<string, T>();
  private lastFlush = 0;

  add(tweet: T) {
    const sentLikes = this.sent.get(tweet.id);
    const likes = tweet.likes ?? 0;
    if (
      sentLikes !== undefined &&
      likes < Math.max(sentLikes * RESEND_GROWTH, sentLikes + 1)
    ) {
      return false;
    }
    this.waiting.set(tweet.id, {
      ...tweet,
      text: tweet.text.slice(0, MAX_TEXT),
    });
    return true;
  }

  get size() {
    return this.waiting.size;
  }

  // in how many ms the next batch can go
  delay(now: number) {
    return Math.max(FIRST_FLUSH_DELAY, this.lastFlush + FLUSH_EVERY - now);
  }

  // the next batch, small enough for the API; the rest waits for next time
  take(now: number) {
    const batch: T[] = [];
    let bytes = 0;
    for (const tweet of this.waiting.values()) {
      const size = JSON.stringify(tweet).length;
      if (
        batch.length >= MAX_BATCH ||
        (batch.length && bytes + size > MAX_BATCH_BYTES)
      ) {
        break;
      }
      batch.push(tweet);
      bytes += size;
    }

    for (const tweet of batch) {
      this.waiting.delete(tweet.id);
      this.sent.set(tweet.id, tweet.likes ?? 0);
    }
    this.lastFlush = now;
    return batch;
  }
}
