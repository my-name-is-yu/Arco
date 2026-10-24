# Code Review design reference

Research recorded on 2026-10-22 and revisited on 2026-10-23. This page explains the design observations behind Arco; it is not an API contract or a dependency on Code Review.

## Sources and limits

The original study used the [public Code Review guide](https://learn.chatgpt.com/docs/code-review), a supplied reference screenshot, and observations of a locally installed Code Review distribution. That installed distribution is not part of this repository, so machine-specific source links have been removed. The supplied third-party screenshot was also retired during OSS documentation cleanup.

The screenshot demonstrated hierarchy and density. It did not establish that third-party plugins can use the same host sidebar or internal conversation bridge. Private host RPCs observed in another plugin are not Arco integration points.

## Design observations

| Observation                                                                    | Application in Arco                                                                       |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| A personal inbox gives a relevant starting point across repositories.          | Start My issues with Assigned to me; expose broader scopes explicitly.                    |
| Compact toolbars separate content navigation from actions.                     | Keep primary issue actions discoverable and put utilities in an overflow menu.            |
| Repository, number, state, title, author, and time have distinct visual roles. | Preserve source identity without letting metadata overwhelm the description.              |
| Wide views place secondary information beside the body.                        | Keep readable detail content; move properties into a single column when space is limited. |
| Preparing context and starting a conversation are separate actions.            | Add to chat attaches context; the normal Codex composer remains the place for a request.  |
| Semantic surfaces and restrained controls support dense reading.               | Use theme tokens, subtle dividers, neutral controls, and small semantic marks.            |

These are design choices, not a requirement to reproduce the source product. GitHub issue state remains distinct from Projects status, and Linear retains its own workflow semantics.

## Host boundary

Arco renders its list and details inside its own MCP App. It uses its implemented public bridge for context and presentation. A first-party plugin's ability to populate a native host sidebar does not establish that Arco can do so.

Validate the complete host flow after changing an integration: open a specific issue, attach context, browse another issue, return to the retained target, and remove the attachment. Keep model receipt and provider-write verification separate from visual similarity.

## Historical concepts

The [first concepts](design/image-prompts.md) and [Code Review-inspired concepts](design/code-review-image-prompts.md) are generated explorations from 2026-10-22. They are not product screenshots. Their picture-in-picture proposals were abandoned on 2026-10-23; current Arco uses inline cards and the detail/workspace presentation.

Use [screen structure](screen-structure.md), [product scope](product-scope.md), and the [design checks](../design-qa.md) when implementing current behavior.
