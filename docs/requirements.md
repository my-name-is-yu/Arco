# Product Requirements

This document defines what Arco does, where its boundaries lie, and the behavior contributors should preserve.

## Overview and Distribution

Arco lets users find, read, and update GitHub and Linear issues, observe Symphony runs, and discuss the same work in Codex.

It is distributed as MIT-licensed source code and a local MCP plugin:

- **Packaged distribution:** A Git-backed marketplace catalog points to a versioned, prebuilt npm package (initially targeting macOS Apple Silicon). Generated artifacts and native binaries are excluded from Git.
- **Development builds:** Source builds generate a local marketplace for development.
- **Public directories:** Submitting to official public plugin directories is currently out of scope.

## Responsibilities and Boundaries

Arco works alongside GitHub, Linear, Symphony, and Codex with clear ownership boundaries:

- **GitHub and Linear** own the underlying issue records and access permissions.
- **Symphony** owns orchestration, workspaces, workers, and observed runtime state.
- **Codex** owns the conversation, message sending, attachment list, and AI execution.
- **Arco** owns issue interaction, runtime observation, local preferences, unsent drafts, and the handoff of explicitly selected context to Codex. Detailed issue operation categories are defined in [Issue operations](issue-operations.md).

### What Arco supports

- Reading, creating, and editing issues across both GitHub and Linear, including native states, assignments, labels, comments, relationships, and explicitly supported existing attributes.
- Selecting existing projects, milestones, cycles, and supported native field values.
- Managing supported label definitions.
- Reading the official Symphony Elixir v0.0.3 HTTP API, associating its current runs with explicitly scoped GitHub or Linear issues, and sharing selected runtime context.

### What is out of scope

- **Service administration:** Arco does not administer projects, teams, workflows, field definitions, or access permissions.
- **Upstream-only operations:** Issue transfers, duplicate merges, destructive lifecycle actions, and complex issue forms remain in the source service. When an operation isn't supported locally, Arco provides a direct link to the source service.
- **Platform expansion:** Arco is not an independent issue tracker, general project-management tool, cross-service sync or migration engine, notification inbox, autonomous triage system, or agent execution service.
- **Hosted infrastructure:** Arco does not introduce an Arco account, a hosted issue backend, billing, entitlement servers, or paid tiers.
- **Runtime administration:** Arco does not install, launch, deploy, or configure Symphony workers, manage tunnels or Symphony authentication, or provide agent start/stop/approval/resume controls.

## Browsing and Discovery

### Scoping and repository selection

- **Personal GitHub view:** Defaults to open issues assigned to the connected user, sorted by last updated. Switching to **Created by me**, **Mentioned me**, or **All account repositories** requires an explicit user action. If a personal list has no matches, it stays empty rather than automatically widening to all repositories or public search.
- **Project view:** If the host cannot provide usable workspace roots, the user must explicitly choose a GitHub repository. This project selection is kept separate from personal browsing preferences.
- **Ambiguous workspaces:** When workspace roots are ambiguous, prompt the user to choose a repository. Never guess the project from the MCP process's working directory or pick an arbitrary repository or Linear team.
- **Clear identity:** Always display the native repository, workspace, or team identity on every row—even when issue numbers or names overlap.

### Search, navigation, and state retention

- Use each service's native search, filters, pagination, refresh, and direct URL navigation rather than building an independent full-text index.
- Report the number of currently loaded issues accurately without framing it as the account's total issue count.
- Preserve list scroll position, active filters, draft inputs, and in-flight operations when switching between issues or providers.

## Reading and Updating Issues

### Native models and validation

- Respect each platform's native constraints and leave unspecified attributes untouched. Do not invent a unified status, priority, or label model across GitHub and Linear.
- Keep standard GitHub issue state separate from GitHub Projects Status.
- If a write operation requires complete membership or option validation, reject incomplete scope or field catalogs rather than proceeding with partial data.
- Apply simple issue templates only when their supported contents can be faithfully represented without silently dropping required fields or behavior.

### Error handling and bulk updates

- Never lose user input when validation errors, conflicts, connection drops, or uncertain writes occur.
- Track bulk operations per issue so failures are isolated: keep successful rows quiet, surface the failed targets, and allow retrying just the failures. Never guess values across incompatible selections.

## Codex Conversation and Display

Arco matches its UI footprint to the user's intent, keeping inline cards, panel views, and shared conversation targets independent of one another:

