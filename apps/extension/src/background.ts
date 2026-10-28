import { ExtensionRequest, GetCookiesResponse, ProviderInfo, StoredRefreshEntry } from './types/messages';
import { getAllProviders, getProvider } from './providers/provider.registry';
import { CookieProvider } from './providers/cookie-provider.interface';
import { XInternalRequest } from './types/messages';
import { getSettings, publicApiUrl, XSettings } from './x/settings';

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

async function setBadge(count: number) {
  await chrome.storage.local.set({ [BADGE_KEY]: { day: localDay(), count } });
  await chrome.action.setBadgeBackgroundColor({ color: '#612BD3' });
  await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
}

// the badge counts the tweets saved today: it is cleared on a new day
async function restoreBadge() {
  const stored = (await chrome.storage.local.get(BADGE_KEY))[BADGE_KEY];
  await chrome.action.setBadgeText({
    text: stored?.day === localDay() && stored.count > 0 ? String(stored.count) : '',
  });
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
      default:
        return false;
    }
  }
);

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});

restoreBadge().catch(() => {});
