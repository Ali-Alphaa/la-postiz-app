// Content script of x.com / twitter.com. It only reads the tweets that are on
// the screen of the user: no scrolling, clicking, navigation or calls to X.
// The tweets go to the service worker, which holds the Postiz API key.
import { getOwnHandle, ParsedTweet, parseTweet } from './tweet.parser';
import { CaptureQueue } from './capture.queue';
import { NativeItem, scheduleOne } from './native.scheduler';

const TWEET = 'article[data-testid="tweet"]';
const BUTTON_ATTRIBUTE = 'data-postiz-save';
const SCAN_DELAY = 800;

const queue = new CaptureQueue();
const savedByHand = new Set<string>();
let scanTimer: ReturnType<typeof setTimeout> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = false;

const toPayload = (tweet: ParsedTweet, manual = false) => ({
  id: tweet.id,
  url: tweet.url,
  authorHandle: tweet.authorHandle,
  authorName: tweet.authorName?.slice(0, 100) || undefined,
  text: tweet.text,
  likes: tweet.likes,
  reposts: tweet.reposts,
  replies: tweet.replies,
  views: tweet.views ?? undefined,
  mediaType: tweet.mediaType,
  postedAt: tweet.postedAt || undefined,
  isReply: tweet.isReply,
  isQuote: tweet.isQuote,
  own: tweet.own,
  ...(manual ? { manual: true } : {}),
});

// the extension was reloaded or removed: this page can't reach it anymore
const stop = () => {
  stopped = true;
  observer.disconnect();
  clearTimeout(scanTimer);
  clearTimeout(flushTimer);
};

const send = async (message: Record<string, unknown>) => {
  try {
    return await chrome.runtime.sendMessage({
      ...message,
      ownHandle: getOwnHandle(document) || undefined,
      utcOffset: new Date().getTimezoneOffset(),
    });
  } catch (err) {
    if (!chrome.runtime?.id) {
      stop();
    }
    return { ok: false };
  }
};

const flush = async () => {
  flushTimer = undefined;
  const batch = queue.take(Date.now());
  if (batch.length) {
    await send({ type: 'X_CAPTURE', tweets: batch.map((p) => toPayload(p)) });
  }
  scheduleFlush();
};

const scheduleFlush = () => {
  if (stopped || flushTimer || !queue.size) {
    return;
  }
  flushTimer = setTimeout(flush, queue.delay(Date.now()));
};

const setButtonState = (
  button: HTMLButtonElement,
  state: 'idle' | 'saving' | 'saved' | 'error'
) => {
  button.dataset.state = state;
  button.disabled = state === 'saving' || state === 'saved';
  button.textContent =
    state === 'saving'
      ? 'Saving…'
      : state === 'saved'
      ? 'Saved ✓'
      : state === 'error'
      ? 'Retry save'
      : 'Save to Postiz';
  button.title =
    state === 'error'
      ? 'Could not save: check the Postiz extension options'
      : 'Save this tweet to your Postiz library';
};

// only runs when the user clicks the button
const saveByHand = async (article: Element, button: HTMLButtonElement) => {
  const tweet = parseTweet(article, getOwnHandle(document));
  if (!tweet) {
    setButtonState(button, 'error');
    return;
  }
  setButtonState(button, 'saving');
  const response = await send({
    type: 'X_SAVE',
    tweets: [toPayload(tweet, true)],
  });
  if (response?.ok && response.manual?.includes(tweet.id)) {
    savedByHand.add(tweet.id);
    setButtonState(button, 'saved');
    return;
  }
  setButtonState(button, 'error');
};

