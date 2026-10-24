# Screen structure and conversation behavior

Arco uses an inline card for a particular issue, compact inline tabs for several explicit issues, and an expanded workspace for browsing and detailed work. The host ultimately controls the rendered surface.

## Entrances and display intent

| Intent                                               | Entry and behavior                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| Show an issue or report its current state            | `arco_show_issue` with an explicit native reference; inline card   |
| Show several explicit issues together                | `arco_show_issues` with 2–4 native references; compact inline tabs |
| Explain, summarize, or update an issue through Codex | Data tools; no panel solely for the AI task                        |
| Open an issue's details, or use **Open details**     | `arco_open_issue`; same issue in the expanded panel                |
| Open the personal list                               | `arco_open`, optionally with an explicit provider                  |
| Open a GitHub repository list                        | `arco_open_project`                                                |

The initial card and subsequent issue cards use the same policy. Long descriptions scroll inside the card's compact body area without an expand/collapse step or automatically opening a panel. A request for a more detailed explanation does not itself request a new screen.

Keep the inline target, the panel's browsing target, and shared context separate. Showing a second issue must not replace the first issue's attachment or a panel's current target. **Open details** resolves the native target of the clicked card. Returning to that card after browsing another panel issue preserves the original card target.

Opening a card does not rewrite saved source/repository/team preferences or automatically change display mode. An explicit source on a list-opening request takes precedence for that launch.

## Expanded workspace

The workspace contains a list and the selected issue's details. The list header groups provider, visible scope, search, state, and secondary filters. Rows preserve native identity and support compatible bulk selection. The personal GitHub view starts with **Assigned to me**; other account filters are explicit. Project browsing uses a chat-specific repository choice. Linear uses its own workspace/team scope.

The details toolbar holds **Add to chat** and an issue-actions menu. Body and comments form a continuous reading area. Properties sit alongside the content when width permits and return to a single-column layout when narrow. Narrow views switch between list and detail while retaining filters, selection, and list position.

Keep body reading prominent; avoid stacking secondary controls ahead of the content. Free-form body editing, comments/replies, project and relationship management, custom fields, and bulk work belong here. Unsupported operations link to the source service.

## Inline cards

The card is one column. Its header shows the repository/native identifier, **Open details**, and an overflow menu; the title follows. State, assignees, labels, and Linear priority appear directly below it and wrap on narrow surfaces.

Descriptions contain the complete source body from first render. The body has a maximum height of about 190px; short bodies retain their natural height. Long bodies scroll vertically within that area, keeping the card's existing width. There is no **Expand description** / **Collapse description** control. The named body region supports keyboard scrolling, and links, checklists, and text selection remain available throughout the full body. Each issue retains its own reading position when switching tabs or returning from details.

Conversation cards omit the browsing/shared-state footer and the updated date to keep the reading area compact.

Supported quick operations are:

- Native issue state, including GitHub close reason and reopen; GitHub Project Status stays separate.
- GitHub's multiple assignees or Linear's single assignee, and existing labels.
- Native Linear priority; no synthetic GitHub priority.
- Source Markdown checklist items, preserving unrelated lines and protecting unsaved edits.
- Copy native URL/identifier and open the source service.

Options and saves belong to the card's own repository/team even if another panel issue is being browsed. A quick change that removes the issue from a list's filter does not discard the card. A body draft, conflict, or draft read failure must lead to review in details rather than a checklist overwrite.

Free-form title/body editing, comments, relationships, project/cycle/milestone membership, due dates, estimates, custom fields, lists, and bulk operations are outside the card.

Use text, shape, and color together. Preserve source status/label colors where available and use a neutral fallback rather than inventing semantics. Color must not be the sole way to distinguish a state or action.

The utility menu closes on outside pointer or focus movement and when the iframe loses focus, without taking focus from the user's chosen control. Escape returns focus to its trigger. A delayed copy result must not steal focus after the menu has closed.

### Several issues in one conversation result

