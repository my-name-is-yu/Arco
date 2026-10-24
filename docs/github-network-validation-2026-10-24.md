# GitHub GraphQL lists and ETag revalidation

Historical validation record: 2026-10-24 JST. This snapshot is superseded as a release-readiness statement by [implementation status](implementation-status.md). It extends the earlier [list-size change](github-list-validation-2026-10-24.md). No checks were rerun for this documentation rewrite.

## Transport and compatibility

Repository lists use GraphQL `search(type: ISSUE)` with up to 100 results per page. The query requests list summaries, labels, assignees, and pagination fields without bodies, comments, or reactions. The UI passes `nextCursor` to the next request and resets it when repository, search, state, or sort order changes.

Personal lists retain native REST `GET /issues`, including assigned/created/mentioned/all scopes, state, ordering, pull-request exclusion, and native page continuation. On a new or changed REST response, GitHub still sends the full native response to `gh`; `--jq` projects summaries for Arco. Subsequent requests send the ETag and reuse an in-memory summary only after an actual HTTP 304. A new 200 response is accepted even when only equal-ranked row order changed.

Explicit `sort:` queries, Boolean expressions/parentheses, legacy numeric pages without a cursor, and pages with more than 100 labels or assignees use the existing REST search path. Repository identity checks and the 1,000-result search limit remain. GraphQL authentication errors, transport failures, and partial responses are not hidden behind a successful REST fallback. Personal lists are not replaced with `viewer.issues` or search.

The summary-only ETag cache is bounded to 32 entries and 8 MiB. It is partitioned by a hash of the active CLI credential; a credential change invalidates prior entries even for the same account. The server obtains that value through `gh auth token --hostname github.com --no-refresh` without refreshing the credential or exposing it in logs/results. Tests cover credential checks before/after requests, request coalescing, failure invalidation, LRU limits, and independent returned data.

The earlier three-page automatic continuation limit, manual retry, multi-page polling rules, 30-comment pagination, and staged image/reaction loading remain. Editing metadata is fetched separately; list-only GraphQL label IDs are not substituted for editing metadata.

## Recorded checks

| Layer              | Result at this snapshot                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`    | Passed on Node 24.22.1, including 316 unit tests, build, smoke, artifact, type, lint, and format checks                                     |
| Browser            | All 130 cases passed in 5.9 minutes, including cursor reset, pull-request-heavy pages, retry limits, comments, images, drafts, and sharing  |
| REST revalidation  | Assigned list returned `200 → 304`; the 304 body was zero bytes                                                                             |
| Scope behavior     | Assigned/open remained empty; all/open returned 58 Issues with continuation                                                                 |
| GraphQL pagination | Two 100-row pages from the public `cli/cli` repository had no duplicates; second-page Issue numbers and order exactly matched the REST path |
| Compatibility      | Explicit `sort:` followed REST; the dedicated repository returned its two Issues through GraphQL                                            |

The live check used eight list API reads and no provider writes. Reported `bodyBytes` measured CLI output after projection, not compressed network traffic. The existing CSS `::highlight` build warning remained. A new browser selector was narrowed to the direct filter summary after matching nested summaries; product timing/retry behavior was unchanged. An interrupted browser attempt was excluded; the complete rerun passed all 130 cases.

## Installed artifact and real Codex

| File         | Recorded SHA-256                                                   |
| ------------ | ------------------------------------------------------------------ |
| `arco.html`  | `342e728c855265e98dc32f28bbd207c83861e9b06eca86d3af9ba02e0029195c` |
| `server.mjs` | `9d9bfd493316556fd6b32ea910153f48b21bbd0f94b6b5e20c19f752265f2ffe` |

Installed files matched this build. A separate app-server passed 71-tool, launch, and provider-connection checks; this did not establish rendered UI behavior.

After a Codex restart, the actual tool schema exposed `cursor`. Two real `cli/cli` requests returned 200 distinct Issues through cursor continuation. Personal-list results stayed summary-only. The panel displayed repository filters, a label search, a dedicated closed Issue, and account continuation from 58 to 145 rows. No source updates or reactions were performed.

This real-host check covered one Mac, the current panel width, and dark mode. Failure injection, large comments, offscreen images, and repeated pull-request-only pages remained fixture evidence. Local reports were stored under `dist/dev/` (`github-network-live-2026-10-24.json`, browser log, and plugin-host log); private screenshots and generated reports are not public release assets.
