# Implementation and acceptance status

Updated: 2026-10-24. This is an index of implementation and previously recorded verification, not a new test run. Arco is an MIT-licensed Codex plugin distributed from GitHub. See [installation](installation.md), [development](development.md), and the [documentation index](index.md) for current contributor guidance.

The product boundary is defined by [requirements](requirements.md), [scope](product-scope.md), and the [operation catalog](issue-operations.md). A passing fixture test, a successful provider request, an installed artifact, and a working Codex interaction are separate evidence.

The latest local cleanup is recorded in [Current-contract cleanup](code-quality-validation-2026-10-24.md). It removes retired repository-list compatibility and automatic local-data repair. Historical verification below describes its own snapshot.

The follow-up [quality gate and error-recovery record](quality-gates-validation-2026-10-24.md) covers CI configuration, the structured error contract, refreshed installed-server checks, and the remaining desktop acceptance boundary. A locally installed update does not establish that an existing conversation has reloaded it.

The [notification policy](design/notifications.md) limits notices to actionable failures, draft protection, incomplete outcomes, bulk failures, and pending external authorization. Ordinary success feedback comes from the screen; copy actions retain their local **Copied** label.

## Implemented operations

Paths below are relative to `src/ui/` or `src/server/` unless stated otherwise. The [technical stack](technical-stack.md) describes the current ownership boundaries.

| ID  | Operation                                                                                                   | Main implementation areas                                           |
| --- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| O01 | Explicit repository, workspace/team, and existing Project selection                                         | Application launch/session state, provider workspaces and adapters  |
| O02 | Native search, filters, sorting, pagination, and separate provider settings                                 | Provider list modules, workspace settings                           |
| O03 | Markdown bodies and comments, native attributes, supported images, and source links                         | `MarkdownContent.tsx`, detail views, image adapters                 |
| O04 | Issue creation and local creation drafts                                                                    | Workspace create dialogs, draft storage, provider create handlers   |
| O05 | Title/body editing, Markdown task updates, and conflict comparison                                          | Detail editors, content drafts, Markdown task parser                |
| O06 | GitHub state/reason, separate Projects Status, and native Linear workflow                                   | Provider property controls and update handlers                      |
| O07 | Set and clear eligible assignees                                                                            | Provider metadata and update handlers                               |
| O08 | Add/remove specified labels while preserving other labels                                                   | Provider label handlers and Linear group validation                 |
| O09 | Create, edit, and delete label definitions within the supported scope                                       | Label managers and provider handlers                                |
| O10 | Comment pagination, posting, editing, deletion, and Linear reply parents                                    | Discussion views and comment handlers                               |
| O11 | Native Issue/comment reactions                                                                              | Provider reaction controls and handlers                             |
| O12 | Supported GitHub Issue and Projects field types; Linear priority, estimate, and due date                    | Property controls, GitHub field handlers, Linear service            |
| O13 | Existing Project, milestone, and cycle membership                                                           | Provider property controls and handlers                             |
| O14 | Create sub-issues and set, replace, or remove parents                                                       | Relation controls and provider handlers                             |
| O15 | GitHub blocking relations; Linear blocking and related relations                                            | Relation controls and provider handlers                             |
| O16 | Existing attachment links and Linear uploads                                                                | Image handlers, Linear upload service and UI                        |
| O17 | Supported simple templates and native links for unsupported templates                                       | Template handlers and create dialogs                                |
| O18 | Compatible bulk edits with a result for each Issue                                                          | Bulk controls and provider bulk handlers                            |
| O19 | Whole-Issue and selected-text context, grouped annotations, native mentions, and refresh after tool updates | Host bridge, context attachments, selection/annotation UI, mentions |
| O20 | Copy native identifiers and open source Issue/comment links                                                 | Detail/discussion utility menus                                     |

GitHub and Linear retain their native identifiers, permissions, workflow, and partial-success semantics. There is no synthesized cross-provider workflow or synchronization service. Provider data remains authoritative; local settings and drafts do not form an Issue mirror.

## Recorded verification milestones

These counts describe their respective source snapshots. Do not add them together or assume an earlier full suite covers a later change.

