# Security and privacy design

This document describes Arco's trust boundaries and contributor expectations. It is not a certification or a completed security audit. Vulnerability reporting instructions are in [SECURITY.md](../SECURITY.md).

## Trust boundaries

Arco's embedded UI communicates with a local Node.js MCP server through the host bridge. The server accesses GitHub through the public GitHub CLI and Linear through its OAuth/API client. GitHub and Linear remain authoritative for issue data and permissions.

| Boundary               | Required behavior                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Provider credentials   | Keep credentials out of UI HTML, `_meta`, model-facing results, local draft/settings JSON, and logs                            |
| Source identity        | Validate repository/workspace/team, native issue IDs, canonical URLs, and required Project/field IDs before access or mutation |
| External issue content | Treat bodies, comments, images, links, and API errors as untrusted data                                                        |
| Local persistence      | Use schema validation, process locks, revision checks, atomic replacement, and rejection of invalid stored data                |
| Conversation sharing   | Share only explicitly selected context; do not send messages automatically                                                     |
| Distribution           | Ship required license notices and target-native dependencies; exclude fixtures, source maps, and secrets                       |

Local processing avoids an Arco-operated issue backend. It does not make issue data stay entirely on the device: provider requests and user-directed sharing with Codex are network operations.

## Authentication

GitHub authentication remains with `gh`. The conditional account cache obtains the selected CLI token transiently to hash its identity, so a changed credential invalidates prior cache entries. Tokens and identity hashes are never returned or persisted. Arco does not silently change scopes or log out a shared connection.

Linear authorization validates state and a registered loopback callback and uses PKCE. Access and refresh tokens are stored as a pair in the OS credential store. Process coordination re-reads the pair before refresh; unavailable secure storage fails instead of using plaintext. See [Authentication](auth-distribution.md) for client registration and disconnect behavior.

## Content rendering and resources

[`MarkdownContent.tsx`](../src/ui/MarkdownContent.tsx) uses the Apps SDK UI renderer with sanitization. Link and image handling restricts accepted protocols and hands opening to the host. Math is disabled. Raw markup and renderer directives must not bypass the sanitization boundary.

Images are resolved by a source-bound server tool rather than exposing provider credentials to the iframe. The tool validates that the requested image belongs to the selected issue/comment's parsed Markdown, validates supported HTTPS destinations and redirects, and bounds image data and accepted formats. Unsupported resources are handed back to the source service.

The production HTML is self-contained. The artifact check rejects external scripts/styles, remote CSS resources, dynamic imports, and unexpected runtime code evaluation. It explicitly reports two allowed dependency capability/global-object probes. Static presence, guards, and browser CSP behavior are separate forms of evidence; see [Dependency runtime notes](dependency-runtime-notes.md).

## Writes and errors

Use the same implementations for UI and conversational tools. Keep read and write tools distinct and validate every supplied target and attribute. Preserve fields that the operation did not request to change.

Request IDs deduplicate identical operations. An uncertain response must not trigger a blind mutation retry with a new ID. Receipts must distinguish a failed mutation, partial success, and a completed mutation whose following read failed. A permission or connection error must never become an empty list or a success state.

Provider exceptions can include request text, private content, and credentials. Return sanitized, actionable errors instead of raw subprocess or SDK output.

Only authored `OperationError` messages cross the MCP tool boundary. Errors use the strict `{ error: { kind, message } }` contract in `src/shared/errors.ts`; unknown exceptions receive a safe generic message. The UI preserves the kind and shows its next action. It rejects malformed or retired text-only failure payloads. A missing transport response to a dispatched provider mutation is an unconfirmed result, not permission to replay the change.

## Persistence and sharing

Drafts can contain confidential issue text. They use the same protected local directory as settings, with separate native scope keys. Invalid stored records are rejected without replacing their original bytes. Backups created by older versions require the same care as active drafts. See [Local data](local-data-boundary.md).

**Add to chat** is an explicit handoff. Whole-issue sharing and passage sharing have different payloads; a selected passage must not silently include the full issue or comment history. Preserve a native origin only when the selection belongs to one well-defined issue or comment. Multi-issue text must not be assigned an arbitrary native target.

Annotation position snapshots do not contain the selected text or annotation comment. Restore only matching positions for the originating host context, and do not resurrect attachments after deletion.

## Verification expectations

Use fixture tests for hostile Markdown, invalid URLs, identity mismatches, credential failures, concurrent refresh, storage conflicts, and ambiguous write outcomes. Use isolated native credential tests for actual OS storage. Real provider operations and real Codex attachment/rendering checks require separate records.

The repository contains historical dependency and security observations. They do not establish the current advisory state or absence of vulnerabilities. Follow [Development](development.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) when changing these boundaries.
