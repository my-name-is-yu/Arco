# Issue operations

This document defines the issue operations available in Arco. An operation is available only when GitHub or Linear exposes it through its API and the connected user has permission to perform it.

For broader product and security boundaries, see [Product requirements](requirements.md) and [Security and privacy](security-and-privacy.md).

---

## Supported operations (`O01`–`O20`)

Arco organizes issue operations around native provider concepts.

### Browsing and reading

- **`O01` — Select scope**
  - **GitHub:** Select a repository and an existing Project.
  - **Linear:** Select a workspace, a team, and an existing project.
  - **Boundary:** Preserve each provider's native scope; never mix providers into a single workflow.
- **`O02` — List, search, filter, and sort**
  - **GitHub:** Run native issue queries and account filters.
  - **Linear:** Run native issue queries and team filters.
  - **Boundary:** Arco does not maintain an independent issue index.
- **`O03` — Read details**
  - **GitHub:** Read the title, Markdown body, comments, properties, images, and links.
  - **Linear:** Read the same details while preserving comment replies.
  - **Boundary:** Available data is strictly bounded by public API capabilities and the connected account's permissions.

### Creating and editing content

- **`O04` — Create issue**
  - **GitHub:** Create an issue in a chosen repository.
  - **Linear:** Create an issue in a chosen team.
  - **Boundary:** If creation fails, preserve the user's draft so no work is lost.
- **`O05` — Edit title and body**
  - **GitHub & Linear:** Edit Markdown content and checklist items.
  - **Boundary:** Arco does not provide a collaborative editing service or a separate task model.
- **`O16` — Attachments and links**
  - **GitHub:** View existing attachments and insert Markdown URLs. Local file uploads are handed off to the native GitHub UI.
  - **Linear:** View and add URLs, and upload files through the official Linear API.
  - **Boundary:** Arco does not provide file storage.
- **`O17` — Existing simple templates**
  - **GitHub & Linear:** Apply supported body and property defaults from existing templates.
  - **Boundary:** Complex template forms or unsupported template contents must be handled in the upstream service.

### State, assignment, and labels

- **`O06` — Change state**
  - **GitHub:** Toggle Open/Closed state (including the close reason) and update Project Status separately.
  - **Linear:** Change the team workflow state.
  - **Boundary:** Never automatically couple a GitHub issue's Open/Closed state with its Project Status.
- **`O07` — Assign**
  - **GitHub:** Add or remove eligible assignees.
  - **Linear:** Set or clear the single eligible assignee.
  - **Boundary:** Do not invite users or manage access.
- **`O08` — Apply labels**
  - **GitHub:** Apply existing repository labels.
  - **Linear:** Apply existing workspace and team labels.
  - **Boundary:** Adding or removing a label must leave other labels untouched and respect native label-group constraints.
- **`O09` — Manage labels**
  - **GitHub & Linear:** List, create, edit, and delete label definitions within the supported scope.
  - **Boundary:** Label-group administration and moving labels across scopes remain upstream.

### Discussion and reactions

- **`O10` — Comments**
  - **GitHub:** Read and post comments, and edit or delete comments when authorized.
  - **Linear:** Same as GitHub, including replies.
  - **Boundary:** Do not reimplement inline annotations, thread resolution, or AI summaries.
- **`O11` — Reactions**
  - **GitHub & Linear:** Use issue and comment reactions.
  - **Boundary:** Use only the native reaction types provided by each service.

### Attributes, membership, and hierarchy

