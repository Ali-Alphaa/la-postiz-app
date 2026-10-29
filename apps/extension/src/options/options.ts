import {
  DEFAULT_BASE_URL,
  getSettings,
  originPattern,
  publicApiUrl,
  saveSettings,
  XSettings,
} from '../x/settings';
import {
  BBSettings,
  DEFAULT_BB_URL,
  getBBSettings,
  inspirationApiUrl,
  isBBKey,
  saveBBSettings,
} from '../bb/settings';
import { savedTodayByPlatform } from '../x/badge';

const form = document.getElementById('form') as HTMLFormElement;
const baseUrl = document.getElementById('baseUrl') as HTMLInputElement;
const apiKey = document.getElementById('apiKey') as HTMLInputElement;
const test = document.getElementById('test') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLDivElement;

const show = (message: string, kind: 'ok' | 'error' | '' = '') => {
  status.textContent = message;
  status.className = kind;
};

const read = (): XSettings | null => {
  const settings = {
    baseUrl: baseUrl.value.trim().replace(/\/+$/, '') || DEFAULT_BASE_URL,
    apiKey: apiKey.value.trim(),
  };
  try {
    publicApiUrl(settings.baseUrl);
  } catch {
    show('The Postiz URL is not valid', 'error');
    return null;
  }
  return settings;
};

// the service worker can only call the Postiz domain once it is allowed
const allow = (settings: XSettings) =>
  chrome.permissions.request({ origins: [originPattern(settings.baseUrl)] });

const save = async () => {
  const settings = read();
  if (!settings) {
    return null;
  }
  if (!(await allow(settings))) {
    show(
      'Allow the extension to reach your Postiz domain to continue',
      'error'
    );
    return null;
  }
  await saveSettings(settings);
  return settings;
};

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (await save()) {
    show('Saved', 'ok');
  }
});

test.addEventListener('click', async () => {
  const settings = await save();
  if (!settings) {
    return;
  }
  show('Testing…');
  const result = await chrome.runtime.sendMessage({
    type: 'X_TEST_CONNECTION',
    settings,
  });
  show(
    result?.ok ? 'Connected to Postiz' : result?.error || 'Connection failed',
    result?.ok ? 'ok' : 'error'
  );
});

getSettings().then((settings) => {
  baseUrl.value = settings.baseUrl;
  apiKey.value = settings.apiKey;
});

// --- X scheduler ---

const DRY_RUN_KEY = 'xNativeDryRun';
const RUN_KEY = 'xNativeRun';
const pending = document.getElementById('pending') as HTMLDivElement;
const dryRun = document.getElementById('dryRun') as HTMLInputElement;
const sync = document.getElementById('sync') as HTMLButtonElement;
const stop = document.getElementById('stop') as HTMLButtonElement;
const run = document.getElementById('run') as HTMLDivElement;
const wrong = document.getElementById('wrongAccount') as HTMLDivElement;
let pendingCount = 0;

const showPending = (count: number) => {
  pendingCount = count;
  pending.textContent = count
    ? `${count} post${count > 1 ? 's' : ''} waiting for the X scheduler`
    : 'No post waiting for the X scheduler';
  sync.textContent = count
    ? `Sync ${Math.min(count, 25)} post${count > 1 ? 's' : ''} to X scheduler`
    : 'Sync to X scheduler';
};

const showRun = (state: any) => {
  if (!state) {
    run.textContent = '';
    return;
  }
  sync.disabled = !!state.running;
  stop.hidden = !state.running;
  wrong.textContent = state.wrongAccount || '';
  if (state.error) {
    run.textContent = state.error;
    run.className = 'error';
    return;
  }
  const prefix = state.dryRun ? 'Dry run: ' : '';
  run.className = state.running ? '' : state.failed ? 'error' : 'ok';
  run.textContent = state.running
    ? `${prefix}${state.done} of ${state.total} done…${
        state.last ? ` Last error: ${state.last}` : ''
      }`
    : `${prefix}${state.synced} ${state.dryRun ? 'ready' : 'scheduled in X'}, ${
        state.failed
      } failed${state.unknown ? `, ${state.unknown} to check in Postiz` : ''}${
        state.skipped ? `, ${state.skipped} skipped` : ''
      }${state.stopped ? ' (stopped)' : ''}`;
};

// the very first run is a dry run; the choice is kept afterwards
chrome.storage.local.get([DRY_RUN_KEY, RUN_KEY]).then((stored) => {
  dryRun.checked = stored[DRY_RUN_KEY] ?? true;
  showRun(stored[RUN_KEY]);
});
dryRun.addEventListener('change', () =>
  chrome.storage.local.set({ [DRY_RUN_KEY]: dryRun.checked })
);

