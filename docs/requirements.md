# Product requirements

These requirements describe the behavior contributors should preserve. They are separate from proof that every operation, host surface, or operating system has been validated. Use [implementation status](implementation-status.md) for that evidence.

## Purpose and distribution

Arco lets a user find, read, and update GitHub and Linear issues while discussing the same work in Codex. It is distributed as MIT-licensed source with a manually installed local MCP plugin. Official public-directory submission is outside the current distribution plan.

The complete responsibility boundary is documented in [Product scope](product-scope.md); operation categories are in [Issue operations](issue-operations.md).

## Browsing and discovery

- The personal GitHub entry initially shows open issues assigned to the connected user, ordered by last update. **Created by me**, **Mentioned me**, and **All account repositories** require an explicit switch.
- An empty personal list stays empty. It must not silently widen to all repositories or public search.
- The project entry chooses a GitHub repository explicitly when the host cannot supply usable workspace roots. Keep this selection separate from personal browsing preferences.
- Preserve native repository/workspace/team identity on every row, including when issue numbers or names coincide.
- Provide source-native search, filters, pagination, refresh, and direct issue-URL navigation without building an independent full-text index.
- Show the number of loaded issues accurately; do not present it as the account's total issue count.
- Keep list position, filters, draft input, and in-flight work across issue and provider switches.

See [GitHub discovery](github-account-discovery.md) and [Project and personal viewers](project-viewers.md).

## Issue interaction

- Support both services' issue reading, creation, edits, native states, assignments, labels, comments, relationships, and the explicitly supported existing attributes.
- Preserve unspecified attributes and native constraints. Do not synthesize a common status, priority, or label model.
- Keep GitHub issue state independent from GitHub Projects Status.
- Reject incomplete scope or field catalogs when a write requires complete membership or option validation.
- Preserve input on validation errors, conflicts, connection failures, and uncertain writes.
- Retain bulk outcomes per issue for failure isolation and retry selection. Show failed targets and retry only those; ordinary successful rows stay quiet. Do not guess values across incompatible selections.
- Apply simple templates only when their supported contents can be represented without silently dropping required fields or behavior.
- Offer source-service links for unsupported operations.

## Conversation and display

| User intent                               | Expected behavior                                                |
| ----------------------------------------- | ---------------------------------------------------------------- |
| Show a particular issue                   | Display an inline card for its explicit native reference         |
| Change a quick property or checklist item | Save against the card's own target and retain that card          |
| Ask Codex to summarize or update content  | Use data tools; a panel is not required just to perform the task |
| Open details or use **Open details**      | Open the same issue in the expanded panel                        |
| Open a list or compare issues             | Open the list/detail workspace                                   |
| Share an issue or a selection             | Add explicit context to Codex; leave message sending to the user |

Keep inline targets, panel browsing targets, and shared targets independent. A long description alone is not a reason to open a side panel. Host initialization must not rewrite saved source or scope preferences merely because a card was opened.

Whole-issue sharing, selected passages with optional annotations, `@Arco` issue discovery, and refresh after MCP updates are the conversation integration goals. Group multiple annotations into one attachment context while preserving their numbers and optional comments. Restore markers only for the originating card and matching content; removed context must not be recreated from local position metadata.

## Local data and authorization

The local MCP process connects directly to GitHub and Linear. Credentials stay outside the UI and model-facing results. Settings and unsent drafts use local JSON with revision checks, atomic replacement, and process locks. Linear credentials use the OS credential store with no plaintext fallback. See [Local data](local-data-boundary.md) and [Security design](security-and-privacy.md).

Only explicit user-authorized operations may mutate source data. Reusing a request ID is valid only for the identical operation. An uncertain write must be inspected before retrying; a read failure after a successful write must not be presented as a failed write.

## Usability and accessibility

- Keep issue content readable in narrow panels and wide workspaces; preserve access to controls when properties wrap.
- Support keyboard access, clear focus, useful names for controls, and focus return when dialogs close.
- Follow the host theme and reduced-motion preference. Use restrained motion only where it communicates action or loading.
- Distinguish loading, empty, error, saved, and partially completed states. A failed request is not an empty list.
- Display original issue text faithfully. Repository-maintained documentation, comments, and interface copy use English; user content retains its source language.

See [Screen structure](screen-structure.md) and [Design QA](../design-qa.md).

## Acceptance evidence

Run the documented [development checks](development.md) for code changes. Fixture tests establish behavior against fictional providers and a mock host. Protocol checks establish MCP registration and tool behavior. Real provider writes, desktop rendering, composer context receipt, and other native platforms each need separate evidence.

Do not infer broad platform support from source branches or a successful build on one Mac. A manually installed local plugin is not proof of official directory publication.
