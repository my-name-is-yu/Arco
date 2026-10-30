# Screen Structure and Conversation Behavior

Arco adapts its layout to the task at hand: it uses an inline card for a single issue, compact inline tabs for a small set of issues, and an expanded workspace for browsing lists or working through full issue details. Regardless of the view, the host application ultimately controls the rendered surface.

---

## Entry Points and Display Intent

Different user requests map to specific entry tools and surfaces:

| User intent                                       | Entry tool and behavior                                                                 |
| :------------------------------------------------ | :-------------------------------------------------------------------------------------- |
| Show a single issue or report its current state   | `arco_show_issue` (requires an explicit native reference) — renders an **inline card**. |
| Show several specific issues together             | `arco_show_issues` (accepts 2–4 native references) — renders **compact inline tabs**.   |
| Explain, summarize, or update an issue via Codex  | Data tools only — no UI panel is opened solely for the AI task.                         |
| View full issue details or click **Open details** | `arco_open_issue` — opens that issue in the **expanded panel**.                         |
| Open the personal issue list                      | `arco_open` (accepts an optional provider) — opens the **expanded workspace**.          |
| Open a GitHub repository's issue list             | `arco_open_project` — opens the **expanded workspace**.                                 |

### Context Separation and Persistence

- **Consistent card behavior:** Both the initial card and any subsequent issue cards follow the same display rules. Long descriptions scroll within the card's compact body rather than using expand/collapse toggles or automatically opening a side panel. Asking for a deeper explanation in chat does not trigger a new screen.
- **Independent targets:** Keep the inline card target, the expanded panel's browsing target, and the shared chat context separate. Displaying a second issue inline must not overwrite the first issue's chat attachment or change what is currently open in the panel.
- **Navigation memory:** Clicking **Open details** on an inline card always opens that specific card's native issue. Even if the user browses to other issues inside the expanded panel, returning to the inline card preserves its original target.
- **Preference stability:** Opening an inline card never overwrites saved source, repository, or team preferences, nor does it automatically switch display modes. However, if a user explicitly specifies a source when requesting a list, that source takes precedence for that launch.

---

## Inline Cards

Inline cards use a single-column layout designed for quick reading and lightweight triage directly within the conversation:

