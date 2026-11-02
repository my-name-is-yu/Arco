# Security and Privacy Requirements

This document defines the trust boundaries and data handling rules for Arco. For instructions on reporting vulnerabilities, see [SECURITY.md](../SECURITY.md).

## Core Principles and Trust Boundaries

GitHub and Linear are the single sources of truth for issue data and permissions. Arco reads and modifies those records through provider requests; these requests send data outside your device. Sharing selected context with Codex also sends data outside your device and requires an explicit user action. Arco does not run an issue backend, persistent issue mirror, analytics service, or background full-account mirror.

Symphony is the source of current runtime observations. Arco reads its optional HTTP API through the local MCP backend and does not control the orchestrator or maintain a permanent runtime history.

| Boundary                   | Required Behavior                                                                                                                               |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provider credentials**   | Never expose credentials in the UI, model-facing outputs, local drafts, settings, or logs.                                                      |
| **Source identity**        | Validate repositories, workspaces, teams, native issue IDs, canonical URLs, and required Project or field IDs before reading or modifying data. |
| **External issue content** | Treat all issue bodies, comments, images, links, and API errors as untrusted input.                                                             |
| **Local persistence**      | Reject corrupted or invalid stored data. Prevent partial writes and ensure concurrent views cannot overwrite each other's work.                 |
| **Conversation sharing**   | Only share context that the user explicitly selects. Never send messages automatically.                                                         |
| **Distribution**           | Include required license notices and target-native dependencies. Exclude test fixtures, source maps, and secrets from builds.                   |

---

## Authentication and Credentials

### GitHub

Arco relies on the user's existing GitHub CLI connection for authentication:

- **Cache invalidation:** Whenever credentials change—including when the same user rotates a token—Arco must invalidate any data cached under the previous credential.
- **Zero token retention:** Arco must never return or persist tokens or credential identity hashes.
- **Connection isolation:** Never silently alter authorization scopes, log out of a shared CLI connection, or inspect credential caches belonging to other plugins.

### Linear

Linear authentication must use OAuth with PKCE, state parameter validation, and a registered loopback callback:

- **Secure storage:** Store access and refresh tokens together in the operating system's credential store. If secure OS storage is unavailable, authentication must fail rather than fall back to plaintext storage.
- **No embedded secrets:** Never bundle a client secret with the application.

### Disconnecting vs. Revoking

Disconnecting a provider in Arco only removes the local connection; revoking an OAuth grant on the provider's side is a separate action. Neither action may silently delete remote issues, unsent local drafts, or existing Codex attachments.

### Symphony Connections

- **Explicit endpoints:** Store only user-entered base URLs and nonsecret connection metadata. Reject embedded credentials, query parameters, and fragments. HTTP is limited to loopback hosts; remote connections require HTTPS with normal certificate verification. Do not follow authentication or cross-origin redirects.
- **Existing transport:** Arco does not store Symphony tokens, perform browser sign-in, manage VPNs or SSH forwards, or inherit browser cookies. The HTTP endpoint must already be reachable through the user's existing connection route. Symphony's SSH worker configuration is separate from access to its HTTP endpoint.
- **Backend boundary:** Read endpoints only through the Node MCP backend after an explicit request. UI resources retain their self-contained CSP; server startup and tool discovery do not make Symphony requests. Bound request duration and response size, validate JSON at the HTTP boundary, and inspect snapshot errors even when HTTP status is 200.
- **Scope isolation:** Runtime cache is isolated by connection and endpoint configuration; joined issue data is additionally isolated by the provider credential generation and native scope. Never forward GitHub or Linear credentials to Symphony. Provider logout must not erase independent runtime observations.
- **Runtime attribution:** Match issue context using the configured tracker scope and canonical reference. Short identifiers and unrelated native ID schemes are not sufficient. Keep unmatched runtime data distinct from an authorized native issue rather than exposing edits against a guessed target.

---

## Content Rendering and External Resources

### Content Sanitization

All rendered issue content must be sanitized. Raw markup and renderer directives must never bypass sanitization. Restrict links and images to safe protocols, and delegate all link navigation to the host environment.

### Image and Resource Loading

- **Origin validation:** Only load images that belong to the currently selected issue or comment.
- **Fetch constraints:** Validate supported HTTPS destinations and redirects, enforce strict limits on file sizes and formats, and ensure provider credentials are never leaked to the UI.
- **Fallback:** If a resource is unsupported, hand it back to the source service rather than attempting to render it locally.

### UI Self-Containment

