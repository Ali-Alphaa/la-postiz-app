// The post shape BrightBean Studio takes on
// POST /api/v1/growth/inspiration/capture (Instagram and TikTok)

export type BBPlatform = 'instagram' | 'tiktok';
export type BBMediaType = 'image' | 'video' | 'carousel';

export interface BBItem {
  id: string;
  url: string;
  authorHandle: string;
  authorName: string | null;
  text: string;
  // null when the page doesn't show the count
  likes: number | null;
  comments: number | null;
  shares: number | null;
  views: number | null;
  saves: number | null;
  mediaType: BBMediaType;
  postedAt: string | null;
  own: boolean;
  manual: boolean;
}

export const BB_MAX_ITEMS = 100;
