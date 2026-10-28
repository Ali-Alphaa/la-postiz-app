'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface GrowthIntegration {
  id: string;
  name: string;
  identifier: string;
  picture: string;
  disabled: boolean;
  time: { time: number }[];
}

export const useGrowthIntegrations = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return ((await (await fetch('/integrations/list')).json()).integrations ||
      []) as GrowthIntegration[];
  }, []);
  return useSWR('growth-integrations', load);
};

export const useGrowthSettings = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth/settings')).json();
  }, []);
  return useSWR('growth-settings', load);
};

export const useBestTime = (integrationId: string, timezone: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (
      await fetch(
        `/growth/best-time/${integrationId}?timezone=${encodeURIComponent(
          timezone
        )}`
      )
    ).json();
  }, [integrationId, timezone]);
  return useSWR(
    integrationId ? `growth-best-time-${integrationId}-${timezone}` : null,
    load
  );
};

export const useHashtagsHistory = (integrationId?: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (
      await fetch(
        `/growth/hashtags${
          integrationId ? `?integrationId=${integrationId}` : ''
        }`
      )
    ).json();
  }, [integrationId]);
  return useSWR(`growth-hashtags-${integrationId || 'all'}`, load);
};

export const useRecycle = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth/recycle')).json();
  }, []);
  return useSWR('growth-recycle', load);
};

export const useExperiments = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth/experiments')).json();
  }, []);
  return useSWR('growth-experiments', load);
};

export const useCompetitorProviders = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth/competitors/providers')).json();
  }, []);
  return useSWR('growth-competitor-providers', load);
};

export const useCompetitors = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth/competitors')).json();
  }, []);
  return useSWR('growth-competitors', load);
};

export const useInspiration = (provider: string) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (
      await fetch(
        `/growth/inspiration${provider ? `?provider=${provider}` : ''}`
      )
    ).json();
  }, [provider]);
  return useSWR(`growth-inspiration-${provider || 'all'}`, load);
};

export interface XLibraryFilters {
  page: number;
  search: string;
  topic: string;
  hookType: string;
  format: string;
  niche: 'on' | 'off' | 'all';
  source: '' | 'auto' | 'manual';
  minRatio: string;
  sort: 'ratio' | 'likes' | 'recent';
}

export const useXStatus = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth/x/status')).json();
  }, []);
  return useSWR('growth-x-status', load);
};

export const useXLibrary = (filters: XLibraryFilters) => {
  const fetch = useFetch();
  const query = new URLSearchParams(
    Object.entries(filters)
      .filter(([, value]) => value !== '' && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  ).toString();
  const load = useCallback(async () => {
    return (await fetch(`/growth/x/library?${query}`)).json();
  }, [query]);
  return useSWR(`growth-x-library-${query}`, load);
};

export const useXVoice = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth/x/voice')).json();
  }, []);
  return useSWR('growth-x-voice', load);
};

// the error message of a failed request, as the backend sends it
export const errorMessage = async (response: Response, fallback: string) => {
  try {
    const body = await response.json();
    return (
      (Array.isArray(body?.message) ? body.message[0] : body?.message) ||
      fallback
    );
  } catch (err) {
    return fallback;
  }
};
