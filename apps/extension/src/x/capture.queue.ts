import type { ParsedTweet } from './tweet.parser';

export const FLUSH_EVERY = 10_000;
export const FIRST_FLUSH_DELAY = 2_000;
// a tweet that was sent is sent again when its likes grew this much
export const RESEND_GROWTH = 1.2;
export const MAX_BATCH = 50;
// the public API reads up to 100kb of JSON
export const MAX_BATCH_BYTES = 90_000;
export const MAX_TEXT = 4_000;

// The tweets seen on the page, waiting to be sent to Postiz. Ids that were
// sent in this page session are not sent again, unless their likes grew.
export class CaptureQueue {
  private sent = new Map<string, number>();
  private waiting = new Map<string, ParsedTweet>();
  private lastFlush = 0;

  add(tweet: ParsedTweet) {
    const sentLikes = this.sent.get(tweet.id);
    if (
      sentLikes !== undefined &&
      tweet.likes < Math.max(sentLikes * RESEND_GROWTH, sentLikes + 1)
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
    const batch: ParsedTweet[] = [];
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
      this.sent.set(tweet.id, tweet.likes);
    }
    this.lastFlush = now;
    return batch;
  }
}
