# GitHub list size and incremental loading

Historical validation record: 2026-10-24 JST. This snapshot is superseded as a release-readiness statement by [implementation status](implementation-status.md). The later [GraphQL and ETag record](github-network-validation-2026-10-24.md) updates the repository-list transport. No checks were rerun for this documentation rewrite.

## Problem and behavior

The account endpoint returns native pages that can contain pull requests. Arco removes pull requests after fetching a page. In a recorded `all` / `open` / updated-descending account request, a 30-entry page contained 8 Issues and 22 pull requests; a 100-entry page contained 58 Issues and 42 pull requests. Assigned/open was empty at both page sizes. The change did not widen an empty assigned scope automatically.

- Account and repository lists requested up to 100 native entries per page, preserving native filters, sort order, repository validation, and the search limit of 1,000 results.
- `gh api --jq` projected list fields before the child-process result reached Node. This reduced local parsing; it did not reduce the REST response transferred from GitHub to `gh`.
- Near the last 200 px of the list, automatic continuation fetched at most three pages per scroll request. Short or pull-request-only pages could continue. **Load more** remained available afterward.
- A failed continuation retained existing rows and stopped automatic retries. Compact views and narrow layouts with a hidden list did not load more automatically.
- After loading multiple pages, periodic and focus-triggered full-list refetches stopped. Explicit refresh and invalidation after a save remained available.
- Comment pagination at 30 items, staged image/reaction fetching, and detail behavior were unchanged.

## Recorded checks

| Layer                  | Result at this snapshot                                                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Static/build/protocol  | Type, lint, formatting, build, smoke, and artifact checks passed                                                                                                                         |
| Unit                   | 258 tests passed, including a run with Node 24.22.1                                                                                                                                      |
| Browser fixture        | All 127 tests passed in 6.5 minutes; six added cases covered continuation, retry, limits, and hidden lists                                                                               |
| Real production server | Account/all/open returned 58 Issues, assigned/open returned zero, and the dedicated repository returned two. Results excluded bodies and comments; no provider writes; zero stderr bytes |
| Separate app-server    | 71 tools, personal/project launch, and GitHub/Linear connection checks passed; this was not UI evidence                                                                                  |

An initial new browser fixture completed before its startup data notification and double-counted requests. The fixture synchronized its connection response with that notification; product retry or wait conditions were not relaxed.

## Installed artifact and real Codex

The recorded installed artifact matched the build:

| File         | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `arco.html`  | `dc9c85ab0864ae056b366fd742087eb7cb7b275317cdcc2b875ce57fe3b3f887` |
| `server.mjs` | `11629066a1a5b2814d1973f40f49f731ad1f946ada7f570887405fd18e2fdabd` |

The already-running Codex server initially returned the old eight-Issue result. After restart, its tool returned 58 summary-only rows. In the actual panel, automatic continuation expanded the list from 58 to 145 Issues, matching the next native page of 87 and `hasMore: false`.

A dedicated closed Issue displayed its body, attributes, empty comments, and reaction controls. This check performed no posts, updates, or reaction additions. It covered one macOS arm64 Codex environment, a narrow panel, and the dark theme. Large comment collections, offscreen images, failure injection, and repeated pull-request-only pages were fixture checks.

Count-only reports were written under `dist/dev/`, including `github-list-live-2026-10-24.json` and `github-list-browser-2026-10-24.log`. These local artifacts and real-data screenshots are not shipped in the public repository or plugin.
