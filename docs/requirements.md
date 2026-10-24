# Product requirements

These requirements define Arco's product boundary and the behavior contributors should preserve.

## Purpose and distribution

Arco lets a user find, read, and update GitHub and Linear issues while discussing the same work in Codex. It is distributed as MIT-licensed source and a local MCP plugin. A Git-backed marketplace catalog references the versioned, prebuilt npm package; generated artifacts and native binaries stay out of Git. The initial prebuilt target is macOS Apple Silicon, and source builds retain a generated local marketplace for development. Official public-directory submission is outside the current distribution plan.

GitHub and Linear own issue records and permissions. Codex owns the conversation, message sending, and AI execution. Arco owns issue interaction, local preferences and drafts, and the handoff of explicitly selected context. Operation categories are defined in [Issue operations](issue-operations.md).

Arco can select existing projects, milestones, cycles, and supported native field values, and manage supported label definitions. It does not administer projects, teams, workflows, field definitions, or access permissions.

Arco does not provide an independent issue tracker, generic project-management platform, cross-service synchronization, migration service, notification inbox, autonomous triage, or agent execution service. It does not introduce an Arco account, hosted issue backend, billing service, entitlement server, or paid feature tiers. Transfers, duplicate merges, destructive issue lifecycle operations, complex issue forms, and source-service administration remain upstream.

## Browsing and discovery

- The personal GitHub entry initially shows open issues assigned to the connected user, ordered by last update. **Created by me**, **Mentioned me**, and **All account repositories** require an explicit switch.
- An empty personal list stays empty. It must not silently widen to all repositories or public search.
- The project entry chooses a GitHub repository explicitly when the host cannot supply usable workspace roots. Keep this selection separate from personal browsing preferences.
- Ambiguous workspace roots require a repository choice. Never infer the chat's project from the MCP process's working directory or select an arbitrary repository or Linear team.
- Preserve native repository/workspace/team identity on every row, including when issue numbers or names coincide.
- Provide source-native search, filters, pagination, refresh, and direct issue-URL navigation without building an independent full-text index.
- Show the number of loaded issues accurately; do not present it as the account's total issue count.
- Keep list position, filters, draft input, and in-flight work across issue and provider switches.

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

Credentials stay outside the UI and model-facing results. Preserve local settings and unsent drafts without maintaining a persistent issue mirror. See [Security and privacy](security-and-privacy.md).

Only explicit user-authorized operations may mutate source data. Reusing a request ID is valid only for the identical operation. An uncertain write must be inspected before retrying; a read failure after a successful write must not be presented as a failed write.

## Usability and accessibility

- Keep issue content readable in narrow panels and wide workspaces; preserve access to controls when properties wrap.
- Support keyboard access, clear focus, useful names for controls, and focus return when dialogs close.
- Follow the host theme and reduced-motion preference. Use restrained motion only where it communicates action or loading.
- Distinguish loading, empty, error, saved, and partially completed states. A failed request is not an empty list.
- Display original issue text faithfully. Repository-maintained documentation, comments, and interface copy use English; user content retains its source language.
- Prefer each source service's terminology for equivalent actions. Use clear action-specific wording for Arco-only interactions, and describe the behavior Arco actually provides.

See [Screen structure](screen-structure.md) for presentation and interaction requirements. Contribution and verification requirements are in [CONTRIBUTING.md](../CONTRIBUTING.md).
