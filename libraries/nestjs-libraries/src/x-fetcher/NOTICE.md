# Third-party notices: X fetcher

The X fetcher in this folder is an optional, read-only client of x.com's web
GraphQL API. It is off unless `X_FETCHER_ENABLED=true` is set on the server.

## XActions

Portions of this folder are adapted from XActions
(https://github.com/nirholas/XActions),
Copyright (c) 2024-2026 nich (@nichxbt),
Licensed under the Apache License, Version 2.0.

You may obtain a copy of the License at
http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

The Apache License 2.0 is compatible with the GNU Affero General Public
License v3.0 that covers Postiz: the adapted code is distributed here under
AGPL-3.0 as part of Postiz, with this notice and the attribution headers kept.

### What was adapted, and how it was modified

| File here | XActions source | Changes |
|---|---|---|
| `x.fetcher.endpoints.ts` | `src/scrapers/twitter/http/endpoints.js`, `x-endpoints.generated.js` | Only the 5 read operations Postiz uses (UserByScreenName, UserTweets, UserTweetsAndReplies, TweetResultByRestId, SearchTimeline), with the feature switches and field toggles each declares; no mutation, REST or account endpoint |
| `x.fetcher.errors.ts` | `errors.js` | One error with a code and a user-facing message; write-action cases removed |
| `x.fetcher.parser.ts` | `parse/tweet.js`, `paging.js`, `search.js` (buildAdvancedQuery) | TypeScript; output is the Postiz X library tweet shape; long-post text from note_tweet; reposts replaced by the original; query builder limited to keywords + min_faves, with validation |
| `x.fetcher.transaction.ts` | `transactionId.js` (and the manifest parser of `queryIds.js`) | TypeScript; keys kept in memory only (no cache file); live page first, pair dictionary second; all requests through the caller's guarded fetch |
| `x.fetcher.query.ids.ts` | `queryIds.js` | In memory only; no saved session cookies; discovery only after a rejected query id, at most hourly; only our 5 operations |
| `x.fetcher.client.ts` | `client.js`, `guest.js`, `auth.js`, `tweets.js` (scrapeTweets, scrapeTweetsAndReplies, scrapeTweetById, resolveUserId), `search.js` (searchTweets) | One read-only client: GraphQL reads only, a single guest token, cookie auth from two values, no proxy, no HTTP/2, no retry back-off, bounded pages, error codes |
| `__fixtures__/x-home-transaction.html`, `__fixtures__/x-ondemand-s.txt` | `tests/http-scraper/fixtures/` | Copied as test data (captures of x.com) |

`x.fetcher.config.ts` (enablement, daily limit, host allow-list, spacing,
timeouts) and `x.fetcher.spec.ts` are Postiz code.

Nothing that writes to X was ported: no like, follow, repost, reply, post,
delete, DM, schedule, media upload, account pool, login flow or browser
automation.

## x-client-transaction-id (Lami)

The transaction-id algorithm in `x.fetcher.transaction.ts` (key-byte index
extraction, the cubic-bezier animation key and the SHA-256 + XOR payload) is
adapted, through XActions, from x-client-transaction-id
(https://github.com/Lqm1/x-client-transaction-id):

    MIT License. Copyright (c) 2025 Lami

    Permission is hereby granted, free of charge, to any person obtaining a
    copy of this software and associated documentation files (the "Software"),
    to deal in the Software without restriction, including without limitation
    the rights to use, copy, modify, merge, publish, distribute, sublicense,
    and/or sell copies of the Software, and to permit persons to whom the
    Software is furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in
    all copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
    THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
    DEALINGS IN THE SOFTWARE.

## fa0311

- The query ids and feature switch names in `x.fetcher.endpoints.ts` were
  extracted from x.com's bundles by https://github.com/fa0311/TwitterInternalAPIDocument
  (MIT, (c) fa0311), as included in XActions.
- When the x.com page can't be read, the transaction keys can come from the
  pair dictionary https://github.com/fa0311/x-client-transaction-id-pair-dict
  (MIT, (c) fa0311), downloaded at run time (not included here).
