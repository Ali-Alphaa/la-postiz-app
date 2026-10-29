// ---- Request Types ----

export interface PingRequest {
  type: 'PING';
}

export interface GetProvidersRequest {
  type: 'GET_PROVIDERS';
}

export interface GetCookiesRequest {
  type: 'GET_COOKIES';
  provider: string;
}

export interface StoreRefreshTokenRequest {
  type: 'STORE_REFRESH_TOKEN';
  provider: string;
  integrationId: string;
  jwt: string;
  backendUrl: string;
}

export interface RemoveRefreshTokenRequest {
  type: 'REMOVE_REFRESH_TOKEN';
  integrationId: string;
}

export type ExtensionRequest =
  | PingRequest
  | GetProvidersRequest
  | GetCookiesRequest
  | StoreRefreshTokenRequest
  | RemoveRefreshTokenRequest;

// ---- Response Types ----

export interface PingResponse {
  status: 'ok';
  version: string;
}

export interface ProviderInfo {
  identifier: string;
  name: string;
  url: string;
  cookieNames: string[];
}

export interface GetProvidersResponse {
  providers: ProviderInfo[];
}

export interface GetCookiesSuccessResponse {
  success: true;
  provider: string;
  cookies: Record<string, string>;
}

export interface GetCookiesErrorResponse {
  success: false;
  provider: string;
  error: string;
  missingCookies?: string[];
}

export type GetCookiesResponse =
  | GetCookiesSuccessResponse
  | GetCookiesErrorResponse;

export interface StoredRefreshEntry {
  jwt: string;
  backendUrl: string;
  provider: string;
}

export interface ErrorResponse {
  error: string;
}

export type ExtensionResponse =
  | PingResponse
  | GetProvidersResponse
  | GetCookiesResponse
  | ErrorResponse;

// ---- Internal messages (x.com content script / options page -> worker) ----

export interface XTweetPayload {
  id: string;
  url: string;
  authorHandle: string;
  authorName?: string;
  text: string;
  likes: number;
  reposts: number;
  replies: number;
  views?: number;
  mediaType: 'photo' | 'video' | 'none';
  postedAt?: string;
  isReply?: boolean;
  isQuote?: boolean;
  own?: boolean;
  manual?: boolean;
}

export type XInternalRequest =
  | {
      type: 'X_CAPTURE' | 'X_SAVE';
      ownHandle?: string;
      utcOffset?: number;
      tweets: XTweetPayload[];
    }
  | {
      type: 'X_TEST_CONNECTION';
      settings: { baseUrl: string; apiKey: string };
    }
  | { type: 'X_NATIVE_STATUS' }
  | { type: 'BB_STATUS'; platform: 'instagram' | 'tiktok' }
  | {
      type: 'BB_CAPTURE' | 'BB_SAVE';
      platform: 'instagram' | 'tiktok';
      ownHandle?: string;
      utcOffset?: number;
      items: import('../bb/types').BBItem[];
    }
  | {
      type: 'BB_TEST_CONNECTION';
      settings: import('../bb/settings').BBSettings;
    }
  | { type: 'X_NATIVE_SYNC'; dryRun: boolean }
  | { type: 'X_NATIVE_STOP' };
