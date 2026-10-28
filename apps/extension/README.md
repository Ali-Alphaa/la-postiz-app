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
