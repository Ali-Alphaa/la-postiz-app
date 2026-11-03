'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface SwipeEntry {
  id: string;
  status: 'LIBRARY' | 'INBOX';
  origin: 'NOTION' | 'AI' | 'LINK' | 'MANUAL';
  platform: string;
  content: string;
  author?: string | null;
  sourceUrl?: string | null;
  formatTag?: string | null;
  topicTags: string[];
  whyItWorks?: string | null;
  collection?: string | null;
  starred: boolean;
  lastRepurposedAt?: string | null;
}

export interface SwipeTechnique {
  key: string;
  label: string;
  hint: string;
}

export interface SwipeRun {
  id: string;
  topic: string;
  searches: number;
  found: number;
  inputTokens: number;
  outputTokens: number;
  createdAt: string;
}

export const useSwipeEntries = (
  status: 'LIBRARY' | 'INBOX',
  filters: {
    q?: string;
    formatTag?: string;
    collection?: string;
    starred?: boolean;
  }
) => {
  const fetch = useFetch();
  const params = new URLSearchParams({
    status,
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.formatTag ? { formatTag: filters.formatTag } : {}),
    ...(filters.collection ? { collection: filters.collection } : {}),
    ...(filters.starred ? { starred: 'true' } : {}),
  }).toString();
  const load = useCallback(async () => {
    return (await fetch(`/swipe?${params}`)).json();
  }, [params]);

  return useSWR<SwipeEntry[]>(`swipe-entries-${params}`, load);
};

export const useSwipeTechniques = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/swipe/techniques')).json();
  }, []);

  return useSWR<SwipeTechnique[]>('swipe-techniques', load);
};

export const useSwipeRuns = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/swipe/runs')).json();
  }, []);

  return useSWR<SwipeRun[]>('swipe-runs', load);
};