`arco_show_issues` presents 2–4 explicitly requested issues, in their supplied order, removing duplicate native references. Small rounded tabs show the native identifier and a shortened visual preview of the source title, without a status icon. The full title remains available through the accessible name and tooltip; the native state remains in the tooltip and accessible description. Tabs wrap on narrow cards and support arrow keys, Home, and End.

Selecting a tab stays inline and promptly displays that issue's prepared body, native properties, quick operations, and **Open details**, retaining newer saved values. The leading body image of each issue is prefetched in the background; remaining images load when needed. An image failure does not block the body, properties, or tab navigation. Each issue retains its own reading position when returning to its tab.

GitHub and Linear can appear together without sharing a workflow or synthesizing status values. The group stays attached to its original set when the active issue is opened in details; returning inline restores its selected tab. Tab selection does not attach context or rewrite saved provider preferences or the existing workspace layout. A selection within one tab retains that issue's native reference; a selection across tabs must not attach an arbitrary issue. A failed source read returns an error rather than a partial or broader set.

## Add to chat and annotations

Arco owns context selection and annotations; Codex owns the conversation composer, attachment UI, and sending. Neither browsing a row nor selecting text shares anything automatically.

Whole-issue **Add to chat** labels the attachment with the GitHub repository name and issue number (for example, `Arco #42`) or the native Linear identifier (for example, `ARC-42`). It retains the issue title, source reference, and relevant issue content. Passage sharing includes the selected text rather than silently adding the complete body or comment history.

Selecting text reveals a small **Add to chat** action. Adding it preserves earlier annotations, highlights the passage, gives it a number, and optionally opens a comment editor. Each annotation keeps its own selected text and optional comment. Saving a comment updates that annotation; Escape or outside click discards only the unsaved comment edit, keeping the attachment and marker.

Multiple annotations are shared as numbered content blocks under one group. Codex renders the attachment chips and group. Arco does not copy the host's composer or send a message.

A selection contained within the body or one comment retains that native origin; comment origins include the native comment ID. Other UI text uses a UI origin. Include a minimal issue reference only when the text safely belongs to one issue; a multi-issue selection must not be attached to an arbitrary target.

## Restoration and removal

The originating Arco card restores markers only when their source text and positions still match. A separate new card does not inherit another card's annotations. Changed content or missing positions must not produce guessed highlights.

Removing or replacing Codex context removes its annotation markers. Closing and reopening a card or switching providers must preserve only annotations still attached to that card. Deleted, sent, or replaced context must not be automatically reattached.

## Notifications and recovery

Show a notice when the user needs to act or the current screen cannot show a reliable outcome:

- Failures and limits explain what failed and how to retry or correct it, including authorization, permission, input, upload, and local-storage errors.
- Conflicts and draft protection explain the blocked operation and offer comparison, save, or discard actions.
- Uncertain or incomplete writes distinguish confirmed changes from failed refreshes and explain how to check the source before resubmitting.
- Bulk failures identify failed issues and offer retry only for those targets; successful targets are not resubmitted.
- Pending external authorization explains how to finish in the source application and return. A failure replaces the waiting instruction.

Ordinary successful saves, navigation, sharing, account disconnection, and local-draft persistence do not show completion notices. Their visible result supplies feedback. Copy success changes its button to **Copied**; clipboard failure offers a manual-copy field. Pending work uses loading or disabled controls and content-shaped skeletons. Background refresh and recovery retain loaded content and unsent drafts.

## Responsive behavior and interaction

Respect the host theme. Preserve focus, reading position, and draft input during errors and transitions. Controls remain keyboard accessible with clear focus and useful accessible names; dialogs return focus to their trigger. Narrow layouts must keep content and controls reachable without horizontal page overflow. PiP is outside the product scope.

Eligible action controls use a uniform 1.04 hover scale over 150 ms for fine pointers. Selections, filters, property selects, editing-mode switches, checkboxes, text inputs, issue rows, and reading links do not scale. Disabled or loading controls are excluded. Hover must preserve layout and annotation anchors. Reduced motion disables movement and transitions.

Theme, size, and presentation changes must not trigger provider writes, context sharing, message sending, draft resets, or repeated data loading.
