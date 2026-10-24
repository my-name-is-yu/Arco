# Responsibility refactor and shared UI validation

Historical validation record: 2026-10-24. This local pre-installation snapshot is superseded as a release-readiness statement by [implementation status](implementation-status.md). The subsequent installation/restart observations are in the [real Codex record](real-codex-refactor-validation-2026-10-24.md). No checks were rerun for this documentation rewrite.

## Change and baseline

The refactor retained GitHub/Linear operations while separating view, state, communication, and attachment responsibilities. It used the existing dependencies and Node 24.22.1 without a dependency update or an additional state library.

Before the change, 244 unit/adapter tests, type/lint, build, stdio smoke, and artifact checks passed. The browser run had 107 passes and two reproducible failures involving image retrieval and cancellation of queued work. One browser file had a formatting mismatch.

Stable Markdown link/image/list components replaced component identities recreated on render; changing values flowed through context. This kept the same image node and in-flight request while the parent updated. The queue-cancellation test held two image requests, queued a reaction, then switched Issues without assuming a fixed fetch order. Both existing failures and a new regression for retaining an image during draft input passed.

## Ownership and format decisions

- The application entry switches providers and mounts only the active workspace. Notifications for an inactive provider mark its cache stale for return.
- QueryClient owns retrieved data. Host-scoped provider sessions own browsing/operation state. Shared draft management owns unsent inputs, revisions, and save status.
- Host snapshots are authoritative for conversation attachments, independently of the viewed Issue. Annotation observers and position calculations are managed together.
- Native IDs, workflow, permission checks, partial success, and saved-but-refetch-failed receipts remain provider-specific. The GitHub API version was unchanged.
- Retired request fields, old settings completion, and selection-only legacy attachment input were removed. Current storage locations/formats were retained. Unsupported old files produce a read error and remain untouched.
- The completed inline probe and its catalog entry were removed. Its [historical result](inline-probe-validation.md) remains separate from product validation.

## Recorded final checks

| Check                   | Result                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run check`         | Passed: type/lint/format, 255 unit/adapter tests in 26 files, and build                                                     |
| Stdio smoke             | Passed: 71 tools, resources/mentions, fixture writes/deduplication, stdout/stderr framing                                   |
| Artifact inspection     | Passed: single HTML; no external script/style, fixture data, or source maps in the plugin                                   |
| Targeted browser checks | Create dialogs, conflict comparison, save during switching, bulk locks/retry IDs, annotations, and image regressions passed |
| Complete browser suite  | 121 passed without retry in 5.4 minutes                                                                                     |
| Whitespace              | `git diff --check` passed                                                                                                   |

An independent review compared registration metadata/result envelopes, GitHub read/write classification and API version, and Linear target validation/saved receipts. The refactor also corrected scroll-restoration markers, bulk execution state, URL-resolution busy state, and the lifetime of leaf-operation errors.

Fixture visual checks covered both providers at wide and 390 px widths, create dialogs, and Linear conflict comparison. Headers, close controls, footers, focus, titles, and Markdown were visible without observed overlap/clipping. The browser suite also covered inline/fullscreen, light/dark, and reduced motion. Three old browser expectations changed for shared region/alert UI and source launch after settings load; the entire 121-case suite was then rerun successfully.

## Snapshot artifacts and limits

| File                     | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `dist/plugin/arco.html`  | `52e63ff27143db5f9bbf13086077d191e5dc4ba735e5794396c4de19e0024650` |
| `dist/plugin/server.mjs` | `8147611afd881dbd6765f9d374d3487bd1cd7a66b99a2b9da3cd376710de9b3e` |

Browser output was stored locally under `dist/dev/refactor-browser-final`. Generated fixture results are not shipped. This record establishes local logic, protocol, artifact, and fixture behavior for the snapshot; it does not establish an updated running Codex host or successful provider writes.
