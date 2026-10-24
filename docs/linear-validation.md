# Linear adapter and live validation

Historical validation record: 2026-10-23, with a list-query follow-up on 2026-10-24. These results are superseded as a release-readiness statement by [implementation status](implementation-status.md). No provider calls or tests were rerun for this documentation rewrite. Current setup is described in [installation](installation.md).

## Implementation boundaries

The Linear adapter retains native connection, workspace, team, Issue, comment, and workflow identities. It does not translate GitHub Open/Closed or Projects Status into a shared workflow.

- `src/server/linear/service.ts` uses the official SDK for provider operations; operation handlers cover lists, details, native properties, incremental labels, comments/replies, reactions, relations, attachments, supported templates, and bulk results.
- `src/server/linear/auth.ts` implements PKCE S256, state verification, user-actor `read,write` consent, loopback callback, token exchange/refresh, and disconnect without distributing a client secret.
- Fixture data is separate and does not call Linear or pretend to be a production connection.
- `src/shared/linear.ts` defines inputs and JSON DTOs, preserving native scope, parent comments, label groups, and existing Project/cycle/milestone identities.

The 2026-10-24 [list change](linear-list-validation-2026-10-24.md) moved summary listing into `linear/issue-list.ts`. Details, editing, comments, and images retain their existing contracts.

Saves refetch the provider result. Incremental label mutations preserve unrelated labels; selecting a group member does not silently remove unspecified siblings. UI and conversation tools use the same adapter. There is no Arco backend, Issue mirror, or agent queue.

## Credential storage and refresh

Linear access/refresh tokens are stored together in one OS credential-store entry. They are excluded from settings/draft JSON, UI state, tool results, and logs. `@napi-rs/keyring` provides the native binding. Linux explicitly uses Secret Service; unavailable, locked, or denied storage fails without a plaintext fallback.

Refresh acquires a connection-scoped cross-process lock, rereads the stored credential, refreshes only when needed, and saves the new pair together. Failure preserves the previous pair. Lock files contain metadata rather than tokens.

The callback binds only to loopback and verifies the configured path, host, and state. Code exchange is not executed twice. Completion, cancellation, and timeout remove the listener and release the active PKCE/code closure; status objects contain no secrets.

## Recorded local verification

At the initial adapter snapshot, type/lint checks and 23 Linear/auth/upload tests passed. Later integration results are indexed in [implementation status](implementation-status.md).

Coverage included:

- stale-body conflicts, matching `requestId` deduplication, mismatched-payload rejection, unrelated-label preservation, reply parents, native workflow checks, scope/ID validation, and partial bulk failure;
- state mismatch followed by a valid callback, secret-free exchange/refresh, cancellation, storage failure, disconnect versus provider revocation, and disconnect during callback processing;
- two independent Node processes refreshing an isolated fake credential pair exactly once through the process lock, with cleanup afterward;
- official-SDK requests against a loopback GraphQL endpoint for filters/cursors, incremental labels, refetch, duplicate-state refusal, GraphQL errors inside HTTP 200, and partial attribute/label saves;
- saved receipts when creation/comment acknowledgement succeeded but refetch failed, retaining the saved native ID and preventing a repeated mutation for the same request;
- valid 10 MiB base64 decoding, size rejection, invalid padding/characters, and avoiding a stack-overflow-prone repeated-group expression.

Native fake-credential write/read/delete and cross-process rotation ran successfully on macOS arm64. Other operating systems were not observed. `tests/linear-native-rotation.test.ts` skips when secure OS storage is unavailable; a skip does not establish native support.

## Recorded provider verification

A private development OAuth app was used for a dedicated test workspace. The loopback PKCE flow completed, consent was limited to the user actor and `read,write`, OS storage succeeded, and production MCP connection/scope reads worked. A real provider refresh saved a new pair and a later production process connected successfully. Tokens and the client secret were not printed or copied into reports.

This private app did not establish authorization for other workspaces or availability of a public distribution app. Contributors need usable OAuth configuration for their own environment. Existing Codex connector credentials are not a supported input to Arco.

Two dedicated validation Issues were used for writes. Recorded production MCP checks included creation; title/body changes; priority, due date, and assignment; stale-body refusal; label-definition creation/update/deletion; incremental labels; comment/reply edits and deletion; Issue/comment reactions; parent/child and blocking/related relations; and partial bulk results. Cleanup marked both test Issues done, cleared assignment/due dates, and removed temporary labels without cleanup errors.

A small PNG completed the official upload flow and its URL remained in the provider-normalized Markdown. Authenticated image reads validated the source Issue/comment target and allowed host before using a token server-side. The UI received validated raster data through app-only `_meta.image`, without the access token or broader CSP permissions.

The live API rejected the older `issueSearch` field, so nonempty search switched to `searchIssues`; ordinary listing used `issues`. Native filters/order/cursors were preserved. Real listing, identifier search, existing-template reads, and a bulk mix of valid/missing Issues then succeeded. The test team contained no usable template/cycle/Project milestone/estimate values; live writes for those absent values were not established. Fixture and SDK transport checks cover their contracts.

[`scripts/validate-linear-live.mjs`](../scripts/validate-linear-live.mjs) requires explicit workspace/team and dedicated test-Issue inputs. It checks existing validation titles and relationships before reuse. It performs real writes and must remain outside ordinary CI. Provider revocation was not performed in the recorded live run; local/provider disconnect branches were tested separately.

## Remaining acceptance

Actual Codex composer mentions, final grouped Linear annotation presentation, final inline saving, and Windows/Linux native storage remain separate acceptance work. A successful stdio call, fixture, or type check does not prove those interactions. See the [platform matrix](platform-validation.md) and [implementation status](implementation-status.md).

Implementation references: [OAuth](https://linear.app/developers/oauth-2-0-authentication), [SDK data access](https://linear.app/developers/sdk-fetching-and-modifying-data), [filters](https://linear.app/developers/filtering), [uploads](https://linear.app/developers/how-to-upload-a-file-to-linear), [authenticated storage](https://linear.app/developers/file-storage-authentication), and [native keyring binding](https://github.com/Brooooooklyn/keyring-node).
