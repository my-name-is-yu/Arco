# Initial view rationale

This document records the browsing principles that replaced the early repository-first proposal. The current behavior is specified in [Requirements](requirements.md), [GitHub discovery](github-account-discovery.md), and [Project viewers](project-viewers.md).

## Personal and project work have different starting points

The global entry opens **My issues** without requiring repository registration. A new personal view shows open issues assigned to the connected user, with explicit alternatives for created issues, mentions, and all account repositories.

The project entry is different: it opens **Project issues**, where the user chooses a GitHub repository if the host cannot identify a usable workspace scope. That choice is remembered per chat and does not change personal filters.

An empty personal view is a valid result. Automatically widening it to all accessible repositories would hide the scope change and can overwhelm contributors who have access to many unrelated projects.

## Principles for list changes

| Principle                       | Consequence                                                                 |
| ------------------------------- | --------------------------------------------------------------------------- |
| Make scope visible              | Every issue keeps its repository or workspace/team identity                 |
| Keep widening explicit          | A filter or repository switch requires a deliberate action                  |
| Preserve source query semantics | Do not substitute participation search for a native account filter          |
| Preserve browsing state         | Retain selection, list position, and filters while opening details          |
| Separate browsing and sharing   | Opening a row or URL does not replace a conversation attachment             |
| Keep progress native            | Display each Project's Status separately from GitHub issue state            |
| Fetch as needed                 | Page summaries and details separately rather than scanning all repositories |

The list can provide multi-selection and compatible bulk actions without introducing a separate workspace model, custom query language, or service-wide mirror.

## Superseded proposals

The 2026-10-22 review initially proposed selecting one repository before showing any issues. Later discovery and launch work replaced that requirement with distinct personal and project entrances. Earlier suggestions to limit personal filters or keep Linear read-only are not current requirements.

Linear has its own connection, workspace/team scope, native workflow, and read/write operations. Shared UI does not justify mixing provider lists or converting their states into a common model.

## Evaluate a proposed change

Check the first run, a legitimately empty personal feed, a user with many repositories, equal issue numbers in different repositories, explicit issue URLs outside the current scope, provider switching, and restoration of an existing chat context. Record fixture behavior separately from authenticated host behavior.
