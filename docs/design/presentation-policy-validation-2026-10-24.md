# Inline-first presentation validation

Recorded on 2026-10-24 JST. This page preserves implementation and fixture evidence for the presentation-routing change, followed by a source-specific list-launch extension. It does not establish actual Codex routing after every later restart or update.

## Presentation contract

Showing a single identified issue uses an inline card. An explicit request for details or a list opens the workspace. Description length or a request to summarize/update an issue does not by itself open a panel. See [screen structure](../screen-structure.md).

| Tool                | Intent                                                     | UI resource and preference     |
| ------------------- | ---------------------------------------------------------- | ------------------------------ |
| `arco_show_issue`   | Show one native issue                                      | `ui://arco/issue-card`, inline |
| `arco_open_issue`   | Explicitly open that issue's details                       | `ui://arco/issues`, fullscreen |
| `arco_open`         | Explicitly open the personal list/workspace                | Global entry point, fullscreen |
| `arco_open_project` | Explicitly open the conversation repository list/workspace | Thread entry point, fullscreen |

The two issue-display tools require a strict provider-native reference, verify returned identity and membership, and fail on read errors or mismatched targets. They do not share context or mutate the issue. They do not substitute the first saved-list issue for an unresolved target.

Separate card and workspace resources serve the same HTML bundle. Both declare inline/fullscreen support so Open details can request the other presentation for the exact target. The show tool has no global/thread entry point.

## Launch and state boundaries

The first valid launch initializes an instance. An explicit target takes precedence over attached context. Source, repository/team, and issue selection initialize locally without overwriting saved settings or Codex context. A targeted inline result does not fetch unrelated issue lists, discovery data, or another shared issue. Linear uses the target's connection and rejects a workspace mismatch.

Open details selects the retained card's exact native reference before requesting presentation. Browsing another issue in details and returning to inline restores the original card. A later result from another display tool must not silently replace an existing instance's launch target. Initial errors terminate loading and can recover on a subsequent valid launch.

Arco does not request a mode change automatically at bootstrap. Actual host presentation and restored-panel behavior remain host decisions.

## Initial recorded checks

- Type, lint, formatting, and 399 unit/adapter cases across 33 files passed.
- New MCP-client checks covered tool/resource preferences, entry points, strict provider identity, membership mismatches, mixed/invalid inputs, and provider errors.
- Host tests covered initialization, retained shared context, later-result isolation, initial error/recovery, and absence of automatic setting/context writes.
- All 31 targeted launch/inline browser cases passed. The fixture used actual `tools/list` and `resources/read` metadata to choose its initial mode rather than hardcoding inline success.
- Build, 73-tool smoke, two UI resources, mention resources, fixture save/dedup, and artifact checks passed.
- All 159 browser cases passed together in the final initial-stage run, without retries or assertion changes. The existing CSS optimizer warning for `::highlight` remained.

Manual fixture checks opened the requested GitHub issue inline without clicking a mock presentation control, opened that same issue's details, browsed another issue, and returned to the original card. A separate Linear launch opened the explicitly requested issue rather than the first list item. Unrelated attached context remained unchanged and browser error logs were empty. No real provider issues were changed.

Historical fixture screenshots for this routing work were retired during OSS documentation cleanup. Current retained inline-card examples are linked from [the card record](inline-card-validation-2026-10-24.md); they are not replacements for these routing observations.

## Source-specific list launch extension

`arco_open` gained optional `source: github | linear`. Explicit source takes precedence over a saved or shared opposite-provider selection; omitted source keeps the prior behavior. A Linear launch checks the Linear connection and does not require GitHub authentication.

The host waits for a valid server launch instead of inferring all launch state from an entry-point name. Initial source precedence is target, explicit source, then shared/saved selection. The explicit initial choice does not prevent later manual source switching.

The extension passed 411 unit/adapter cases across 33 files, including 37 MCP presentation-contract cases and 33 host cases. All 33 targeted launch/inline browser cases passed, plus build, 73-tool smoke, and artifact checks. The earlier all-159 run predates this extension; the resulting 161-case suite was not run in full for this recorded step.

## Installation evidence and remaining limits

Built and locally installed HTML/server hashes matched at each stage:

| Stage                     | HTML SHA-256                                                       | Server SHA-256                                                     |
| ------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Initial policy            | `a0a5c98e396514f66f97f23a0cc5a64b8a05f3c516a2906b2bc8b96e59d3a85a` | `86ed942873333928455060a99cd8d89159563d7f25dd1760d7d1c62700fc92df` |
| Explicit-source extension | `b1a490e38bbdba245ab53e028c89bee0cfd0d5122db238fef95ea2d47830a6cd` | `2cff70a03b67882f9ca4d885b74b9a5d732e6e825861454bfbeae0e05020a269` |

HTML sizes were 1,661,409 and 1,661,392 bytes respectively. These identify historical artifacts only.

Actual natural-language tool selection, host acceptance of the inline preference, explicit-target behavior when reusing an existing native panel, and restart restoration remained separate native acceptance checks. Fixture success, an installed hash match, and an actual conversation-card interaction are different evidence.
