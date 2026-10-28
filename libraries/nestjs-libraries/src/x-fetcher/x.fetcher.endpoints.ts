// Portions adapted from XActions (https://github.com/nirholas/XActions),
// Copyright (c) 2024-2026 nich (@nichxbt), Licensed under the Apache License,
// Version 2.0 (src/scrapers/twitter/http/endpoints.js and
// x-endpoints.generated.js). The query ids and feature switch names are
// observations of x.com's own bundles, extracted by
// https://github.com/fa0311/TwitterInternalAPIDocument (MIT, (c) fa0311).
// Modifications: only the 5 read operations Postiz uses are kept, with the
// feature switches and field toggles each of them declares (taken from the
// generated table of XActions, upstream commit 09d3ae0c, 2026-08-27); no
// mutation, REST or account endpoint is included.

export const GRAPHQL_BASE = 'https://x.com/i/api/graphql';
export const GUEST_ACTIVATE_URL = 'https://api.x.com/1.1/guest/activate.json';

// Public bearer token of the x.com web client (the same one every browser
// sends); it identifies the web app, not an account
export const BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export type XOperationName =
  | 'UserByScreenName'
  | 'UserTweets'
  | 'UserTweetsAndReplies'
  | 'TweetResultByRestId'
  | 'SearchTimeline';

const TIMELINE_FEATURES: Record<string, boolean> = {
  articles_preview_enabled: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  content_disclosure_indicator_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  longform_notetweets_rich_text_read_enabled: true,
  post_ctas_fetch_enabled: false,
  premium_content_api_read_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_grok_analysis_button_from_backend: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_grok_annotations_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_profile_redirect_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  rweb_cashtags_composer_attachment_enabled: true,
  rweb_cashtags_enabled: true,
  rweb_tipjar_consumption_enabled: false,
  rweb_video_screen_enabled: false,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  verified_phone_label_enabled: false,
  view_counts_everywhere_api_enabled: true,
};

// TweetResultByRestId declares the timeline switches minus these
const NOT_ON_TWEET = [
  'responsive_web_enhance_cards_enabled',
  'rweb_video_screen_enabled',
];

const TIMELINE_TOGGLES: Record<string, boolean> = {
  withArticlePlainText: false,
  withArticleRichContentState: true,
  withArticleSummaryText: false,
  withArticleVoiceOver: false,
  withAuxiliaryUserLabels: false,
  withDisallowedReplyControls: false,
  withGrokAnalyze: false,
  withPayments: false,
};

export interface XOperation {
  queryId: string;
  features: Record<string, boolean>;
  fieldToggles: Record<string, boolean>;
  // read operations x.com only serves over POST
  method: 'GET' | 'POST';
}

export const OPERATIONS: Record<XOperationName, XOperation> = {
  UserByScreenName: {
    queryId: 'Gb-d6r0vxPOADdG62OEBpQ',
    features: {
      creator_subscriptions_tweet_preview_api_enabled: true,
      hidden_profile_subscriptions_enabled: true,
      highlights_tweets_tab_ui_enabled: true,
      profile_label_improvements_pcf_label_in_post_enabled: true,
      responsive_web_graphql_timeline_navigation_enabled: true,
      responsive_web_profile_redirect_enabled: true,
      responsive_web_twitter_article_notes_tab_enabled: true,
      rweb_tipjar_consumption_enabled: false,
      subscriptions_feature_can_gift_premium: true,
      subscriptions_verification_info_is_identity_verified_enabled: true,
      subscriptions_verification_info_verified_since_enabled: true,
      verified_phone_label_enabled: false,
    },
    fieldToggles: {
      withAuxiliaryUserLabels: false,
      withPayments: false,
    },
    method: 'GET',
  },
  UserTweets: {
    queryId: 'SXVCYB8XHSS25nzIljNtZA',
    features: TIMELINE_FEATURES,
    fieldToggles: TIMELINE_TOGGLES,
    method: 'GET',
  },
  UserTweetsAndReplies: {
    queryId: 'qUpkZU6eN8MbtQb7rC_pYg',
    features: TIMELINE_FEATURES,
    fieldToggles: TIMELINE_TOGGLES,
    method: 'GET',
  },
  TweetResultByRestId: {
    queryId: 'GZsN2Pc4knAoit6pXa4HSA',
    features: Object.fromEntries(
      Object.entries(TIMELINE_FEATURES).filter(
        ([key]) => !NOT_ON_TWEET.includes(key)
      )
    ),
    fieldToggles: TIMELINE_TOGGLES,
    method: 'GET',
  },
  SearchTimeline: {
    queryId: 'hyPfJYJ_XAtDYoslQc-Rgg',
    features: TIMELINE_FEATURES,
    fieldToggles: TIMELINE_TOGGLES,
    method: 'POST',
  },
};

// GET operations carry everything in the query string, POST ones in the body
export const buildGraphQLRequest = (
  name: XOperationName,
  queryId: string,
  variables: Record<string, unknown>
) => {
  const operation = OPERATIONS[name];
  const url = `${GRAPHQL_BASE}/${queryId}/${name}`;
  if (operation.method === 'POST') {
    return {
      method: 'POST' as const,
      url,
      body: JSON.stringify({
        variables,
        features: operation.features,
        fieldToggles: operation.fieldToggles,
        queryId,
      }),
    };
  }

  const params = new URLSearchParams();
  params.set('variables', JSON.stringify(variables));
  params.set('features', JSON.stringify(operation.features));
  params.set('fieldToggles', JSON.stringify(operation.fieldToggles));
  return {
    method: 'GET' as const,
    url: `${url}?${params.toString()}`,
    body: undefined,
  };
};
