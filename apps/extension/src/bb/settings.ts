// The BrightBean Studio connection (Instagram and TikTok), kept in
// chrome.storage.local apart from the Postiz one (X). Only the extension
// pages and the service worker read it, never instagram.com or tiktok.com.
import type { BBPlatform } from './types';

export const DEFAULT_BB_URL = 'https://social.thesigmatrader.com';
const BB_SETTINGS_KEY = 'bbSettings';

export interface BBSettings {
  baseUrl: string;
  apiKey: string;
  instagram: boolean;
  tiktok: boolean;
}

export const getBBSettings = async (): Promise<BBSettings> => {
  const stored = (await chrome.storage.local.get(BB_SETTINGS_KEY))[
    BB_SETTINGS_KEY
  ];
  return normalizeBBSettings(stored);
};

// both platforms are on unless switched off
export const normalizeBBSettings = (stored: any): BBSettings => ({
  baseUrl: stored?.baseUrl || DEFAULT_BB_URL,
  apiKey: stored?.apiKey || '',
  instagram: stored?.instagram !== false,
  tiktok: stored?.tiktok !== false,
});

export const saveBBSettings = (settings: BBSettings) =>
  chrome.storage.local.set({ [BB_SETTINGS_KEY]: settings });

// capturing a platform needs a key and its toggle
export const isPlatformEnabled = (settings: BBSettings, platform: BBPlatform) =>
  !!settings.apiKey && settings[platform];

export const isBBKey = (key: string) => /^bb_studio_[A-Za-z0-9_-]+$/.test(key);

// https://social.example.com (or with a sub path) -> .../api/v1/growth/inspiration
export const inspirationApiUrl = (baseUrl: string) => {
  const url = new URL(baseUrl.trim());
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}/api/v1/growth/inspiration`;
};
