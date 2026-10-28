import { ExtensionRequest, GetCookiesResponse, ProviderInfo, StoredRefreshEntry } from './types/messages';
import { getAllProviders, getProvider } from './providers/provider.registry';
import { CookieProvider } from './providers/cookie-provider.interface';
import { XInternalRequest } from './types/messages';
import { getSettings, publicApiUrl, XSettings } from './x/settings';
import { badgeFor } from './x/badge';
import {
  COMPOSE_URL,
  NativeItem,
  NativeResult,
  splitByAccount,
  wrongAccountMessage,
} from './x/native.scheduler';

const EXTENSION_VERSION = '2.0.0';
const REFRESH_ALARM_NAME = 'cookie-refresh';
const STORAGE_KEY = 'refreshEntries';

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/([a-z0-9-]+\.)*postiz\.com$/,
];

function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

async function extractCookies(provider: CookieProvider): Promise<GetCookiesResponse> {
  const allCookies = await chrome.cookies.getAll({ url: provider.url });

  const extracted: Record<string, string> = {};
  const missingRequired: string[] = [];

  for (const def of provider.cookies) {
    const found = allCookies.find((c) => c.name === def.name);
    if (found) {
      extracted[def.name] = found.value;
    } else if (def.required) {
      missingRequired.push(def.name);
    }
  }

  if (missingRequired.length > 0) {
    return {
      success: false,
      provider: provider.identifier,
      error: `Missing required cookies: ${missingRequired.join(', ')}. User may need to log in to ${provider.name}.`,
      missingCookies: missingRequired,
    };
  }

  return {
    success: true,
    provider: provider.identifier,
    cookies: extracted,
  };
}

// --- Refresh Token Storage Helpers ---

async function getStoredEntries(): Promise<Record<string, StoredRefreshEntry>> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || {};
}

async function setStoredEntries(entries: Record<string, StoredRefreshEntry>): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: entries });
}

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(REFRESH_ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(REFRESH_ALARM_NAME, { periodInMinutes: 1440 });
  }
}

async function clearAlarmIfEmpty(): Promise<void> {
  const entries = await getStoredEntries();
  if (Object.keys(entries).length === 0) {
    await chrome.alarms.clear(REFRESH_ALARM_NAME);
  }
}

// --- Background Cookie Refresh ---

