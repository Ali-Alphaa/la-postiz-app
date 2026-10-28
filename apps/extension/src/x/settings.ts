// The Postiz connection of the X features, kept in chrome.storage.local.
// Only the extension pages and the service worker read it, never x.com.

export const DEFAULT_BASE_URL = 'https://postiz.thesigmatrader.com';
const SETTINGS_KEY = 'xSettings';

export interface XSettings {
  baseUrl: string;
  apiKey: string;
}

export const getSettings = async (): Promise<XSettings> => {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY];
  return {
    baseUrl: stored?.baseUrl || DEFAULT_BASE_URL,
    apiKey: stored?.apiKey || '',
  };
};

export const saveSettings = (settings: XSettings) =>
  chrome.storage.local.set({ [SETTINGS_KEY]: settings });

// Self-hosted Postiz serves the backend under /api of the same domain
// (https://postiz.example.com/api/public/v1). A backend URL can be entered
// as well: https://api.postiz.com or https://postiz.example.com/api
export const publicApiUrl = (baseUrl: string) => {
  const url = new URL(baseUrl.trim());
  const path = url.pathname.replace(/\/+$/, '');
  const backend =
    path.endsWith('/api') || url.hostname.startsWith('api.')
      ? `${url.origin}${path}`
      : `${url.origin}${path}/api`;
  return `${backend}/public/v1`;
};

// the pattern for chrome.permissions of the Postiz domain
export const originPattern = (baseUrl: string) => `${new URL(baseUrl).origin}/*`;
