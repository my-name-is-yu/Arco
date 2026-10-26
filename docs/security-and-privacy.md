# Security and privacy requirements

These requirements define Arco's trust and data boundaries. Vulnerability reporting instructions are in [SECURITY.md](../SECURITY.md).

## Trust boundaries

GitHub and Linear remain authoritative for issue data and permissions. Arco does not operate an issue backend, persistent issue mirror, analytics service, or background full-account mirror. Provider requests and explicit sharing with Codex send data outside the device.

| Boundary               | Required behavior                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Provider credentials   | Keep credentials out of the UI, model-facing results, local drafts/settings, and logs                                          |
| Source identity        | Validate repository/workspace/team, native issue IDs, canonical URLs, and required Project/field IDs before access or mutation |
| External issue content | Treat bodies, comments, images, links, and API errors as untrusted data                                                        |
| Local persistence      | Reject invalid stored data and prevent partial writes or overwriting another view's work                                       |
| Conversation sharing   | Share only explicitly selected context; do not send messages automatically                                                     |
| Distribution           | Ship required license notices and target-native dependencies; exclude fixtures, source maps, and secrets                       |

## Authentication

GitHub authentication remains with the user's GitHub CLI connection. A changed credential must invalidate data cached under the previous credential, including token rotation for the same user. Tokens and credential identity hashes must not be returned or persisted by Arco. Do not silently change authorization scopes, log out a shared connection, or inspect another plugin's credential cache.

Linear authorization requires PKCE, state validation, and a registered loopback callback. Keep access and refresh tokens together in the OS credential store; unavailable secure storage must fail rather than fall back to plaintext. Do not bundle a client secret.

Disconnecting a provider removes Arco's local connection. Provider-side grant revocation is a separate operation. Neither action silently deletes issues, unsent drafts, or existing Codex attachments.

## Content rendering and resources

Sanitize rendered issue content. Restrict accepted link and image protocols, and use the host for navigation. Raw markup and renderer directives must not bypass sanitization.

An image must belong to the selected issue or comment. Validate supported HTTPS destinations and redirects, bound accepted data size and formats, and keep provider credentials out of the UI. Hand unsupported resources back to the source service.

Keep production UI resources self-contained; do not load external scripts or styles or add unexpected runtime code evaluation.

## Writes and errors

Only explicit user-authorized operations may mutate source data. Validate every supplied target and attribute, and preserve fields that the operation did not request to change.

Request IDs deduplicate identical operations. An uncertain response must not trigger a blind mutation retry with a new ID. Receipts must distinguish a failed mutation, partial success, and a completed mutation whose following read failed. A permission or connection error must never become an empty list or a success state.

Provider exceptions can include request text, private content, and credentials. Return sanitized, actionable errors instead of raw subprocess or SDK output.

Unknown exceptions receive a safe generic message. Show actionable failures without hiding malformed responses or uncertain outcomes as success. A missing transport response to a dispatched mutation is an unconfirmed result, not permission to replay the change.

## Persistence and sharing

Drafts can contain confidential issue text. Protect local data, isolate drafts by native scope, and prevent concurrent saves from overwriting another view's work. Missing records may use defaults; existing invalid records must fail visibly without automatic repair, migration, reset, or replacement of their original bytes. A settings read failure blocks the workspace. Draft read failures retain new input without overwriting the unreadable record.

Draft keys also include the provider's stable public user ID. Credential rotation does not change draft ownership; switching users does. Queued saves retain the owner captured when input was entered, including after disconnect or view teardown. This partitions normal application state within one OS user's data; it is not an additional OS or provider access-control boundary. Older drafts without an owner are never adopted automatically. Offer an explicit review and copy into an empty account-owned draft, preserving every saved field and the original file. If an imported issue draft lacks an editing baseline, use the current provider snapshot as its baseline so normal conflict checks protect its proposed changes. Legacy keys remain read-only through the app-only draft tool.

Store chat/repository associations under opaque keys rather than raw chat IDs or working paths. Bound retained associations and annotation position snapshots. Backups from older versions require the same protection as active drafts and must not be deleted automatically.

**Add to chat** is an explicit handoff. Whole-issue sharing and passage sharing have different payloads; a selected passage must not silently include the full issue or comment history. Preserve a native origin only when the selection belongs to one well-defined issue or comment. Multi-issue text must not be assigned an arbitrary native target.

Annotation position snapshots must not contain selected text or annotation comments. Restore only matching positions for the originating card and context. Changed content or missing positions must not produce guessed markers, and local positions must not resurrect removed attachments.

See [Product requirements](requirements.md), [Issue operations](issue-operations.md), and [Screen structure](screen-structure.md) for related behavior.
