# Presentation and conversation design decisions

This document turns the initial 2026-10-22 presentation research into contributor guidance. Historical examples informed the design; current behavior is defined by the source and [screen structure](screen-structure.md).

## Entry point and presentation are separate

An entry point determines how a user starts a workflow. A presentation determines the space the host gives its UI. Arco uses the same application bundle for inline cards and the detail/workspace view, with separate resources and tool metadata.

| User intent                                           | Arco route          | Intended presentation |
| ----------------------------------------------------- | ------------------- | --------------------- |
| Show one identified issue                             | `arco_show_issue`   | Inline card           |
| Open a specific issue's details                       | `arco_open_issue`   | Detail workspace      |
| Open a personal issue list                            | `arco_open`         | Workspace             |
| Open the repository list for the current conversation | `arco_open_project` | Workspace             |

The host chooses the actual presentation. Arco must preserve the returned mode and report a refused request accurately. Picture-in-picture was explored and removed from the product scope on 2026-10-23.

For the upstream concepts, see [plugin extensions](https://developers.openai.com/plugins/build/extensions) and [MCP App UI](https://developers.openai.com/plugins/build/chatgpt-ui). Verify the current host before relying on an API described there.

## Preserve the user's target

The issue being browsed, the issue retained by an inline card, the selected repository/team, and the context attached to a conversation are different state. Browsing another item must not silently retarget an attachment or write.

An explicit native issue reference takes precedence over saved selections. Open details selects that exact reference; returning to inline restores the original card. A read failure must not fall back to the first issue in a list. Host launch must not itself change settings, share context, or send a message.

## Keep context attachment explicit

Arco can pass a whole issue or selected source passages with optional comments. Source identity accompanies the content. Add to chat prepares context; selecting an issue alone does not attach it or start a turn. The Codex composer remains the request editor.

Keep provider comments distinct from AI conversation. A GitHub or Linear comment operation changes the provider record; attaching a passage prepares conversation context. Independent validation is required for each path.

## Use space according to the task

The workspace provides lists, details, advanced properties, discussion, and bulk operations. In a narrow view, list and detail should remain readable rather than forming several cramped columns. Inline cards provide identity, a safe description preview, a few common native operations, and Open details.

Use provider-native status labels and values. Do not synthesize one common workflow across GitHub and Linear, and do not treat GitHub Projects status as the issue's open/closed state.

## Verify capabilities in the actual host

A third-party plugin cannot assume that another app's first-party bridge or private annotation UI is available. Probe the supported integration, then test target retention and the complete attachment lifecycle in Arco itself.

Fixture tests can validate tool/resource metadata, target selection, fallback behavior, and UI state. Native host checks must separately establish actual presentation, composer attachments, model receipt, and restart behavior. See [presentation validation](design/presentation-policy-validation-2026-10-24.md) and [design checks](../design-qa.md).