| User intent                                 | Expected behavior                                                                                      |
| :------------------------------------------ | :----------------------------------------------------------------------------------------------------- |
| Show a specific issue                       | Display an inline card bound to that explicit native reference.                                        |
| Tweak a quick property or checklist item    | Save directly against the card's target and keep the card in place.                                    |
| Ask Codex to summarize or update an issue   | Run via data tools; a UI panel is not required just to complete the task.                              |
| View full details or click **Open details** | Open the issue in the expanded side panel. (A long description alone does not trigger the side panel.) |
| Browse a list or compare multiple issues    | Open the full list/detail workspace.                                                                   |
| Inspect Symphony work                       | Open the dedicated Symphony board/list workspace.                                                      |
| Share an issue or text selection            | Attach the selected context to Codex, leaving the user in control of sending the message.              |

Host initialization must not overwrite the user's saved source or scope preferences merely because a card was opened.

### Symphony observation

- **Navigation and identity:** The existing view selector contains GitHub, Linear, and Symphony as three flat choices. Symphony is a view over runtime information, not a third native issue provider; issue references, drafts, and writes retain GitHub or Linear identity.
- **Connections and scope:** Save multiple explicitly entered connection URLs, display one at a time, and allow runtime reads without a tracker sign-in. Optional issue context binds a connection to an explicit GitHub repository or Linear connection/workspace/team and optional project. Never infer that scope from a short issue identifier.
- **Data sources:** Runtime comes from Symphony snapshots. Titles, descriptions, native states, preparation, and review classifications come from the tracker. Match within the configured scope using canonical issue references, not unrelated ID formats. Unmatched runtime rows remain visible without an invented issue context.
- **Classification:** Blocked runtime is Needs attention; Running or Retrying is Working. With no observed runtime, configured review criteria take precedence over preparation criteria. Criteria use existing GitHub labels or Linear workflow states. Unclassified work remains Other; missing runtime alone never means ready, queued, or done.
- **Current observations:** Keep snapshots in memory rather than a persistent run history. Preserve prior data and label it stale on a failed refresh. A missing run or runtime-detail 404 is not proof of completion or tracker deletion. Pagination captions describe loaded work, with explicit additional loading.
- **Updates and edits:** While visible, refresh runtime every five seconds and tracker lists every thirty seconds, deduplicating concurrent reads. Pause polling when hidden. Native issue changes use existing editing controls and do not claim to send instructions to a running agent.
- **State retention and sharing:** Board/list views share data, filters, and selection. Preserve navigation, drafts, and reading positions when moving between issue and run details. Runtime sharing uses an explicit snapshot with collection time and attribution, leaves sending to the user, and preserves existing issue/annotation contracts.

### Context sharing and annotations

Conversation integration centers on four workflows: sharing whole issues, sharing selected passages with optional annotations, discovering issues via `@Arco`, and refreshing views after MCP updates.

For passage sharing and annotations:

- **Ownership:** Arco manages text selection, numbered markers, and comment editing; Codex manages the attachment list and message sending.
- **Structure:** Package each annotation—the selected text plus its optional comment—as a single, individually removable content block within the same attachment group. Do not generate aggregate copies for the model.
- **Numbering:** Keep internal block keys stable, but update visible marker numbers dynamically to match the current attachment order.
- **Marker restoration:** Restore selection markers only when they match the originating card, currently attached blocks, and matching content. Once context is removed, never recreate it from background metadata or cached local offsets.

## Local Data, Security, and Authorization

- **Credentials and storage:** Keep credentials strictly out of the UI and model-facing results. Store local preferences and unsent drafts locally without maintaining a persistent mirror of remote issues. See [Security and privacy](security-and-privacy.md) for full details.
- **Write safety:** Source data may only be modified by explicit, user-authorized actions.
- **Idempotency and retries:** Only reuse a request ID when repeating the exact same operation. If a write outcome is uncertain, inspect the remote state before retrying. If a write succeeds but the follow-up read fails, report the read failure accurately rather than telling the user the write failed.

## Usability, Accessibility, and Copy

- **Responsive layout:** Keep issue content legible in both narrow panels and wide workspaces, ensuring controls remain accessible when properties wrap.
- **Keyboard and focus:** Provide keyboard access, visible focus states, useful control names, and reliable focus restoration when dialogs close.
- **Theme and motion:** Respect the host's color theme and reduced-motion settings. Use subtle animation only to communicate loading or actions.
- **Clear state feedback:** Clearly distinguish between loading, empty, error, saved, and partially completed states—never display a failed request as an empty list.
- **Language and terminology:** Render original issue text faithfully in its original language, while keeping codebase documentation, comments, and UI copy in English. Use GitHub's and Linear's native terminology for platform actions, and use clear, literal action labels for Arco-specific features that describe the behavior Arco actually provides.

For detailed layout and interaction rules, see [Screen structure](screen-structure.md). For development and testing workflows, see [CONTRIBUTING.md](../CONTRIBUTING.md).