| Date and change                                    | Local checks recorded                                                                                                                                                                                                       | Provider or Codex evidence                                                                                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-23: native Issue operations                | Unit/adapter and browser coverage for provider-specific validation and partial failure                                                                                                                                      | Dedicated GitHub and Linear Issue writes, readback, and cleanup; see [GitHub](github-live-validation.md) and [Linear](linear-validation.md)                                                       |
| 2026-10-23: queue, selection, and interaction work | Display-only notifications caused no new tool calls in the corrected fixture; RPC concurrency stayed at or below two; draft retention, keyboard controls, and reduced motion were covered                                   | Expanded Codex views and selected conversation context were observed; see the [documentation index](index.md)                                                                                     |
| 2026-10-24: responsibility refactor                | 255 unit/adapter tests, 121 browser tests without retry, 71-tool smoke, build, artifact, type, lint, and formatting checks                                                                                                  | [Separate real Codex verification](real-codex-refactor-validation-2026-10-24.md) covered drafts, switching, and annotation lifecycle                                                              |
| 2026-10-24: GitHub list size and continuation      | 258 unit tests and 127 browser tests                                                                                                                                                                                        | Real account pagination and dedicated-Issue detail; [record](github-list-validation-2026-10-24.md)                                                                                                |
| 2026-10-24: GitHub GraphQL and ETag                | 316 unit tests and 130 browser tests                                                                                                                                                                                        | GraphQL cursor comparison with REST and REST `200 → 304`; [record](github-network-validation-2026-10-24.md)                                                                                       |
| 2026-10-24: Linear list projection                 | 348 unit tests and 138 browser tests                                                                                                                                                                                        | Seven list/filter comparisons with the official SDK and real Codex list/detail reads; [record](linear-list-validation-2026-10-24.md)                                                              |
| 2026-10-24: inline card and presentation changes   | Intermediate snapshot: 399 unit/adapter tests and 159 full browser tests. Later source-explicit launch snapshot: 411 unit/adapter tests and 33 targeted launch/inline browser tests, with 73-tool smoke and artifact checks | Earlier inline appearance was observed. The later presentation/launch changes still require verification in a restarted Codex host; [record](design/presentation-policy-validation-2026-10-24.md) |

Generated reports under `dist/dev/` are local development artifacts, excluded from Git and the plugin package. Historical screenshot collections are not required to use or contribute to Arco; the public records retain their relevant outcomes and limits.

## Codex acceptance evidence and remaining work

The following summarizes observed behavior through 2026-10-24. It does not establish every interaction on the latest build.

| Area                                       | Recorded evidence                                                                                                                  | Remaining verification                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Account and repository discovery           | Personal lists, explicit scope changes, repository candidates, URL resolution, and real provider details were observed             | Recheck global/thread entrypoints and the final presentation rules on the release candidate                      |
| Shared target versus viewed target         | Browsing another Issue preserved the shared Issue in expanded GitHub and Linear views                                              | Final inline-to-detail return and host panel restoration                                                         |
| Whole-Issue and body/comment context       | Both providers delivered native references and the selected text to model context; selection sharing excluded the full body        | Final grouped annotation behavior on Linear and all general UI/cross-Issue selections                            |
| Grouped annotations                        | GitHub multi-selection text/comments reached model context; host-side group removal cleared annotation markers in a recorded check | Repeat the full add, reopen, edit, host-remove lifecycle for both providers on the release candidate             |
| Draft persistence and annotation isolation | Real Codex switching and a new panel restored drafts; Linear annotations did not appear over GitHub content                        | Annotation persistence across a Codex restart and delayed acknowledgement conflicts remain fixture-only evidence |
| Refresh after external tool writes         | A dedicated GitHub Issue title and Projects Status refreshed in the open detail view; source values were restored                  | Final compact/inline refresh behavior                                                                            |
| Composer mentions                          | Native mention resources and protocol behavior are tested                                                                          | Actual `@Arco` search and selection for both providers in Codex                                                  |
| Inline card edits                          | Fixture saves, target retention, keyboard interaction, themes, and narrow widths are covered                                       | Actual inline writes and expand/collapse behavior in Codex                                                       |

Arco adds context through **Add to chat**. Codex owns its composer, attachment presentation, and message submission. Removed request-sending and new-chat draft features are not acceptance requirements. Picture-in-picture was removed from scope; inline and fullscreen remain supported presentation targets.

## Provider and platform limits

- Advanced fields, estimates, cycles, and existing Project membership depend on definitions and permissions in the selected provider. Fixture coverage does not prove a live write for an absent field type.
- Linear uploads use the official upload flow, then save the resulting URL. Arco's transfer limit is 10 MiB; this is not a statement of Linear's service-wide limit.
- Image previews are restricted to actual Markdown image targets, allowed HTTPS origins, and supported raster formats up to 5 MiB. Unsupported images keep a source link; arbitrary HTML and SVG execution are excluded.
- Linear verification used a private development OAuth app. Another workspace needs its own usable OAuth configuration; public app availability has not been established.
- Native execution evidence is limited to macOS arm64. Builds include the keyring binary for their own OS/architecture; see the [platform matrix](platform-validation.md).
- A matching installed file hash does not prove a running Codex server has reloaded. Several historical checks required a Codex restart before the new schema or behavior appeared.

Repository preparation, a public GitHub repository, and an installable release are separate steps. This status document does not claim that publication or a release has occurred.
