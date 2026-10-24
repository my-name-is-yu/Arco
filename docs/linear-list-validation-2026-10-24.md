# Linear list projection and incremental loading

Historical validation record: 2026-10-24 JST. This snapshot is superseded as a release-readiness statement by [implementation status](implementation-status.md). No checks were rerun for this documentation rewrite.

## Behavior

A dedicated GraphQL list query uses the official SDK's `client.request`. It requests up to 100 Issue IDs, identifiers, titles, URLs, update times, and workflow states, together with the organization/team fields needed to validate the authorized scope. Bodies, reactions, shared user details, and full editing metadata are excluded. Detail and editing metadata retain their separate paths. SDK clients and credentials are not cached between requests.

The change preserves `issues` for empty searches and `searchIssues` for nonempty searches, raw query text, `includeComments: true`, team/state/assignee/label/project filters, creation/update sorting, cursors, and default archive behavior. Searchable body/comment content is independent of the fields returned for each list row.

The adapter validates organization UUID/URL key, team UUID/organization membership, and each Issue's team, official URL, and identifier. Partial GraphQL errors, incomplete rows, duplicate IDs within a page, or missing/empty/repeated continuation cursors fail the request rather than displaying a partial success.

Near the final 200 px, continuation fetches at most three pages per scroll request; **Load more** remains available. Failure keeps the current rows and permits a manual retry of the same cursor. Compact views and narrow layouts with a hidden list stop automatic continuation.

Thirty-second polling and focus refresh apply only to fullscreen lists with one page. Multi-page lists retain explicit refresh and invalidation after a save. Changed conditions restart pagination; obsolete requests receive an AbortSignal. Comment pagination, staged images/reactions, drafts, and selection sharing are unchanged.

## Recorded checks

| Layer                | Result at this snapshot                                                                                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`      | Passed on Node 24.22.1, including 348 unit tests, type/lint/format, build, smoke, and artifact checks                         |
| New browser coverage | Eight cases passed for 100-row scrolling, short-page cursors, condition resets, limits/retry, hidden lists, and polling rules |
| Full browser suite   | All 138 cases passed in 4.9 minutes                                                                                           |
| Provider comparison  | Seven conditions matched the official SDK in Issue identity, order, and display fields, using one API request each            |
| Live writes          | Zero                                                                                                                          |

The seven provider comparisons covered normal listing, state, assignee, label, project, creation order, and comment-inclusive search. Their result counts were 48, 19, 39, 5, 9, 48, and 23 respectively. These are historical account-specific observations, not stable benchmark fixtures.

For the same 48-Issue data set and 100-row cap, the previous implementation used 14 requests and 295,092 bytes of decompressed GraphQL JSON; the new query used one request and 20,905 bytes. The former 30-row implementation had used 14 requests and 210,300 bytes. These are application JSON sizes, not compressed network-byte measurements.

Three initial new browser failures came from test labels, a back-button name, and the focus event target differing from the real UI. Corrected tests, including a positive focus-refresh case, passed without changing product waits or retries. The pre-existing CSS `::highlight` build warning remained.

## Installation and real Codex

Installed artifact hashes matched the build:

| File         | Recorded SHA-256                                                   |
| ------------ | ------------------------------------------------------------------ |
| `arco.html`  | `c34ab51cd69bd3675f8b320ee6d74b9c0327f8478c8f6b2ea976949573988c51` |
| `server.mjs` | `b3f90238d82700294db51ea2af54d2735306d8d801d3fa336d024c0f5864a5e5` |

A separate app-server passed 71-tool, personal/project launch, and GitHub/Linear connection checks. A new stdio process read 48 summary-only Issues with no continuation, then read a dedicated Issue's body, one comment, attachments, and reaction arrays. No writes occurred; stderr was zero bytes. These checks were separate from rendered UI verification.

After a Codex restart, the actual tool described the new 100-entry summary list and returned 48 rows without bodies/comments/reactions. The real panel showed all 48, combined an identifier search with a workflow filter, and opened two dedicated validation Issues with expected bodies, attributes, tasks, images, and comment counts. No provider updates were performed.

One older local draft produced an unsupported-format warning. Read-only reproduction against the pre-change schema showed that retired `promptText`/`promptTarget` fields already failed validation; this was not introduced by list projection. The file was preserved. The second dedicated Issue had no such warning.

The live data set had only 48 Issues. Pagination beyond 100, injected failures, and hidden-list suppression therefore remain browser-fixture evidence. The real-host check covered one Mac and its current panel/theme.

Local reports under `dist/dev/` included `linear-list-live-2026-10-24.json`, the comparison reports, browser log, and installed-server report. They exclude titles, bodies, and credentials from final count summaries. Generated reports and real-data screenshots are not public release assets.