const addSaveButton = (article: Element, tweet: ParsedTweet) => {
  const bar = Array.from(article.querySelectorAll('[role="group"]')).find(
    (group) =>
      group.querySelector('[data-testid="like"], [data-testid="unlike"]')
  );
  if (!bar || bar.querySelector(`[${BUTTON_ATTRIBUTE}]`)) {
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute(BUTTON_ATTRIBUTE, tweet.id);
  button.style.cssText =
    'margin-left:8px;padding:2px 10px;border-radius:9999px;border:1px solid rgb(113,118,123);background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap;align-self:center;';
  setButtonState(button, savedByHand.has(tweet.id) ? 'saved' : 'idle');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    saveByHand(article, button);
  });
  bar.appendChild(button);
};

const scan = () => {
  scanTimer = undefined;
  if (stopped) {
    return;
  }
  const ownHandle = getOwnHandle(document);
  for (const article of Array.from(document.querySelectorAll(TWEET))) {
    const tweet = parseTweet(article, ownHandle);
    if (!tweet) {
      continue;
    }
    queue.add(tweet);
    addSaveButton(article, tweet);
  }
  scheduleFlush();
};

const observer = new MutationObserver((mutations) => {
  // the save buttons we add are not a reason to read the page again
  const ours = mutations.every(
    (mutation) =>
      Array.from(mutation.addedNodes).every(
        (node) => node instanceof Element && node.hasAttribute(BUTTON_ATTRIBUTE)
      ) &&
      mutation.type === 'childList' &&
      mutation.addedNodes.length > 0
  );
  if (ours || scanTimer || stopped) {
    return;
  }
  scanTimer = setTimeout(scan, SCAN_DELAY);
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});
scan();

// --- X scheduler: the background asks this tab to schedule one post (only
// after the user clicked "Sync" in the extension) ---

const OVERLAY_ID = 'postiz-x-scheduler';
let stopRequested = false;

const showOverlay = (text: string) => {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.cssText =
      'position:fixed;z-index:2147483647;bottom:16px;right:16px;max-width:320px;padding:12px 14px;border-radius:12px;background:#612BD3;color:#fff;font:14px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.3);display:flex;gap:12px;align-items:center;';
    const label = document.createElement('span');
    label.dataset.role = 'label';
    const stopButton = document.createElement('button');
    stopButton.type = 'button';
    stopButton.textContent = 'Stop';
    stopButton.style.cssText =
      'padding:4px 12px;border-radius:9999px;border:1px solid #fff;background:transparent;color:#fff;cursor:pointer;font:inherit;';
    stopButton.addEventListener('click', () => {
      stopRequested = true;
      chrome.runtime.sendMessage({ type: 'X_NATIVE_STOP' }).catch(() => {});
      (
        overlay!.querySelector('[data-role="label"]') as HTMLElement
      ).textContent = 'Stopping…';
    });
    overlay.append(label, stopButton);
    document.body.appendChild(overlay);
  }
  (overlay.querySelector('[data-role="label"]') as HTMLElement).textContent =
    text;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id === chrome.runtime.id && message?.type === 'X_WHO_AM_I') {
    sendResponse(getOwnHandle(document));
    return false;
  }
  if (sender.id !== chrome.runtime.id || message?.type !== 'X_NATIVE_RUN_ONE') {
    return false;
  }
  const { item, dryRun, index, total, wrongAccount } = message as {
    item: NativeItem;
    dryRun: boolean;
    index: number;
    total: number;
    wrongAccount?: string;
  };
  const note = wrongAccount ? ` · ${wrongAccount}` : '';
  stopRequested = false;
  showOverlay(
    `Postiz${dryRun ? ' (dry run)' : ''}: scheduling ${
      index + 1
    } of ${total} in X…${note}`
  );
  scheduleOne(document, item, {
    dryRun,
    shouldStop: () => stopRequested,
  })
    .then((result) => {
      showOverlay(
        (result.ok
          ? result.dryRun
            ? `Dry run ${index + 1} of ${total}: ready, not scheduled`
            : `Scheduled ${index + 1} of ${total} in X`
          : `Not scheduled: ${result.error}`) + note
      );
      sendResponse(result);
    })
    .catch((err) =>
      sendResponse({ ok: false, error: (err as Error).message || 'Failed' })
    );
  return true;
});
