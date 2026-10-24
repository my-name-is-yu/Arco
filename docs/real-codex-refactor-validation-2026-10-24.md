# Real Codex verification after the responsibility refactor

Historical validation record: 2026-10-24 JST. This snapshot is superseded as a release-readiness statement by [implementation status](implementation-status.md). It records actual Codex/provider reads separately from the [local fixture checks](refactor-validation-2026-10-24.md). No new checks were performed for this documentation rewrite.

## Artifact and running-server confirmation

Installed HTML/server hashes matched the refactor build:

| File         | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `arco.html`  | `52e63ff27143db5f9bbf13086077d191e5dc4ba735e5794396c4de19e0024650` |
| `server.mjs` | `8147611afd881dbd6765f9d374d3487bd1cd7a66b99a2b9da3cd376710de9b3e` |

The old running server initially still returned an older draft format. After Codex restarted, it returned the new unsupported-format message while preserving the old file. Process startup times followed the artifact update. A separate app-server passed 71-tool, personal/project launch, and both provider connection checks; those were not treated as panel-rendering evidence.

## Actual panel observations

The check used an existing dedicated GitHub Issue and a dedicated Linear Issue without creating records, changing provider attributes/bodies, or posting comments.

| Action                                            | Observed result                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Switch GitHub → Linear → GitHub and the reverse   | Real data, provider-specific filters, and unsent inputs were retained                 |
| Unsent comment on each provider                   | The same text and `Draft saved on this device` returned after switching               |
| Open another Arco panel                           | Each provider reloaded the same saved comment draft                                   |
| Inspect local draft state                         | Current schema, revision 1, exact test text, and no retired request fields            |
| Add a Linear body selection                       | An annotation marker and the correct shared Issue were visible                        |
| Save and reopen an annotation comment             | The saved comment returned unchanged                                                  |
| Browse GitHub with the Linear annotation retained | No Linear marker appeared over GitHub; returning restored the original marker/comment |
| Remove the annotation in Arco                     | Marker, editor, and shared-target indication disappeared while unsent drafts remained |

The initial text selection was performed manually; subsequent annotation editing, switching, reopening, and deletion were observed through the app panel. Provider reads confirmed both Issues still had zero comments, and their update times predated this run.

## Legacy files and cleanup

Two older local drafts contained retired `promptText`/`promptTarget` fields. The new server rejected them without migration, initialization, or overwrite. New-format checks used dedicated Issues without those legacy files.

Before/after hashes of the legacy files matched. The test annotation was removed and the two test comment drafts were cleared; both current drafts ended at revision 2 with empty comments. Existing creation drafts and credentials were unchanged. Preserving an unsupported file does not make it readable; contributors should follow the current draft-format behavior described in [development](development.md).

## Evidence limits

The check covered one macOS arm64 Codex environment, its current panel width, and dark mode. It did not cover removing the attachment directly in Codex, retaining annotations across a Codex restart, or injected delays/acknowledgement conflicts.

Wide/390 px layouts, light/dark themes, inline/fullscreen, reduced motion, and delayed/conflicting responses were covered by the separate 121-case fixture run. Their success is not a substitute for the remaining real-host checks. Original real-data screenshots were local development evidence and are not part of the public documentation assets.
