# Postiz browser extension

Chrome extension (Manifest V3) with two features:

- **Cookie provider**: lets Postiz connect channels that only work with a
  browser session (Skool).
- **X library**: while you browse x.com, reads the tweets on your screen and
  sends them to your Postiz:
  - tweets with at least 50 likes and at least 3x their author's usual likes
    (learned from the tweets you have seen) are saved to the library;
  - a **Save to Postiz** button in the action bar of every tweet saves it
    whatever its likes;
  - your own tweets (when you open your profile) feed your voice profile.

  - **X scheduler** (X Premium): posts queued in Postiz are put into X's own
    scheduler when you click **Sync to X scheduler** in the extension options;
    X then publishes them even when your computer is off.

  The extension only reads the pages you open. It never scrolls, clicks,
  follows, likes or posts on X, and it makes no calls to X.
  The toolbar badge shows the posts waiting for the X scheduler (orange)
  when there are some, otherwise how many tweets were saved today (purple).

## Build

From the root of the repository:

```bash
pnpm run build:extension
```

The extension is built to `apps/extension/dist` (and zipped to
`apps/extension/extension.zip`). Unit tests of the tweet parser:

```bash
pnpm --filter ./apps/extension run test
```

## Load it in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `apps/extension/dist` folder.
4. After a new build, click the reload icon of the extension card and reload
   the x.com tabs.

## Connect it to Postiz

1. In Postiz, open **Settings → Public API** and copy the API key.
2. Click the Postiz icon in the Chrome toolbar (or **Details → Extension
   options**).
3. Enter your Postiz URL (default `https://postiz.thesigmatrader.com`) and the
   API key, then **Save** and **Test connection**. For another domain Chrome
   asks to allow the extension to reach it.
   The URL is the address of the Postiz app; the backend is expected at
   `<url>/api`. A backend URL (`https://api.example.com` or
   `https://example.com/api`) works as well.
4. Browse x.com. Saved tweets appear in Postiz under **Growth → X
   Inspiration**.

The tweets are sent to `POST <backend>/public/v1/x/capture` with the API key
in the `Authorization` header, at most every ~10 seconds.

## Extension or X fetcher?

Postiz can also collect tweets from the server, without the extension: the
optional **X fetcher** (Growth → X Inspiration → Collect from X) reads the
public tweets of an account, or the results of a search, through x.com's web
API. It is read-only and off by default.

| | Browser extension | X fetcher |
|---|---|---|
| Reads | the tweets on your screen while you browse | an account's recent tweets or a search, on demand |
| Account | your own browser session, nothing is sent to X | none (guest mode) or a **spare** account's cookies |
| Risk | lowest: X sees normal browsing | unofficial access from the server: X may block it or the spare account |
| Setup | load the extension, paste the API key | environment variables on the backend |

Enable the fetcher on the backend:

```bash
X_FETCHER_ENABLED=true
X_FETCHER_MODE=guest            # or cookies
X_FETCHER_AUTH_TOKEN=...        # cookies mode only: auth_token cookie of a SPARE account
X_FETCHER_CT0=...               # cookies mode only: ct0 cookie of the same account
X_FETCHER_DAILY_LIMIT=150       # x.com requests per organization per UTC day
```

Never use the cookies of your main X account. The fetcher spaces its
requests by at least one second, times out after ten seconds, and stops at
the daily limit. Its code is partly adapted from XActions (Apache-2.0), see
`libraries/nestjs-libraries/src/x-fetcher/NOTICE.md`.

## X scheduler (X Premium, free)

Posting through the X API costs money per post. With X Premium, the web
composer of x.com has its own scheduler, and X publishes scheduled posts from
its servers. Postiz keeps a queue of such posts (Growth → X Inspiration →
"Scheduled in X", or "Schedule in X" on a repurposed variation), and the
extension puts them into X's scheduler **only when you click Sync**:

1. Open the extension options (click its icon). The "X scheduler" section
   shows how many posts are waiting.
2. Leave **Dry run** on the first time: the extension opens x.com, fills the
   composer and the schedule dialog of each post, and stops before the last
   click. Nothing is scheduled and nothing is reported to Postiz.
3. Turn Dry run off and click **Sync N posts to X scheduler**. For each post
   (25 at most per run, 3 to 8 seconds apart) the extension opens
   `https://x.com/compose/post`, types the text, opens the schedule dialog,
   picks the date and time (in the time zone of this computer), confirms, and
   clicks the composer button only if it says **Schedule**. If it would say
   "Post" (publish now), the post is skipped and reported as failed. A Stop
   button is shown on x.com while it runs.
4. Before touching a post, the extension claims it in Postiz (status
   "syncing"), so a post can never be scheduled twice; a dry run claims
   nothing. Each result goes back to Postiz (synced or failed). When the
   outcome is unknown (the x.com tab stopped answering after the composer was
   filled), the claim stays open and, after 15 minutes, Postiz shows the post
   as "Needs check": look at X's scheduled posts and click "It's in X" or
   "Retry". A synced post is
   managed in X from then on (x.com → composer → Unsent posts → Scheduled).

Limits: text only (no media, no threads: X does not schedule threads from
the web), up to 280 characters, at least 10 minutes and at most 18 months
ahead; use X in English while syncing (the button label is checked); Chrome
must be open and signed in to X when you click Sync, at least once before
the first post time. The selectors live in `src/x/native.scheduler.ts`: they
were written from X's 2026 markup and not verified against the live site,
so expect to adjust them when X changes its composer.
