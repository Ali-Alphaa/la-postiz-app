import {
  DEFAULT_BASE_URL,
  getSettings,
  originPattern,
  publicApiUrl,
  saveSettings,
  XSettings,
} from '../x/settings';

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
