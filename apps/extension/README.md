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

  The extension only reads the pages you open. It never scrolls, clicks,
  follows, likes or posts on X, and it makes no calls to X.
  The toolbar badge shows how many tweets were saved today.

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
