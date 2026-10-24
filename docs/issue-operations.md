# Issue operations

This table defines Arco's issue-client boundary. It is not a promise that every operation has the same validation history; see [implementation status](implementation-status.md). All operations require the source service to expose the capability and the connected user to have access.

## Supported categories

| ID  | Operation                      | GitHub                                                              | Linear                                            | Limits                                                                        |
| --- | ------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------- |
| O01 | Select scope                   | Repository and existing Project                                     | Workspace, team, and existing project             | Preserve native scope; no mixed-provider workflow                             |
| O02 | List, search, filter, and sort | Native issue queries and account filters                            | Native issue queries and team filters             | No independent issue index                                                    |
| O03 | Read details                   | Title, Markdown, comments, properties, images, and links            | Same, preserving comment replies                  | Public API and account permissions limit available data                       |
| O04 | Create issue                   | Choose a repository                                                 | Choose a team                                     | Preserve drafts during failure                                                |
| O05 | Edit title and body            | Markdown and checklist items                                        | Markdown and checklist items                      | No collaborative editing service or separate task model                       |
| O06 | Change state                   | Open/Closed and close reason; separate Project Status               | Team workflow state                               | Never automatically couple GitHub issue state with Project Status             |
| O07 | Assign                         | Add/remove eligible assignees                                       | Set/clear the eligible single assignee            | Do not invite users or manage access                                          |
| O08 | Apply labels                   | Existing repository labels                                          | Existing workspace/team labels                    | Preserve unspecified labels and native group constraints                      |
| O09 | Manage labels                  | List, create, edit, and delete label definitions                    | Same within supported scope                       | Group administration and scope moves stay upstream                            |
| O10 | Comments                       | Read, post, and authorized edit/delete                              | Same, including replies                           | No reimplementation of inline annotations, thread resolution, or AI summaries |
| O11 | Reactions                      | Issue and comment reactions                                         | Issue and comment reactions                       | Use existing native reaction kinds                                            |
| O12 | Existing attribute values      | Issue type, supported organization issue fields, and Project fields | Priority, estimate, due date                      | Supported types are listed below                                              |
| O13 | Membership                     | Existing Projects and milestone                                     | Existing project, project milestone, and cycle    | Do not create or administer membership targets                                |
| O14 | Parent and child issues        | Create child, set/change/remove parent                              | Same                                              | No hierarchy bulk editor                                                      |
| O15 | Issue relationships            | Read/add/remove blocking relationships                              | Blocking and related relationships                | No duplicate merge or cross-service relationships                             |
| O16 | Attachments and links          | View existing attachments and add Markdown URLs                     | View/add URLs and upload through the official API | GitHub local-file upload is handed to the source UI; no Arco file storage     |
| O17 | Existing simple templates      | Supported body and property defaults                                | Same                                              | Complex forms or unsupported contents must be handled upstream                |
| O18 | Bulk organization              | Compatible states, assignees, labels, and existing values           | Same                                              | No bulk body/comments/relationships/definition management or transfer         |
| O19 | Codex context                  | Whole issue, selected passages, mentions, refresh after tools       | Same                                              | Explicit sharing; no automatic message sending                                |
| O20 | Source handoff                 | Copy issue/comment URL or identifier; open GitHub                   | Same for Linear                                   | Preserve access to unsupported native operations                              |

The source-specific tool contracts are defined in [`src/shared/contracts.ts`](../src/shared/contracts.ts), [`src/shared/github-operations.ts`](../src/shared/github-operations.ts), and [`src/shared/linear.ts`](../src/shared/linear.ts). The packaged [issue workflow skill](../plugin/skills/arco-issue-workflow/SKILL.md) explains tool selection.

## Supported attribute types

- GitHub issue: an existing issue type.
- GitHub organization issue fields: existing text, number, date, single-select, and multi-select values.
- GitHub Project fields: existing text, number, date, single-select, and iteration values. Status is one Project single-select field.
- Linear: priority, estimate under the selected team's scale, and due date.

Organization issue fields and Project fields are separate storage locations. Matching names do not imply matching definitions or synchronization. Field definitions, options, iteration periods, and estimate scales are managed in the source service.

## Inline and expanded operations

Inline cards support reading, checklist changes, native issue state, assignees, existing labels, Linear priority, and copying/opening native references. Free-form title/body editing, comments, project membership and fields, relationships, and bulk operations belong in the expanded workspace. See [Screen structure](screen-structure.md#inline-cards).

Checklist writes edit the source Markdown line. A conflicting draft or unavailable draft state must lead to review in details rather than silently overwriting work.

## Source-service handoffs

Issue transfers, deletion/archive/restore, duplicate merging, moderation, subscription management, complex templates, full history restoration, pull-request review/merge, and CI execution are outside Arco's direct operations. Preserve available source links; do not render an unsupported feature as a working control.

Project/cycle/milestone/team administration, roadmap planning, time accounting, autonomous triage, notification inboxes, provider synchronization, and generic migration/import/export are outside the product scope.

## Write correctness

Validate native source, ID, repository/team, and any required Project/field/option IDs before saving. Write only the supplied attributes. For bulk actions, require compatible targets and display each outcome.

Keep source automation intact and re-read the result instead of reproducing or counteracting upstream automation. Distinguish successful writes, failed writes, uncertain outcomes, and successful writes whose subsequent read failed. Never automatically retry an uncertain mutation with a new request ID.

For implementation guidance, see [Technical architecture](technical-stack.md), [Security design](security-and-privacy.md), and [Development](development.md).