- **Header and metadata:** The top row displays the repository or native identifier, an **Open details** action, and an overflow menu, followed immediately by the issue title. Below the title, state, assignees, labels, and Linear priority sit on a single row that wraps on narrower screens.
- **Scrollable description:** The full source description renders immediately without an **Expand description** or **Collapse description** button. Short descriptions take up their natural height, while longer ones scroll vertically inside a container capped at roughly `190px` (preserving the card's width). The named body region supports keyboard scrolling, text selection, clickable links, and interactive Markdown checklists throughout. Each issue remembers its scroll position when switching tabs or returning from the detail view.
- **Compact chrome:** To keep the reading area focused, conversation cards omit the updated timestamp and the browsing/shared-state footer.

### Supported Quick Operations

Users can perform lightweight updates directly from an inline card:

- **State:** Change native issue state (including GitHub close reasons and reopening). GitHub Project Status remains separate.
- **Ownership and labels:** Update assignees (multiple for GitHub, single for Linear) and apply existing labels.
- **Priority:** Set native Linear priority (GitHub issues do not use synthetic priority).
- **Checklists:** Toggle Markdown checklist items in the description while preserving unrelated lines and protecting unsaved edits. If the issue has an active body draft, a conflict, or a draft read failure, redirect the user to the expanded details view to review rather than overwriting the checklist.
- **Utilities:** Copy the native URL or identifier, or open the issue in the source service.

All available options and save actions stay scoped to the card's own repository or team, even if another issue is being browsed in the side panel. If a quick edit causes the issue to no longer match an active list filter, the inline card remains visible.

> **Out of scope for inline cards:** Free-form title or body editing, comments, issue relationships, project/cycle/milestone membership, due dates, estimates, custom fields, list browsing, and bulk actions all require the expanded workspace.

### Multi-Issue Cards (`arco_show_issues`)

When 2 to 4 issues are requested together, Arco displays them in a single inline card using compact rounded tabs:

- **Tab ordering and labels:** Issues appear in the exact order requested, with duplicate native references removed. Each tab shows the native identifier and a truncated preview of the title (no status icon). The full title remains available through the accessible name and tooltip; the native state remains in the tooltip and accessible description. Tabs wrap on narrow cards and support keyboard navigation (`Left`/`Right` arrows, `Home`, and `End`).
- **Fast switching and image loading:** Selecting a tab stays inline and promptly shows that issue's prepared body, native properties, quick actions, and **Open details** button, reflecting any recently saved changes. Each tab preserves its own scroll position. To keep switching fast, Arco prefetches the first body image of each issue in the background and lazy-loads remaining images as needed. Broken images never block text, properties, or tab navigation.
- **Cross-provider support:** GitHub and Linear issues can coexist in the same tab group without merging workflows or inventing shared status values.
- **Isolation:** Opening the active tab in the expanded details view keeps the inline tab group intact; returning to the card restores the previously selected tab. Switching tabs does not attach context to the chat, alter saved provider preferences, or change the workspace layout. Text selection stays scoped to the active tab's native reference—selections that span across tabs must not attach to an arbitrary issue. If any source read fails, return an error rather than rendering a partial or fallback set of issues.

---

## Expanded Workspace

The expanded workspace combines a filterable issue list with a full detail view for deeper work. On wide screens, properties sit alongside the main content; on narrow screens, properties stack into a single column and the workspace switches cleanly between the list and detail views while preserving active filters, selection state, and scroll position.

### Issue List and Scopes

- **Header controls:** The list header groups the provider selector, visible scope, search bar, state filter, and secondary filters. Use the scope heading and grouped picker to distinguish between project/chat repositories and account-wide views, keeping the chat-specific repository persistence hint inside the picker's tooltip.
- **Default scopes:** Personal GitHub views default to **Assigned to me**, with other account filters available explicitly. Project browsing uses a chat-specific repository selection, while Linear uses its own workspace and team scope.
- **List rows and captions:** Rows retain their native identity and support compatible bulk selection. List captions display item counts and refresh progress without repeating the selected scope or state name.
- **Account connection:** Do not reserve a sidebar footer for account status. Linear connection controls remain accessible from the workspace header at all times, even when a list has no issues.

### Bulk Actions

Both GitHub and Linear share a unified bulk-action panel anchored at the bottom of the sidebar below the scrollable list:

- **Layout:** The panel displays the selected count, a clear-selection action, full-width action and value pickers, and a full-width **Apply** button. Keep the layout clean—do not repeat the selected rows in a target-review disclosure or add a separate heading above the action picker.
- **Provider capabilities:**
  - _GitHub:_ Issue state, labels, assignees, milestone, and issue type. (Custom Issue and Project fields are edited per-issue in the detail view.)
  - _Linear:_ Status, assignee, priority, labels, estimate, and due date.
- **Error recovery:** If a bulk update partially fails, retain clear per-issue failure details and allow retrying only the failed items.

### Issue Details

The detail view prioritizes reading and editing the issue content without stacking secondary controls above the body:

- **Sticky toolbar:** As the user scrolls, the toolbar keeps the native issue identifier visible alongside **Add to chat** and the issue-actions menu.
- **Shared chat indicator:** Context status appears once in the toolbar: **In chat** when the currently viewed issue is attached, or **Chat: [native reference]** when a different issue is attached. GitHub references include the repository name; Linear comparisons preserve connection, workspace, team, and issue identity.
- **Reading and editing:** The issue body and comments form a continuous reading column. This view houses all heavy workflows: free-form title and body editing, comments and replies, project and relationship management, custom fields, and bulk operations. Any unsupported operation links out to the source service.

---

## Visual Semantics and Control Styling

- **Color and meaning:** Combine text, shape, and color so that color is never the sole indicator of state or action. Preserve native status and label colors where available, falling back to neutral tones rather than inventing new color semantics. GitHub's named option colors adapt to the active theme palette, whereas explicit source hex colors remain unchanged.
- **Picker states:** Selection controls render chosen values in the standard body text color. Unset values, unassigned users, unrestricted filters, and **No priority** use muted text (note that an explicit `0` estimate counts as a chosen value). Disabled and loading states maintain distinct visual styling.
- **Icons and badges:** Display available state icons, assignee initials, priority icons, and native color swatches inside both the dropdown menu and the selected value readout. In expanded views, multi-select controls show every selected item's mark; in compact cards, they show the leading item plus an additional count. Keep a single divider between **Labels** and **More properties**.
- **Accessible compactness:** In compact cards and bulk panels, rely on icons, current values, and the selected action name to identify controls visually, but always preserve descriptive accessible names for screen readers when hiding visible labels.
- **Utility menu focus:** The overflow menu closes on outside pointer interaction, when focus moves elsewhere, or when the iframe loses focus—without stealing focus from whatever control the user interacted with next. Pressing `Escape` closes the menu and returns focus to its trigger button. Delayed copy results must never steal focus after the menu has closed.

---

## Keyboard shortcuts

Shortcuts apply only inside the focused Arco surface. Keep Codex and browser shortcuts available; do not take over Command/Ctrl combinations, host tab switching, or host chat navigation.

| Key                      | Action and scope                                                                                                                                                                                         |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `J` / `K`                | Show the next / previous issue. Inline issue sets cycle in supplied tab order. Workspaces use the current filtered, loaded list and stop at its ends; they do not fetch another page or widen the scope. |
| `G`, then `I`            | Go to the issue list. From an inline card, request the expanded workspace. In a narrow workspace, show the list; in a wide workspace, return focus to the current row.                                   |
| `/`                      | Focus the current workspace's search field.                                                                                                                                                              |
| `?`                      | Open keyboard shortcut help for the current surface.                                                                                                                                                     |
| `Escape`                 | Close the nearest active menu, dialog, or selection UI. It does not return from issue details to the list. One press must not also close a containing surface.                                           |
| Left / Right, Home / End | Move among inline issue tabs when a tab has focus, retaining the existing tab behavior.                                                                                                                  |

Character shortcuts do not run during text entry, IME composition, text selection, or interaction with an open menu or dialog. The `G` sequence expires after one second and is cancelled by another key, pointer or focus movement, or leaving Arco. Switching an issue must retain its drafts and reading position, preserve keyboard focus in the reading or tab area, and never share context or send a message.

Keep previous and next issue controls visible beside the current issue in its toolbar or inline card. Use up/down arrows for the workspace list and left/right arrows for an inline issue set. Their tooltips pair the action label with a small `K` or `J` keycap on hover and keyboard focus. The controls remain clickable when character shortcuts are disabled and follow the same list boundaries or tab cycling as the shortcuts.

Use Arco's shared icons, neutral theme colors, and dialog spacing. Keep issue-specific utilities first in the menu, followed by a separated group for the issue list and shortcut help; do not duplicate previous/next navigation there. Show assigned keys at the right edge of action menu rows, and retain the `/` hint in the search field. Render `G`, **then** `I` in tooltips, menus, and help, and separate alternative keys with **or**. Do not repeat shortcut instructions below every tab or in the reading body.

The **Keyboard shortcuts** action is reachable by click from the workspace header, including empty lists, and from an issue's utility menu. Help lists only the relevant surface's commands and conditions, and includes **Enable keyboard shortcuts**, enabled by default and saved in local settings. When disabled, hide inactive character-key hints while keeping the clickable help entry and standard Tab, arrow, Enter, and Escape behavior available. Saving failures remain visible and retryable; disabling shortcuts must not make their settings unreachable.

## "Add to Chat" and Passage Annotations

Responsibilities are split cleanly between Arco and the host: **Arco** owns selecting context and managing inline passage annotations, while **Codex** owns the conversation composer, attachment list UI, previews, removal controls, and message sending. Arco never renders a duplicate attachment list, composer, or microphone button, nor does it send messages on its own. Simply browsing an issue row or highlighting text never shares context automatically.

### Attaching Whole Issues

Clicking **Add to chat** on an issue attaches it using its GitHub repository and number (e.g., `Arco #42`) or its native Linear key (e.g., `ARC-42`). The attachment carries the issue title, source reference, and relevant issue content.

### Attaching and Annotating Text Passages

Highlighting text reveals a floating **Add to chat** button:

1. **Immediate attachment:** Clicking **Add to chat** immediately attaches the selected passage (without silently pulling in the entire issue body or comment thread), preserves any earlier annotations, and opens an optional inline comment field with a check button.
2. **Scoped origins:** If the selection falls entirely within the issue body or a single comment, the attachment retains that native origin (including the native comment ID for comments). Selections from other interface elements use a generic UI origin. Only attach a minimal issue reference when the selection unambiguously belongs to a single issue—never attach a cross-issue selection to an arbitrary target.
3. **Editing and numbering:** Once closed, the highlighted range disappears, leaving an inline numbered marker. Display numbers reflect the current attachment order in the list, independent of the stable internal keys used for editing and position tracking. Clicking a marker reopens its editor with **Remove**, **Cancel**, and **Save** actions, temporarily re-highlighting the passage while open.
4. **Keyboard and focus behavior:**
   - `Command+Enter` / `Ctrl+Enter` saves the comment; `Enter` inserts a newline (IME composition never triggers submission).
   - `Cancel` or `Escape` discards only unsaved edits to the comment, keeping the passage attached and its marker intact.
   - Clicking outside an _empty_ new comment closes the editor; clicking outside a _reopened_ editor cancels unsaved changes.
   - Clicking outside a _non-empty_ new comment preserves the draft and returns focus to the comment field so work isn't lost.
   - If an update fails, the draft remains available for retry.
5. **Host synchronization:** Each annotation appears in Codex as a self-contained block inside the **Annotations** group, titled with a shortened quote of the passage (without a hardcoded display number, preventing stale numbering if items are deleted natively in Codex). The host determines the group's count and presentation.

### Restoring, Converting, and Removing Annotations

Codex's active attachment list is the single source of truth for annotations:

- **Exact restoration only:** An originating Arco card restores inline markers only when both the source text and character positions still match the attached blocks. Opening a separate new card never inherits annotations from an earlier card, and Arco never guesses highlight positions if the underlying text has changed or positions are missing.
- **Syncing deletions:** Removing an individual annotation block in Codex removes its marker in Arco and renumbers the remaining markers. Clearing or replacing the entire group removes all markers. Closing and reopening a card—or switching providers—retains only the annotations still actively attached to that card. Context that has already been deleted, sent, or replaced is never automatically reattached.
- **Legacy format conversion:** If an originating card opens with an older Arco annotation attachment, convert only those annotations whose original visible text and title still match an attached block, stripping out duplicate aggregate copies of selected text and comments in the process. Never reconstruct annotations solely from background metadata or saved offsets. If conversion cannot be confirmed, do not mark the workspace as connected. Finally, any newer native deletion or replacement in Codex always overrides an in-flight update from Arco.

---

## Notifications and Error Recovery

Arco displays notices when user action is required or when the interface cannot otherwise reflect a reliable outcome:

- **Errors and limits:** Clearly state what failed and how to fix or retry it—covering authorization, permission, input, upload, and local-storage errors.
- **Edit conflicts and draft protection:** Explain why an operation was blocked and provide direct actions to compare changes, save, or discard the draft.
- **Uncertain or incomplete writes:** Distinguish between changes that were confirmed by the provider and subsequent UI refreshes that failed, instructing the user how to verify the state in the source app before resubmitting.
- **Partial bulk failures:** List the specific issues that failed to update and offer a retry action scoped strictly to those failed targets without resubmitting successful ones.
- **External authorization:** When waiting on an OAuth or external sign-in flow, explain how to complete the step in the source application and return. If authorization fails, replace the waiting prompt with the error details.

### Silent Successes and Loading States

Routine operations—such as saving changes, navigating, sharing context, disconnecting an account, or auto-saving local drafts—do not trigger completion notices; the updated UI itself serves as confirmation.

- **Clipboard feedback:** Copying changes the button label to **Copied**. If clipboard access fails, present a manual copy text field instead.
- **Loading and refresh:** Represent in-flight operations with disabled/loading control states and content-shaped skeletons. Background refreshes and error recovery flows must never wipe out already-loaded content or unsent user drafts.

---

## Responsive Layout, Motion, and Accessibility

- **Theme and stability:** Match the host application's theme. Switching themes, resizing the viewport, or changing presentation modes must never trigger provider writes, share context, send messages, reset drafts, or re-fetch existing data.
- **Accessibility and layout:** Maintain focus position, scroll position, and draft inputs across errors and view transitions. All interactive controls must be keyboard accessible with visible focus rings and clear accessible names, and closing any dialog must return focus to its trigger. On narrow viewports, all content and controls must remain reachable without causing horizontal page overflow. Picture-in-Picture (PiP) is outside the product scope.
- **Micro-interactions:** On devices with fine pointers, eligible action controls scale uniformly to `1.04x` over `150ms` on hover. Do not apply hover scaling to selections, filters, property dropdowns, edit-mode toggles, checkboxes, text inputs, issue list rows, reading links, or disabled/loading controls. Hover effects must never shift layout geometry or displace annotation anchors, and movement and transitions are disabled when the user prefers reduced motion.
