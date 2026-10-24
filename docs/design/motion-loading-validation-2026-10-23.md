# Loading and motion validation

Recorded on 2026-10-23 on macOS with Node 24.22.1. This is a historical implementation record. The session did not create/edit provider issues or comments, attach real conversation context, or send messages.

## Behavior introduced

- Separate skeletons cover initial bootstrap/host connection, provider configuration, issue lists, details, and inline cards.
- Before host connection, bootstrap fits the iframe viewport rather than imposing workspace height on an inline result.
- Background refresh retains loaded content and unsent drafts. Empty lists, disconnected providers, and failures leave loading and expose the relevant empty or retry state.
- Short transitions support actions, detail changes, disclosures, notifications, and selection feedback without moving source text or annotation ancestors.
- Creation dialogs use a small entrance, an inert exit state, and focus restoration. Reopening during exit returns focus inside the dialog.
- Reduced motion disables document and SDK-portal animation, freezes skeletons, and skips the dialog exit delay.

Later [hover color](hover-validation-2026-10-23.md) and [hover scale](hover-scale-validation-2026-10-23.md) records refine the action-feedback rules.

## Native-host observations

The installed HTML/server matched the build before testing. A newly opened Arco view showed:

1. A GitHub detail skeleton transitioning to the dedicated issue, with `arco-reveal / 0.18s` and no workspace transform.
2. Normal opening/closing of the issue-actions menu with `arco-rise / 0.15s`.
3. A full-area Linear connection skeleton transitioning to the authorized team list and issue.
4. A Linear creation dialog with `arco-rise / 0.2s`, focus inside on opening, focus returned to its trigger on close, and an inert exit state. No issue was created.

The original native screenshots were retired during OSS documentation cleanup. Interaction and computed animation/transition values were checked separately from those images. No artificial delay was added to real-host traffic.

## Delayed fixture checks

The fixture host used `ARCO_DEV_TOOL_DELAY_MS=2000` to delay MCP tool responses. This development-only behavior is absent from the production bundle.

| Scenario         | Observation                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Initial load     | Full Arco skeleton covered bootstrap and settings wait.                                                   |
| Slow list        | Connected controls appeared first; list/detail skeletons remained without a false empty-state message.    |
| Manual refresh   | `aria-busy=true`; no replacement skeleton; body and unsent comment remained visible and survived refresh. |
| Reduced motion   | Skeleton pseudo-element animation and display were disabled.                                              |
| Narrow workspace | No horizontal overflow at 390 px.                                                                         |
| Narrow inline    | A 235 px-high card skeleton at 390 px width, without workspace height.                                    |

The original fixture screenshots were retired during OSS documentation cleanup; the table preserves the recorded observations.

## Recorded results and limits

Type checking, lint, formatting, build, 68-tool smoke, artifact checks, and 185 unit/adapter tests across 21 files passed. The browser run passed 85 of 87 cases. Two assertions based on old loading copy were updated to inspect skeleton/busy/failure behavior and then passed on targeted rerun; this was not one all-green 87-case run.

A 390 by 180 px bootstrap was also inspected with JavaScript disabled. The final HTML was 1,620,584 bytes, SHA-256 `e8a6050f8eb0b45e099b05258997537c91b455e189f9be5fecc77e60418a5ac2`; the installed copy matched. Server SHA-256 was `5f83f4bafe8aa2d4fcaa6a391f9ed61dff5643089a8ef5c5d0ea431f2672ee59`.

This record does not establish all accessibility requirements, later build behavior, provider writes, or model receipt of context.