async function refreshAllCookies(): Promise<void> {
  const entries = await getStoredEntries();
  for (const [integrationId, entry] of Object.entries(entries)) {
    try {
      const provider = getProvider(entry.provider);
      if (!provider) continue;

      const cookieResult = await extractCookies(provider);
      if (!cookieResult.success) continue;

      const base64Cookies = btoa(JSON.stringify(cookieResult.cookies));

      await fetch(`${entry.backendUrl}/integrations/extension-refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jwt: entry.jwt, cookies: base64Cookies }),
      });
    } catch {
      // Silently skip — will retry next cycle
    }
  }
}

// --- Alarm Listener ---

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM_NAME) {
    refreshAllCookies();
  }
});

// --- Ensure alarm on startup ---

(async () => {
  const entries = await getStoredEntries();
  if (Object.keys(entries).length > 0) {
    await ensureAlarm();
  }
})();

// --- Message Listener ---

chrome.runtime.onMessageExternal.addListener(
  (
    message: ExtensionRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    const origin = sender.origin ?? sender.url;
    if (!isOriginAllowed(origin)) {
      sendResponse({ error: 'Unauthorized origin' });
      return true;
    }

    switch (message.type) {
      case 'PING': {
        sendResponse({ status: 'ok', version: EXTENSION_VERSION });
        break;
      }

      case 'GET_PROVIDERS': {
        const providers = getAllProviders();
        const providerInfos: ProviderInfo[] = providers.map((p) => ({
          identifier: p.identifier,
          name: p.name,
          url: p.url,
          cookieNames: p.cookies.map((c) => c.name),
        }));
        sendResponse({ providers: providerInfos });
        break;
      }

      case 'GET_COOKIES': {
        const provider = getProvider(message.provider);
        if (!provider) {
          sendResponse({
            success: false,
            provider: message.provider,
            error: `Unknown provider: ${message.provider}`,
          });
          break;
        }

        extractCookies(provider)
          .then((result) => sendResponse(result))
          .catch((err) =>
            sendResponse({
              success: false,
              provider: message.provider,
              error: `Failed to extract cookies: ${err.message}`,
            })
          );

        return true;
      }

      case 'STORE_REFRESH_TOKEN': {
        (async () => {
          const entries = await getStoredEntries();
          entries[message.integrationId] = {
            jwt: message.jwt,
            backendUrl: message.backendUrl,
            provider: message.provider,
          };
          await setStoredEntries(entries);
          await ensureAlarm();
          sendResponse({ success: true });
        })().catch(() => sendResponse({ success: false }));

        return true;
      }

      case 'REMOVE_REFRESH_TOKEN': {
        (async () => {
          const entries = await getStoredEntries();
          delete entries[message.integrationId];
          await setStoredEntries(entries);
          await clearAlarmIfEmpty();
          sendResponse({ success: true });
        })().catch(() => sendResponse({ success: false }));

        return true;
      }

      default: {
        sendResponse({ error: `Unknown message type: ${(message as any).type}` });
        break;
      }
    }

    return true;
  }
);

// --- X library: the content script of x.com sends the tweets it read, the
// API key stays here ---

const BADGE_KEY = 'xBadge';

const localDay = () => new Date().toLocaleDateString('en-CA');

const PENDING_KEY = 'xNativePending';

// pending posts for X's scheduler first (orange), else the tweets saved today
async function renderBadge() {
  const stored = await chrome.storage.local.get([BADGE_KEY, PENDING_KEY]);
  const saved = stored[BADGE_KEY];
  const badge = badgeFor({
    pending: stored[PENDING_KEY]?.count || 0,
    savedToday: saved?.day === localDay() ? saved.count || 0 : 0,
  });
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  await chrome.action.setBadgeText({ text: badge.text });
}

async function setBadge(count: number) {
  await chrome.storage.local.set({ [BADGE_KEY]: { day: localDay(), count } });
  await renderBadge();
}

async function setPending(count: number) {
  await chrome.storage.local.set({ [PENDING_KEY]: { count, at: Date.now() } });
  await renderBadge();
}

// the badge counts the tweets saved today: it is cleared on a new day
async function restoreBadge() {
  await renderBadge();
}

async function callPostiz(
  settings: XSettings,
  path: string,
  init: RequestInit = {}
) {
  if (!settings.apiKey) {
    return { ok: false, error: 'Add your Postiz API key in the extension options' };
  }

  let url: string;
  try {
    url = `${publicApiUrl(settings.baseUrl)}${path}`;
  } catch {
    return { ok: false, error: 'The Postiz URL is not valid' };
  }

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: settings.apiKey,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = Array.isArray(body?.message)
        ? body.message[0]
        : body?.message || body?.msg;
      return { ok: false, error: message || `Postiz answered ${response.status}` };
    }
    return { ok: true, ...body };
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach Postiz: ${(err as Error).message}`,
    };
  }
}

async function sendTweets(message: Extract<XInternalRequest, { type: 'X_CAPTURE' | 'X_SAVE' }>) {
  const result = await callPostiz(await getSettings(), '/x/capture', {
    method: 'POST',
    body: JSON.stringify({
      ownHandle: message.ownHandle,
      utcOffset: message.utcOffset,
      tweets: message.tweets,
    }),
  });
  if (result.ok && typeof result.savedToday === 'number') {
    await setBadge(result.savedToday);
  }
  return result;
}

chrome.runtime.onMessage.addListener(
  (
    message: XInternalRequest,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    if (sender.id !== chrome.runtime.id) {
      return false;
    }

    switch (message?.type) {
      case 'X_CAPTURE':
      case 'X_SAVE': {
        sendTweets(message).then(sendResponse);
        return true;
      }
      case 'X_TEST_CONNECTION': {
        callPostiz(message.settings, '/is-connected').then(sendResponse);
        return true;
      }
      case 'X_NATIVE_STATUS': {
        refreshPending().then(sendResponse);
        return true;
      }
      case 'X_NATIVE_SYNC': {
        sendResponse(startNativeSync(!!message.dryRun));
        return false;
      }
      case 'X_NATIVE_STOP': {
        if (nativeRun) {
          nativeRun.stop = true;
        }
        sendResponse({ ok: true });
        return false;
      }
      default:
        return false;
    }
  }
);

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

// --- X scheduler: on the user's click, put the queued posts into X's own
// scheduler (X Premium), one composer at a time in an x.com tab ---

const RUN_KEY = 'xNativeRun';
const MAX_ITEMS = 25;
const NATIVE_ALARM = 'x-native-refresh';
let nativeRun: { stop: boolean } | null = null;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function refreshPending() {
  const settings = await getSettings();
  const result = await callPostiz(settings, '/x/native/queue?days=14');
  if (result.ok && typeof result.pending === 'number') {
    await setPending(result.pending);
  }
  return result;
}

async function setRunState(state: Record<string, unknown>) {
  await chrome.storage.local.set({ [RUN_KEY]: { ...state, at: Date.now() } });
}

// resolves once the tab finished loading (or after 30s)
function waitForTab(tabId: number) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, 30000);
    function done() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }
    function listener(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === 'complete') {
        done();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// The content script may need a moment after the page loaded: a message
// that never reached it is sent again. A message that reached it but got no
// answer (the page navigated away) is NOT sent again: the post may already
// be in X's scheduler, its claim stays open for the user to check.
async function runInTab(
  tabId: number,
  message: Record<string, unknown>
): Promise<NativeResult & { unknown?: boolean }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, message);
      return result || { ok: false, unknown: true, error: 'No answer from x.com' };
    } catch (err) {
      if (!/receiving end does not exist/i.test((err as Error)?.message || '')) {
        return { ok: false, unknown: true, error: 'No answer from x.com' };
      }
      await pause(1500);
    }
  }
  return { ok: false, error: 'The x.com tab did not answer' };
}

