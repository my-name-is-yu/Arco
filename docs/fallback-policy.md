# Retained fallback paths

Arco targets the current Codex host and current storage/tool contracts. Keep only the paths below. An unavailable capability, malformed provider response, or retired format must produce an explicit error instead of a fabricated success.

| Condition                                                           | Retained behavior                                                                                     | Purpose                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Refresh fails after an issue was loaded                             | Keep the loaded content and unsent input, with an error and retry action                              | Preserve work without presenting stale data as fresh                  |
| A write was saved but refresh or acknowledgement failed             | Preserve the native receipt or request ID; reconcile by reading the same record before a user retries | Avoid duplicate writes and false failure reports                      |
| One optional issue section fails to load                            | Keep successfully loaded sections and display that section's error                                    | Preserve readable source content while exposing partial failure       |
| Clipboard access is denied                                          | Show the exact value in a selected, read-only field for manual copying                                | Complete an explicit copy operation without browser permission        |
| A repository has no local issue templates                           | Apply GitHub's public owner `.github` inheritance rule                                                | Match GitHub's current native semantics                               |
| A template format is unsupported                                    | Mark it unsupported and offer its official provider creation page                                     | Let the user explicitly complete the source operation                 |
| A selected native value is missing from the current choice metadata | Keep its ID visible and disabled; do not silently clear or replace it                                 | Preserve the source value and unsaved selections                      |
| An annotation's DOM node was recreated                              | Restore only a matching card, issue, context, and text/hash anchor                                    | Restore the same selection without guessing its source or coordinates |

## Current data resolution and defaults

These remain ordinary supported behavior:

- Valid `304 Not Modified` responses reuse the credential-scoped ETag cache. A successful response without a usable cache validator is read directly and is not cached. Failed requests never serve stale success.
- A metadata cache miss can fetch the same native ID from the same provider. It cannot change the issue, team, repository, or provider.
- An explicitly supplied native issue reference can load its detail even when team-list discovery fails. Team selection gates list browsing and list-row defaults; it does not replace or block that requested reference.
- Missing local files use current initial settings. Existing invalid files are preserved and rejected. Each OS uses its standard state directory unless `ARCO_DATA_DIR` is supplied.
- Native nullable fields, deleted authors, empty collections, empty selections, and UI placeholders retain their explicit meanings.
- Failed queued operations release the queue for later work; their error remains visible. Failure to notify another view after a confirmed save does not replay or reverse that save.
- Project roots and existing per-chat repository choices identify the requested project. An unavailable or ambiguous project remains unresolved until the user chooses; the MCP process directory is never used as a replacement.

## Removed paths

- Repository GraphQL-to-REST switching, page-only repository continuation, and retired search syntax compatibility.
- Automatic repair, field completion, migration, or resetting of invalid settings/drafts.
- Standard model-context updates when synchronized OpenAI host support is absent, and local attachment success without a host acknowledgement. Browsing remains available; sharing reports the unsupported or unconfirmed operation.
- Hidden default repository configuration and automatic first-team selection. Mention search and Linear browsing use explicit or saved scope; an unavailable saved scope requires a new choice.
- Missing comment/Project continuation treated as the last page, and invented comment page numbers.
- Invalid Issue field values stringified into text, malformed Project nodes silently skipped, and incomplete Linear relations converted into empty IDs/text.
- Fabricated annotation rectangles, eager previews without IntersectionObserver, transient-only annotation persistence without WebCrypto, and omitted highlights without the Highlight API. The current browser APIs are required. Missing geometry hides annotation rendering while retaining its unsaved comment.
- Unreadable third-party notices replaced by blank text, arbitrary native-package read errors treated as missing packages, and the unused project-launch `workingDirectory` alternative.

See [validation](code-quality-validation-2026-10-24.md) for verification and limits.