- **`O12` — Existing attribute values**
  - **GitHub:** Set the issue type, supported organization issue fields, and Project fields.
  - **Linear:** Set priority, estimate, and due date.
  - **Boundary:** Only the specific attribute types listed in [Supported attribute types](#supported-attribute-types) are supported.
- **`O13` — Membership**
  - **GitHub:** Assign issues to existing Projects and an existing milestone.
  - **Linear:** Assign issues to an existing project, project milestone, and cycle.
  - **Boundary:** Do not create or administer membership targets.
- **`O14` — Parent and child issues**
  - **GitHub & Linear:** Create a child issue, or set, change, and remove a parent issue.
  - **Boundary:** No bulk hierarchy editor.
- **`O15` — Issue relationships**
  - **GitHub:** Read, add, and remove blocking relationships.
  - **Linear:** Read, add, and remove blocking and related relationships.
  - **Boundary:** Do not merge duplicate issues or create cross-service relationships.

### Bulk actions, Codex context, and handoff

- **`O18` — Bulk organization**
  - **GitHub & Linear:** Update compatible states, assignees, labels, and existing attribute values across multiple issues.
  - **Boundary:** Bulk operations cannot edit issue bodies, comments, or relationships, manage definitions, or transfer issues.
- **`O19` — Codex context**
  - **GitHub & Linear:** Share whole issues or selected passages with Codex, use mentions, and refresh issue data after tool execution.
  - **Boundary:** Sharing must be explicit; Arco never sends messages to Codex automatically.
- **`O20` — Source handoff**
  - **GitHub & Linear:** Copy an issue or comment URL/identifier, or open it directly in GitHub or Linear.
  - **Boundary:** Always preserve easy access to the upstream service for unsupported native operations.

---

## Supported attribute types

Arco reads and changes values on existing attributes (`O12`). Create or change field definitions, select options, iteration periods, and estimate scales in the upstream service. Arco supports these attribute types:

- **GitHub issue:** An existing issue type.
- **GitHub organization issue fields:** Existing text, number, date, single-select, and multi-select values.
- **GitHub Project fields:** Existing text, number, date, single-select, and iteration values (`Status` is treated as one Project single-select field).
- **Linear:** Priority, estimate (using the selected team's scale), and due date.

> **GitHub field storage:** Organization issue fields and Project fields are stored separately. Fields with the same name can have different definitions; Arco does not synchronize them based on their names.

---

## Inline cards vs. the expanded workspace

Arco splits operations between lightweight inline cards and the full expanded workspace (see [Screen structure](screen-structure.md#inline-cards)):

- **Inline cards** handle reading, toggling checklist items, changing native issue state, updating assignees, applying existing labels, setting Linear priority, and copying or opening native links/references.
- **The expanded workspace** handles free-form title and body editing, comments, project membership and fields, issue relationships, and bulk operations.

### Multi-issue inline tabs

When 2 to 4 issue references are explicitly supplied, Arco removes repeated native references and displays the remaining issues in the supplied order. At least two distinct issues are required. Inline tabs never add unrequested issues or introduce cross-provider actions. Selecting **Open details** opens the active issue in the expanded workspace.

### Safe checklist updates

Toggling a checklist item edits the underlying Markdown line in the source issue. If the issue has a conflicting local draft or its draft state is unavailable, Arco routes the user to review the change in the issue details view rather than silently overwriting work.

---

## Out-of-scope operations and upstream handoffs

Whenever a feature is outside Arco's scope, Arco preserves available links to the upstream service rather than rendering an unsupported feature as a working control.

- **Direct issue operations handed off to the source service:** Issue transfers, deletion/archiving/restoration, duplicate merging, moderation, subscription management, complex issue templates, full history restoration, pull-request review and merging, and CI execution.
- **Broader product capabilities outside Arco's scope:** Administering projects, cycles, milestones, or teams; roadmap planning; time accounting; autonomous triage; notification inboxes; provider synchronization; and generic migration, import, or export.

---

## Write correctness and error handling

Every write operation follows strict validation and state-reconciliation rules (see [Screen structure](screen-structure.md) for UI feedback requirements):

1. **Pre-save validation:** Before sending a write, validate the native source, issue ID, repository or team, and any required Project, field, or option IDs.
2. **Minimal payloads:** Write only the attributes that were explicitly supplied.
3. **Bulk action resilience:** Require compatible target issues and track each issue's outcome. Show failed targets and allow retrying only failures known to be safe to retry. An uncertain result requires checking the source before submitting a new write.
4. **Respect upstream automation:** Leave source-service automation intact. After a write completes, re-read the issue from the source service rather than trying to reproduce or counteract upstream rules.
5. **Clear outcome states:** Distinguish between four outcomes so the user can decide whether to retry the write or refresh the issue:
   - The provider confirmed the write and the issue was re-read.
   - The write failed.
   - The write's outcome is uncertain.
   - The provider confirmed the write, but the subsequent re-read failed.
6. **Idempotency:** Never automatically retry an uncertain mutation with a new request ID.
