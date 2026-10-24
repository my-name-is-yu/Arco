# Screen structure and conversation behavior

Arco uses an inline card for a particular issue, compact inline tabs for several explicit issues, and an expanded workspace for browsing and detailed work. Global and chat entries are launch contexts; inline and fullscreen are display modes. The host ultimately controls the rendered surface.

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

Opening a resource does not rewrite saved source/repository/team preferences. An explicit source on a list-opening request takes precedence for that launch. Arco declares resource display preferences but does not issue a mode-change request merely on initialization.

## Expanded workspace

The workspace contains a list and the selected issue's details. The list header groups provider, visible scope, search, state, and secondary filters. Rows preserve native identity and support compatible bulk selection. The personal GitHub view starts with **Assigned to me**; other account filters are explicit. Project browsing uses a chat-specific repository choice. Linear uses its own workspace/team scope.

The details toolbar holds **Add to chat** and an issue-actions menu. Body and comments form a continuous reading area. Properties sit alongside the content when width permits and return to a single-column layout when narrow. Narrow views switch between list and detail while retaining filters, selection, and list position.

Keep body reading prominent; avoid stacking secondary controls ahead of the content. Free-form body editing, comments/replies, project and relationship management, custom fields, and bulk work belong here. Unsupported operations link to the source service.

## Inline cards

The card is one column. Its header shows the repository/native identifier, **Open details**, and an overflow menu; the title follows. State, assignees, labels, and Linear priority appear directly below it and wrap on narrow surfaces.

Descriptions use the shared Markdown renderer and contain the complete source body from first render. The body has a maximum height of 13.6em at 14px (about 190px); short bodies retain their natural height. Long bodies scroll vertically within that area, keeping the card's existing width. There is no **Expand description** / **Collapse description** control. The named body region supports keyboard scrolling, and links, checklists, and text selection remain available throughout the full body. Each issue retains its own reading position in the card's host session.

Conversation cards omit the browsing/shared-state footer and the updated date to keep the reading area compact.

Supported quick operations are:

- Native issue state, including GitHub close reason and reopen; GitHub Project Status stays separate.
- GitHub's multiple assignees or Linear's single assignee, and existing labels.
- Native Linear priority; no synthetic GitHub priority.
- Source Markdown checklist items, using the current save/conflict checks.
- Copy native URL/identifier and open the source service.

Options and saves belong to the card's own repository/team even if another panel issue is being browsed. A quick change that removes the issue from a list's filter does not discard the card. A body draft, conflict, or draft read failure must lead to review in details rather than a checklist overwrite.

Free-form title/body editing, comments, relationships, project/cycle/milestone membership, due dates, estimates, custom fields, lists, and bulk operations are outside the card.

Use text, shape, and color together. Preserve source status/label colors where available and use a neutral fallback rather than inventing semantics. Color must not be the sole way to distinguish a state or action.

### Several issues in one conversation result

`arco_show_issues` presents 2–4 explicitly requested issues, in their supplied order, removing duplicate native references. Small rounded tabs show the native identifier and a shortened visual preview of the source title, without a status icon. The full title remains available through the accessible name and tooltip; the native state remains in the tooltip and accessible description. Tabs wrap on narrow cards and support arrow keys, Home, and End. Selecting a tab stays inline and displays that issue's existing card, including its description, native properties, quick operations, and **Open details**. The server passes its already-fetched full issue records to the app in result metadata while keeping model-facing presentation summaries free of bodies and comments. The app caches all issue details for tab switching, without rendering inactive issue workspaces or replacing newer cached revisions. The leading body image of each issue is prefetched in the background; remaining images load when needed. The compact body scrolls immediately and restores each issue's own reading position when returning to its tab.

GitHub and Linear can appear together without sharing a workflow or synthesizing status values. The group stays attached to its original set when the active issue is opened in details; returning inline restores its selected tab. Tab selection does not attach context or rewrite saved provider preferences or the existing workspace layout. A selection within one tab retains that issue's native reference; a selection across tabs must not attach an arbitrary issue. A failed source read returns an error rather than a partial or broader set.

## Add to chat and annotations

Arco owns context selection and annotations; Codex owns the conversation composer, attachment UI, and sending. Neither browsing a row nor selecting text shares anything automatically.

Whole-issue **Add to chat** retains the source reference and relevant issue content. Passage sharing includes the selected text rather than silently adding the complete body or comment history.

Selecting text reveals a small **Add to chat** action. Adding it preserves earlier annotations, highlights the passage, gives it a number, and optionally opens a comment editor. Each annotation has its own `selection.text` and optional `selection.comment`. Saving a comment updates that annotation in the grouped context; Escape or outside click discards only the unsaved comment edit, keeping the attachment and marker.

Multiple annotations are shared as numbered content blocks under one group. Codex renders the attachment chips and group. Arco does not copy the host's composer or send a message.

A selection contained within the body or one comment retains that native origin; comment origins include the native comment ID. Other UI text uses a UI origin. Include a minimal issue reference only when the text safely belongs to one issue; a multi-issue selection must not be attached to an arbitrary target.

## Restoration and removal

The same Arco card can restore marker positions from the host context's snapshot UUID and local matching positions. Do not promise that a separate new card inherits another card's model context. Changed content or missing positions must not produce guessed highlights.

Removing or replacing Codex context removes its annotation markers. Local position snapshots must not resurrect deleted/sent/replaced context or automatically reattach it. Verify add, comment edit, close/reopen, provider switching, and attachment removal as one lifecycle.

## Responsive behavior and evidence

Respect host theme and reduced motion; preserve focus and draft input during errors and transitions. Skeletons should reflect the content being loaded. PiP is outside the current product scope.

Fixture screenshots and browser tests verify the mock host. Installed-plugin protocol checks and real Codex rendering/composer receipt are separate evidence. See [Design QA](../design-qa.md), [implementation status](implementation-status.md), and [presentation validation](design/presentation-policy-validation-2026-10-24.md).
