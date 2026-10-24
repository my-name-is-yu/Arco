# Local data and storage

The local MCP process connects directly to GitHub and Linear. The providers own issue records; Codex owns conversations and shared context. Arco has no hosted issue database, cross-service mirror, or account backend.

## What is stored

| Information                                          | Location                                   | Retention and boundary                                                                                          |
| ---------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Issue bodies, comments, properties, and list results | Source service; in-memory UI/server caches | Refetched from the provider; no persistent issue mirror                                                         |
| GitHub credentials                                   | GitHub CLI's existing credential mechanism | Arco does not persist a duplicate; a private transient hash isolates account-list cache entries                 |
| Linear access/refresh token pair                     | OS credential store                        | Stored by connection ID under `Arco Linear OAuth`; no plaintext fallback                                        |
| Settings and filters                                 | Local `settings.json`                      | Revisioned JSON, bounded collections, no provider tokens                                                        |
| Unsent titles, bodies, and comments                  | Local `drafts/<hash>.json`                 | Native issue/scope keys; may contain sensitive user-entered content                                             |
| Chat/repository associations                         | Settings JSON                              | SHA-256 chat key; at most 100 associations; personal view preferences remain separate                           |
| Annotation positions                                 | Local `annotations.json`                   | At most 100 snapshots; IDs, positions, hashes, and issue references rather than selected text or comment bodies |
| Shared issues and passages                           | Codex host/model context                   | Only after explicit **Add to chat**; governed by the host's conversation behavior                               |
| OAuth state, verifier, and callback listener         | Local process memory                       | Short-lived authorization transaction; closes on completion, cancellation, or timeout                           |

The current schema lives in [`src/shared/state.ts`](../src/shared/state.ts). Position metadata is defined in [`src/shared/annotation-state.ts`](../src/shared/annotation-state.ts).

## Data directory

[`stateDirectory`](../src/server/state.ts) chooses the directory as follows:

| Environment                       | Default                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| macOS                             | `~/Library/Application Support/Arco`                           |
| Windows                           | `%LOCALAPPDATA%/Arco`, with `~/AppData/Local/Arco` as fallback |
| Linux and other Unix-like systems | `$XDG_STATE_HOME/arco`, or `~/.local/state/arco`               |
| Explicit override                 | `ARCO_DATA_DIR`                                                |

Changing `ARCO_DATA_DIR` changes local settings, drafts, annotation metadata, and lock paths. It does not create a separate OS credential namespace: Linear credential entries are still keyed by connection ID. Use isolated credentials and connection IDs for native tests.

## Revision checks, locks, and recovery

Settings and draft reads/writes take a file-specific process lock. Saves compare the caller's expected revision with the current record and fail visibly on a mismatch. Atomic replacement prevents partial JSON files; revision checks prevent overwriting another view's work.

Missing files use defaults. Invalid settings or drafts are recovered under the same lock. Before replacement, Arco creates a sibling `<filename>.recovery-<UUID>.bak` containing the original bytes, including invalid UTF-8. Recovery keeps fields and collection entries accepted by the current schema, uses defaults for invalid values, and advances the revision. If the backup cannot be written, the original file is not replaced.

Recovery backups can contain draft text and are not automatically pruned. Review them before manual cleanup. Invalid annotation snapshot files are reported as errors and preserved rather than recovered as settings/drafts. There is no general-purpose migration engine or automatic credential reset.

Local files are created with restrictive modes where the operating system supports them. The implementation uses atomic rename and `proper-lockfile`; in-process queues alone are not considered process coordination.

## Annotation lifecycle

The host context carries a snapshot UUID. Reopening the same Arco card can use the local snapshot to restore matching annotation positions. A different card does not automatically inherit them. A missing snapshot or changed source text must not create a guessed marker.

Local positions are insufficient to recreate a Codex attachment. Removing or replacing host context must remove the corresponding marker state; restoring a position must not re-add deleted context.

## Network boundaries

Provider reads and writes travel from the local server to GitHub or Linear. Supported images and uploads use validated provider destinations. Sharing issue context sends that content to Codex. Arco does not include an analytics server or background full-account mirror.

Disconnecting a provider does not delete provider issues, unsent drafts, or Codex attachments. Local disconnect and provider grant revocation are distinct operations. See [Authentication](auth-distribution.md).

For reporting concerns, use [SECURITY.md](../SECURITY.md). The [security design](security-and-privacy.md) describes implementation boundaries without claiming a completed security audit.
