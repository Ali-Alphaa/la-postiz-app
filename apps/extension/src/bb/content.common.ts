// What the Instagram and TikTok content scripts share: read the posts on the
// screen (MutationObserver, no scrolling, clicking or network call to the
// platform), send them in batches to the service worker, which holds the
// BrightBean key, and the "Save to BrightBean" button.
import { CaptureQueue } from '../x/capture.queue';
import type { BBItem, BBPlatform } from './types';

const BUTTON_ATTRIBUTE = 'data-brightbean-save';
const SCAN_DELAY = 800;

export interface FoundPost {
  item: BBItem;
  container: Element;
  // where the save button goes; null: no button
  bar: Element | null;
}

export interface PlatformReader {
  platform: BBPlatform;
  find: (doc: Document) => FoundPost[];
  ownHandle: (doc: Document) => string | null;
}

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
      ? 'Retry'
      : 'Save to BrightBean';
  button.title =
    state === 'error'
      ? 'Could not save: check the BrightBean settings of the extension'
      : 'Save this post to your BrightBean inspiration library';
};

export const startCapture = async (reader: PlatformReader) => {
  // nothing is read until the platform is switched on with a key
  let status: { enabled?: boolean } | undefined;
  try {
    status = await chrome.runtime.sendMessage({
      type: 'BB_STATUS',
      platform: reader.platform,
    });
  } catch (err) {
    return;
  }
  if (!status?.enabled) {
    return;
  }

  const queue = new CaptureQueue<BBItem>();
  const savedByHand = new Set<string>();
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const send = async (type: 'BB_CAPTURE' | 'BB_SAVE', items: BBItem[]) => {
    try {
      return await chrome.runtime.sendMessage({
        type,
        platform: reader.platform,
        ownHandle: reader.ownHandle(document) || undefined,
        utcOffset: new Date().getTimezoneOffset(),
        items,
      });
    } catch (err) {
      // the extension was reloaded or removed
      if (!chrome.runtime?.id) {
        stopped = true;
        observer.disconnect();
      }
      return { ok: false };
    }
  };

  const scheduleFlush = () => {
    if (stopped || flushTimer || !queue.size) {
      return;
    }
    flushTimer = setTimeout(flush, queue.delay(Date.now()));
  };

  const flush = async () => {
    flushTimer = undefined;
    const batch = queue.take(Date.now());
    if (batch.length) {
      await send('BB_CAPTURE', batch);
    }
    scheduleFlush();
  };

  const addButton = (post: FoundPost) => {
    if (!post.bar || post.bar.querySelector(`[${BUTTON_ATTRIBUTE}]`)) {
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute(BUTTON_ATTRIBUTE, post.item.id);
    button.style.cssText =
      'margin:4px;padding:2px 10px;border-radius:9999px;border:1px solid rgb(142,142,142);background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;align-self:center;';
    setButtonState(button, savedByHand.has(post.item.id) ? 'saved' : 'idle');
    button.addEventListener('click', async (event) => {
      // only on the user's click
      event.preventDefault();
      event.stopPropagation();
      const fresh =
        reader.find(document).find((p) => p.item.id === post.item.id)?.item ||
        post.item;
      setButtonState(button, 'saving');
      const response = await send('BB_SAVE', [{ ...fresh, manual: true }]);
      if (response?.ok) {
        savedByHand.add(fresh.id);
        setButtonState(button, 'saved');
      } else {
        setButtonState(button, 'error');
      }
    });
    post.bar.appendChild(button);
  };

  const scan = () => {
    scanTimer = undefined;
    if (stopped) {
      return;
    }
    for (const post of reader.find(document)) {
      queue.add(post.item);
      addButton(post);
    }
    scheduleFlush();
  };

  const observer = new MutationObserver((mutations) => {
    // our own buttons are not a reason to read the page again
    const ours = mutations.every(
      (mutation) =>
        mutation.type === 'childList' &&
        mutation.addedNodes.length > 0 &&
        Array.from(mutation.addedNodes).every(
          (node) =>
            node instanceof Element && node.hasAttribute(BUTTON_ATTRIBUTE)
        )
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
};
