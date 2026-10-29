// Simplified markup of tiktok.com (For You feed item, video page, profile
// grid, nav), written from what TikTok used in 2026 (data-e2e attributes).
// NOT verified against the live site: update it with the parser when TikTok
// changes.

export const ttNav = (handle = 'sigma_trader') => `
<div data-e2e="nav">
  <a href="/foryou" data-e2e="nav-foryou">For You</a>
  <a href="/@${handle}" data-e2e="nav-profile">Profile</a>
</div>`;

export const ttFeedItem = (
  options: {
    handle?: string;
    id?: string;
    ad?: boolean;
    photo?: boolean;
  } = {}
) => {
  const handle = options.handle || 'fx_daily';
  const id = options.id || '7431234567890123456';
  return `
<article data-e2e="recommend-list-item-container">
  <div>
    <a href="/@${handle}/${
    options.photo ? 'photo' : 'video'
  }/${id}"><video src="blob:t"></video></a>
    <div>
      <a href="/@${handle}"><h3 data-e2e="video-author-uniqueid">${handle}</h3>
      <h4 data-e2e="video-author-nickname">FX Daily</h4></a>
      <div data-e2e="video-desc"><span>Gold breakout setup </span><a href="/tag/forex"><strong>#forex</strong></a></div>
      ${options.ad ? '<div data-e2e="ad-tag">Sponsored</div>' : ''}
    </div>
  </div>
  <section class="css-ActionBar">
    <button><span data-e2e="like-icon"></span><strong data-e2e="like-count">12.3K</strong></button>
    <button><span data-e2e="comment-icon"></span><strong data-e2e="comment-count">456</strong></button>
    <button><span data-e2e="undefined-icon"></span><strong data-e2e="undefined-count">1.1M</strong></button>
    <button><span data-e2e="share-icon"></span><strong data-e2e="share-count">789</strong></button>
  </section>
</article>`;
};

export const ttVideoPage = (handle = 'fx_daily') => `
<div data-e2e="browse-video">
  <video src="blob:v"></video>
  <span data-e2e="browse-username">${handle}</span>
  <span data-e2e="browser-nickname">FX Daily</span>
  <h1 data-e2e="browse-video-desc">Risk management in 30 seconds</h1>
  <button><span data-e2e="browse-like-icon"></span><strong data-e2e="browse-like-count">2,345</strong></button>
  <strong data-e2e="browse-comment-count">67</strong>
  <strong data-e2e="browse-favorite-count">890</strong>
  <strong data-e2e="share-count">12</strong>
</div>`;

export const ttProfileGrid = (handle = 'fx_daily') => `
<div data-e2e="user-post-item-list">
  <div data-e2e="user-post-item">
    <a href="https://www.tiktok.com/@${handle}/video/7431234567890000001"><strong data-e2e="video-views">1.2M</strong></a>
  </div>
  <div data-e2e="user-post-item">
    <a href="https://www.tiktok.com/@${handle}/video/7431234567890000002"><strong data-e2e="video-views">980</strong></a>
  </div>
</div>`;