chrome.storage.onChanged.addListener((changes) => {
  if (changes[RUN_KEY]) {
    showRun(changes[RUN_KEY].newValue);
  }
  if (changes.xNativePending) {
    showPending(changes.xNativePending.newValue?.count || 0);
  }
});

chrome.runtime.sendMessage({ type: 'X_NATIVE_STATUS' }).then((result) => {
  if (result?.ok) {
    showPending(result.pending || 0);
  } else {
    pending.textContent = result?.error || 'Could not reach Postiz';
  }
});

sync.addEventListener('click', async () => {
  if (!pendingCount) {
    run.textContent = 'Nothing to sync';
    return;
  }
  await chrome.storage.local.set({ [DRY_RUN_KEY]: dryRun.checked });
  const result = await chrome.runtime.sendMessage({
    type: 'X_NATIVE_SYNC',
    dryRun: dryRun.checked,
  });
  if (!result?.ok) {
    run.textContent = result?.error || 'Could not start';
    run.className = 'error';
  }
});

stop.addEventListener('click', () =>
  chrome.runtime.sendMessage({ type: 'X_NATIVE_STOP' })
);

// --- BrightBean (Instagram & TikTok) ---

const bbForm = document.getElementById('bbForm') as HTMLFormElement;
const bbBaseUrl = document.getElementById('bbBaseUrl') as HTMLInputElement;
const bbApiKey = document.getElementById('bbApiKey') as HTMLInputElement;
const bbInstagram = document.getElementById('bbInstagram') as HTMLInputElement;
const bbTiktok = document.getElementById('bbTiktok') as HTMLInputElement;
const bbTest = document.getElementById('bbTest') as HTMLButtonElement;
const bbStatus = document.getElementById('bbStatus') as HTMLDivElement;
const savedToday = document.getElementById('savedToday') as HTMLDivElement;

const showBB = (message: string, kind: 'ok' | 'error' | '' = '') => {
  bbStatus.textContent = message;
  bbStatus.className = kind;
};

const readBB = (): BBSettings | null => {
  const settings = {
    baseUrl: bbBaseUrl.value.trim().replace(/\/+$/, '') || DEFAULT_BB_URL,
    apiKey: bbApiKey.value.trim(),
    instagram: bbInstagram.checked,
    tiktok: bbTiktok.checked,
  };
  try {
    inspirationApiUrl(settings.baseUrl);
  } catch {
    showBB('The BrightBean URL is not valid', 'error');
    return null;
  }
  if (settings.apiKey && !isBBKey(settings.apiKey)) {
    showBB('A BrightBean API key starts with bb_studio_', 'error');
    return null;
  }
  return settings;
};

const saveBB = async () => {
  const settings = readBB();
  if (!settings) {
    return null;
  }
  // the service worker can only call the BrightBean domain once allowed
  if (
    !(await chrome.permissions.request({
      origins: [originPattern(settings.baseUrl)],
    }))
  ) {
    showBB(
      'Allow the extension to reach your BrightBean domain to continue',
      'error'
    );
    return null;
  }
  await saveBBSettings(settings);
  return settings;
};

bbForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (await saveBB()) {
    showBB('Saved. Reload the Instagram and TikTok tabs.', 'ok');
  }
});

bbTest.addEventListener('click', async () => {
  const settings = await saveBB();
  if (!settings) {
    return;
  }
  showBB('Testing…');
  const result = await chrome.runtime.sendMessage({
    type: 'BB_TEST_CONNECTION',
    settings,
  });
  showBB(
    result?.ok
      ? `Connected to BrightBean${
          result.workspace ? ` (${result.workspace})` : ''
        }`
      : result?.error || 'Connection failed',
    result?.ok ? 'ok' : 'error'
  );
});

getBBSettings().then((settings) => {
  bbBaseUrl.value = settings.baseUrl;
  bbApiKey.value = settings.apiKey;
  bbInstagram.checked = settings.instagram;
  bbTiktok.checked = settings.tiktok;
});

// saved today per platform, as the badge counts them
const showSavedToday = async () => {
  const stored = await chrome.storage.local.get(['xBadge', 'bbBadge']);
  const counts = savedTodayByPlatform(
    { x: stored.xBadge, ...(stored.bbBadge || {}) },
    new Date().toLocaleDateString('en-CA')
  );
  savedToday.textContent = `X ${counts.x} · Instagram ${counts.instagram} · TikTok ${counts.tiktok}`;
};
showSavedToday();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.xBadge || changes.bbBadge) {
    showSavedToday();
  }
});
