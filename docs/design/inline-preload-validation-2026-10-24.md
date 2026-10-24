# Inline issue preload validation

Recorded on 2026-10-24 JST against local changes based on `2a34a74`. Provider-changing interactions used local fixtures. Installed-artifact checks did not read or change provider issues.

## Delivered behavior

- A grouped conversation card accepts 2–4 explicit native references. Five references are rejected before provider reads. Order and duplicate handling remain unchanged.
- The server sends the already-fetched full issue records through app-only result metadata. Model-facing text and structured content contain presentation summaries without bodies or comments.
- All returned bodies and properties seed the existing GitHub/Linear detail caches before the cards mount. Initial launch does not invalidate those fresh records or repeat the group read. Later snapshots cannot replace a newer cached read or provider revision.
- A refresh returning a different native issue set is rejected before its snapshot can enter the cache or image prefetch path.
- Each issue's first Markdown body image is prefetched at background priority, up to four images. Reference-style images work. Source previews share the same query keys and ten-minute freshness/retention settings. Later body and comment images keep their existing viewport loading behavior.
- Image query observers keep pending reads shared across tab changes. Removing the final observer cancels queued reads. Failed images do not block bodies, properties, or tab navigation.
- Only the selected issue workspace renders. Existing reading positions, drafts, native properties, and explicit context sharing are retained.

See [screen structure](../screen-structure.md) and [issue operations](../issue-operations.md).

## Automated checks

Typecheck, ESLint, source formatting, documentation formatting/link checks, all 592 unit/adapter tests across 40 files, production build, the 74-tool MCP smoke check, and distribution artifact checks passed. The pre-existing CSS optimizer warning for `::highlight` remained.

The related browser command covered `inline-issue-tabs`, `inline-card`, `deferred-fetch`, and `launch`: 55 of 56 cases passed on the first run. All 14 grouped-tab cases passed, including four mixed-provider issues, cached switching, image reuse, image failure containment, mutation refresh, drafts, and reading positions.

The remaining case captured a card fade after restoring the operating-system motion preference. Body scrolling and reading positions had passed. The test now checks its scrolling samples before restoring that preference, while still checking the body's animation after restoration. Production CSS was unchanged. Both GitHub and Linear cases passed after this narrow test correction; this was a focused rerun rather than another complete 56-case run.

The common loading/bootstrap case also passed with its CSP/runtime checks. A separate four-issue fixture browser observation recorded zero console errors, page errors, or CSP violations, one `arco_show_issues` request, and zero individual detail requests. The prefetched Linear image was reused when its tab opened.

## Installed artifact

Refreshed `arco@arco-local` with the current build. Installed HTML/server bytes matched the build:

| File         | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `arco.html`  | `f1813968c395cdec193a66b34e9a4255f420fdc8846b3a4cba7cc9b4e533ef26` |
| `server.mjs` | `5419411e564206332561fcf70070bf5af4aae0508ff346057057f87ea7f1cbf5` |

A newly spawned installed MCP process advertised `arco_show_issues.targets.maxItems = 4`; this check made no provider reads. These results establish the installed files and local fixture behavior, not that an existing desktop conversation has reloaded them. Restart the desktop app and open a fresh conversation to observe the updated native card, following the [official local-plugin update guidance](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually).

## Desktop acceptance

After restarting Codex, the user accepted the native four-issue group containing GitHub #3, Linear YU-47, GitHub #4, and Linear YU-46. This is user-reported desktop acceptance; the request-count and CSP measurements above remain fixture observations.
