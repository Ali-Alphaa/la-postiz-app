// Simplified markup of instagram.com (feed article, post page / modal, nav),
// written from what Instagram used in 2026. NOT verified against the live
// site: update it with the parser when Instagram changes.

export const igNav = (handle = 'sigma_trader') => `
<div role="navigation">
  <a href="/" role="link"><span>Home</span></a>
  <a href="/explore/" role="link"><span>Explore</span></a>
  <a href="/${handle}/" role="link"><img alt="${handle}'s profile picture" src="a.jpg"><span>Profile</span></a>
</div>`;

export const igFeedPost = (
  options: {
    handle?: string;
    code?: string;
    likes?: string;
    likedByOthers?: string;
    comments?: string;
    video?: boolean;
    carousel?: boolean;
    sponsored?: boolean;
    caption?: string;
  } = {}
) => {
  const handle = options.handle || 'chart_guru';
  const code = options.code || 'C9xYz12AbCd';
  return `
<article role="presentation">
  <div>
    <header>
      <a href="/${handle}/" role="link"><img alt="${handle}'s profile picture" src="p.jpg"></a>
      <div>
        <a href="/${handle}/" role="link"><span>${handle}</span></a>
        <span>•</span>
        <a href="/p/${code}/" role="link"><time datetime="2026-10-27T14:00:00.000Z" title="Oct 27, 2026">2h</time></a>
      </div>
      ${options.sponsored ? '<div><span>Sponsored</span></div>' : ''}
    </header>
    <div>
      ${
        options.video
          ? '<video src="blob:x"></video>'
          : '<img alt="Photo by chart_guru" src="i.jpg">'
      }
      ${
        options.carousel
          ? '<ul><li><img src="1.jpg"></li><li><img src="2.jpg"></li></ul><button aria-label="Next"></button>'
          : ''
      }
    </div>
    <section>
      <span><div role="button"><svg aria-label="Like"></svg></div></span>
      <span><div role="button"><svg aria-label="Comment"></svg></div></span>
      <div role="button"><svg aria-label="Share Post"></svg></div>
      <div role="button"><svg aria-label="Save"></svg></div>
    </section>
    <section>
      ${
        options.likes
          ? `<a href="/p/${code}/liked_by/" role="link"><span><span>${options.likes}</span> likes</span></a>`
          : ''
      }
      ${
        options.likedByOthers
          ? `<span>Liked by <a href="/friend/">friend</a> and <a href="/p/${code}/liked_by/"><span>${options.likedByOthers}</span> others</a></span>`
          : ''
      }
    </section>
    <div>
      <span><a href="/${handle}/" role="link">${handle}</a> <span dir="auto">${
    options.caption ?? 'Risk 1% per trade. Cut losers fast, let winners run.'
  }</span></span>
    </div>
    ${
      options.comments
        ? `<a href="/p/${code}/" role="link"><span>View all ${options.comments} comments</span></a>`
        : ''
    }
  </div>
</article>`;
};

// the post page (/p/<code>/): the caption is the h1 of the first comment
export const igPostPage = (handle = 'chart_guru') => `
<main role="main">
  <div role="presentation">
    <article>
      <header><a href="/${handle}/" role="link"><span>${handle}</span></a></header>
      <video src="blob:y"></video>
      <ul>
        <li><a href="/${handle}/">${handle}</a><h1 dir="auto">My reel caption
line two</h1></li>
      </ul>
      <section><span><svg aria-label="Like"></svg></span></section>
      <section><span>12.3K likes</span></section>
      <a href="/reel/DAbCdEfGhIj/"><time datetime="2026-10-20T08:00:00.000Z">Oct 20</time></a>
    </article>
  </div>
</main>`;