Production UI bundles must be fully self-contained. Do not load external scripts or stylesheets, and do not introduce unexpected runtime code evaluation.

---

## Data Mutations and Error Handling

### Safe Writes

Only explicit user-authorized operations may modify source data:

- Validate every target and attribute before sending a write request.
- Preserve any fields that the operation did not request to change.
- Use request IDs to deduplicate identical operations. If a transport response is missing or uncertain, the write may already have reached the provider. Check the provider's current state before retrying; do not replay the change or bypass deduplication with a new request ID.

### Accurate Status Reporting

Operation receipts must clearly distinguish between:

1. A failed mutation.
2. A partial success.
3. A completed mutation where the subsequent read-back failed.

Never mask permission errors or connection failures as empty lists or successful states. Malformed responses and uncertain outcomes must not be hidden as successes.

### Error Sanitization

Raw exceptions from providers, SDKs, or subprocesses can contain request payloads, private content, or credentials. Always strip sensitive data and return sanitized, actionable error messages instead of raw output. If an unknown exception occurs, display a safe, generic error message.

---

## Local Persistence and Draft Management

### Protecting Local Data

Because drafts may contain confidential issue text, local storage must be carefully isolated and protected:

- **Scope and concurrency:** Isolate drafts by their native scope and prevent concurrent saves from overwriting changes made in another view.
- **Handling unreadable data:** A missing record may fall back to default values. If an existing record is corrupted or invalid, report the failure visibly. Never automatically repair, migrate, reset, or overwrite the original bytes of an invalid record.
- **Failure modes:** If settings cannot be read, block access to the workspace. If a draft cannot be read, preserve any new input the user has typed without overwriting the unreadable file on disk.
- **Metadata privacy:** Store chat-to-repository associations using opaque keys rather than raw chat IDs or filesystem paths. Bound retained associations and annotation position snapshots. Treat backups from older app versions with the same protections as active drafts, and never delete them automatically.

### Draft Ownership and Legacy Migration

Draft keys include the provider's stable public user ID, so each account uses its own drafts within the same OS user profile. This does not add an OS or provider access-control boundary:

- **Account switching vs. token rotation:** Rotating a credential keeps draft ownership intact, whereas switching provider accounts changes the owner.
- **In-flight saves:** Queued saves remain tied to the user who was active when the input was entered, even if the user disconnects or closes the view before the save completes.
- **Legacy drafts:** Never automatically adopt older drafts that lack an owner ID. Keep legacy keys read-only via the app-only draft tool. Let the user explicitly review and copy a legacy draft into an empty, account-owned draft, preserving every saved field and the original file. If an imported issue draft lacks an editing baseline, use the current provider snapshot as its baseline so standard conflict checks still protect the user's changes.

---

## Sharing and Annotations (**Add to chat**)

### Explicit Context Handoff

Using **Add to chat** is an explicit, user-driven handoff:

- **Payload separation:** Sharing a whole issue and sharing a specific passage use distinct payloads. Sharing a highlighted passage must never silently attach the full issue or comment history.
- **Runtime snapshots:** Runtime sharing has its own explicit payload containing collection time, connection attribution, native reference when resolved, and the displayed runtime information. Reading, refreshing, or changing views never attaches it automatically or sends a message. Preserve existing issue and annotation restoration behavior.
- **Origin attribution:** Only attach a native origin reference when the selected text comes from a single, well-defined issue or comment. If a selection spans multiple issues, do not assign it to an arbitrary single target.

### Independent Content Blocks

When attaching annotations to Codex, the host's current content blocks are the single source of truth for what is attached:

- Package each annotation—its selected text, optional user comment, and minimal native reference—into its own independently removable content block.
- Never duplicate selections or comments inside an assistant-only aggregate block or background `structuredContent`, because removing a visible attachment in Codex does not reliably clear background data.

### Annotation Position Snapshots

Local position snapshots help re-anchor markers in the UI; they must not contain selected text or annotation comments:

- **No content storage:** Position snapshots must never store the selected text or the annotation comment itself.
- **Strict restoration:** Only restore markers when the originating card, currently attached blocks, and surrounding text context still match. If the underlying content has changed or position data is missing, do not guess marker placement. Never use local position data to resurrect an attachment the user has removed.
- **Legacy attachment conversion:** Only convert recognized older annotation formats when they exactly match remaining visible blocks. Remove any aggregate source copies during conversion, and always let a native removal or replacement take precedence over an in-flight conversion.

---

## Related Documentation

- [Product requirements](requirements.md)
- [Issue operations](issue-operations.md)
- [Screen structure](screen-structure.md)