// the handle signed in on x.com, read by the content script of the tab
async function whoAmI(tabId: number): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: 'X_WHO_AM_I' })) || null;
    } catch {
      await pause(1500);
    }
  }
  return null;
}

async function nativeSync(dryRun: boolean) {
  const settings = await getSettings();
  const queue = await callPostiz(settings, '/x/native/queue?days=14');
  if (!queue.ok) {
    await setRunState({ running: false, error: queue.error });
    return;
  }

  const [existing] = await chrome.tabs.query({ url: ['https://x.com/*'] });
  const tab = existing
    ? await chrome.tabs.update(existing.id!, { active: true })
    : await chrome.tabs.create({ url: 'https://x.com/home', active: true });
  if (!existing || existing.status !== 'complete') {
    await waitForTab(tab!.id!);
  }

  // only the posts of the account signed in on x.com; the others wait
  const loggedIn = await whoAmI(tab!.id!);
  const split = splitByAccount(queue.items || [], loggedIn);
  const wrongAccount = wrongAccountMessage(split.skipped, split.handles);
  const items: NativeItem[] = split.run.slice(0, MAX_ITEMS);
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let unknown = 0;
  await setRunState({
    running: true,
    dryRun,
    done: 0,
    total: items.length,
    synced,
    failed,
    wrongAccount,
  });

  for (const [index, item] of items.entries()) {
    if (nativeRun?.stop) {
      break;
    }
    // a real sync takes the post first, so it can never be scheduled twice;
    // a dry run touches nothing
    if (!dryRun) {
      const claim = await callPostiz(settings, `/x/native/${item.id}/claim`, {
        method: 'POST',
      });
      if (!claim.ok) {
        skipped++;
        continue;
      }
    }

    await chrome.tabs.update(tab!.id!, { url: COMPOSE_URL });
    await waitForTab(tab!.id!);
    await pause(2000);

    const result = await runInTab(tab!.id!, {
      type: 'X_NATIVE_RUN_ONE',
      item,
      dryRun,
      index,
      total: items.length,
      wrongAccount,
    });
    if (result.ok) {
      synced++;
    } else if (result.unknown) {
      unknown++;
    } else {
      failed++;
    }
    // a dry run changes nothing anywhere; an unknown outcome keeps its claim
    if (!dryRun && !result.unknown) {
      await callPostiz(settings, `/x/native/${item.id}/result`, {
        method: 'POST',
        body: JSON.stringify({
          ok: result.ok,
          error:
            result.error === 'Stopped'
              ? 'Stopped before scheduling'
              : result.error,
        }),
      });
    }
    await setRunState({
      running: true,
      dryRun,
      done: index + 1,
      total: items.length,
      synced,
      failed,
      last: result.ok ? '' : result.error,
      wrongAccount,
    });

    if (index < items.length - 1 && !nativeRun?.stop) {
      await pause(3000 + Math.floor(Math.random() * 5000));
    }
  }

  await setRunState({
    running: false,
    dryRun,
    done: synced + failed + unknown + skipped,
    total: items.length,
    synced,
    failed,
    skipped,
    unknown,
    wrongAccount,
    stopped: !!nativeRun?.stop,
  });
  await refreshPending();
}

function startNativeSync(dryRun: boolean) {
  if (nativeRun) {
    return { ok: false, error: 'A sync is already running' };
  }
  nativeRun = { stop: false };
  nativeSync(dryRun)
    .catch((err) => setRunState({ running: false, error: (err as Error).message }))
    .finally(() => {
      nativeRun = null;
    });
  return { ok: true };
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === NATIVE_ALARM) {
    refreshPending().catch(() => {});
  }
});
chrome.alarms.get(NATIVE_ALARM).then((alarm) => {
  if (!alarm) {
    chrome.alarms.create(NATIVE_ALARM, { periodInMinutes: 30 });
  }
});

restoreBadge().catch(() => {});
refreshPending().catch(() => {});
