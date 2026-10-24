# Product scope

Arco is an MIT-licensed client for browsing and editing GitHub and Linear issues inside Codex. It connects a local MCP server and an embedded UI to the source services, and shares explicitly selected issue context with the conversation.

GitHub and Linear remain the systems of record. Codex owns the conversation and AI execution. Arco owns issue interaction, local preferences and drafts, and the handoff of selected context.

## Responsibilities

| Area                  | Arco owns                                                                                                   | Boundary                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Issue work            | Search, read, create, edit, status changes, assignees, labels, comments, and supported native relationships | Preserve source IDs, permissions, and semantics                                 |
| Existing organization | Select existing projects, milestones, cycles, and supported field values for an issue                       | Do not administer projects, teams, workflows, or field definitions              |
| Labels                | Create, edit, delete, and apply supported label definitions                                                 | Keep repository, workspace, team, and label-group constraints                   |
| Conversation          | Share a whole issue or selected passages, provide issue mentions, and refresh after tool writes             | Codex owns attachment presentation, message entry, sending, and model execution |
| Presentation          | Inline issue cards, an expanded list/detail workspace, and responsive transitions                           | Host capabilities determine the available display surfaces                      |
| Local data            | Settings, unsent drafts, bounded annotation positions, and in-memory caches                                 | No independent issue database or service-wide mirror                            |
| Distribution          | Source builds and manual Codex plugin installation                                                          | Official public-directory listing is not a requirement for this project         |

See [Issue operations](issue-operations.md) for the supported operation categories. Product scope describes intended responsibilities; [implementation status](implementation-status.md) records the evidence available for particular operations and environments.

## Provider semantics

GitHub and Linear have separate workspaces in the UI. A shared presentation component does not imply a shared business workflow.

- GitHub issue Open/Closed state and each GitHub Project's Status are separate values. Arco does not synchronize them.
- Linear workflow states belong to the selected team. Linear priority and estimates remain native values.
- A label or status with the same name in two scopes is still a different definition.
- GitHub permits multiple assignees; Linear issue assignment remains singular.
- Editing a Linear issue does not propagate that edit to GitHub, or vice versa.

## Conversation boundaries

Showing an issue, browsing a panel, and sharing context are distinct operations. Opening another issue does not replace an existing attachment. Selecting text does not share it until **Add to chat** is used. Arco does not automatically send a message.

Inline cards support reading and quick changes. Free-form body editing, comments, relationships, project membership, and bulk work belong in the expanded workspace. See [Screen structure](screen-structure.md).

## Outside the project

Arco does not provide an independent issue tracker, a generic project-management platform, cross-service synchronization, migration tooling, notification inboxes, autonomous triage, or an agent execution service. It does not create an Arco account or operate an issue backend, billing service, or entitlement server.

Transfers, duplicate merges, destructive issue lifecycle operations, complex issue forms, and administration of projects, cycles, milestones, teams, and workflows remain in the source service. Source links provide the handoff where an operation is unsupported.

Supporting another provider or adding synchronization changes the product boundary. New upstream API capabilities do not automatically become Arco requirements.

## Access and environments

Arco's code is available under the [MIT License](../LICENSE). GitHub, Linear, and Codex still require their own accounts, permissions, and service terms. Arco does not impose paid feature tiers or repository-count subscriptions.

The interactive product targets Codex desktop. Validation has been performed on macOS arm64; other operating systems and architectures require their own native builds and checks. See [Platform validation](platform-validation.md) and [Installation](installation.md).
