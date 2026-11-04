'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

export interface BrandKit {
  background: string;
  text: string;
  accent: string;
  handle?: string | null;
}

export interface BioLink {
  key?: string;
  title: string;
  url: string;
}

export interface BioPage {
  slug?: string;
  title?: string;
  bio?: string | null;
  avatar?: string | null;
  enabled?: boolean;
  links?: BioLink[];
  clicks?: Record<string, number>;
}

export interface RevenueRow {
  leads: number;
  sales: number;
  value: number;
}

export interface Revenue {
  days: number;
  currencies: string[];
  totals: RevenueRow & { attributed: number };
  sources: Array<RevenueRow & { source: string }>;
  posts: Array<
    RevenueRow & {
      id: string;
      text: string;
      url?: string | null;
      publishDate: string;
      channel?: string;
    }
  >;
}

export interface WeeklyReview {
  id: string;
  weekStart: string;
  summary: string;
}

export interface SwipeInsights {
  posts: number;
  formats: Array<{ format: string; posts: number; averageEngagement: number }>;
}

export const useBrandKit = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth-tools/brand')).json();
  }, []);
  return useSWR<BrandKit>('growth-tools-brand', load);
};

export const useRevenue = (days: number) => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch(`/growth-tools/revenue?days=${days}`)).json();
  }, [days]);
  return useSWR<Revenue>(`growth-tools-revenue-${days}`, load);
};

export const useBioPage = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth-tools/bio')).json();
  }, []);
  return useSWR<BioPage>('growth-tools-bio', load);
};

export const useWeeklyReviews = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/growth-tools/weekly-reviews')).json();
  }, []);
  return useSWR<WeeklyReview[]>('growth-tools-weekly', load);
};

export const useSwipeInsights = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/swipe/insights')).json();
  }, []);
  return useSWR<SwipeInsights>('swipe-insights', load);
};
