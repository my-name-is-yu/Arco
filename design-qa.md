# Design quality checks

Use this checklist when changing Arco's workspace, inline cards, or selection annotations. Run the checks against the built plugin and record which host, provider, theme, viewport, and revision were tested. See [development](docs/development.md) for local commands.

## Compare the complete experience

- Capture the affected view before and after the change at the same viewport and capture density.
- Compare typography, spacing, layout, semantic colors, icons, and copy at native scale.
- Check both GitHub and Linear. Keep provider-native values, identifiers, and workflow meanings intact.
- Exercise narrow layouts around 375-390 CSS pixels as well as a wide desktop workspace.
- Check light and dark themes, keyboard navigation, focus visibility, reduced motion, and touch behavior.
- Distinguish screenshots of the fixture host from actual Codex captures. A screenshot alone does not verify motion, keyboard access, or a successful provider write.

## Inline cards

The card places its native identifier and Open details above the title, then editable properties, then the Markdown description. Long descriptions expand in the document without an inner reading scroll area.

- Preserve Markdown blocks, reference definitions, controlled links, authenticated images, and checklist line identity.
- Expanding or collapsing must preserve focus. Focusing a clipped descendant must reveal that descendant and bring it into view.
- State, labels, assignment, and native Linear priority must save to the card's retained issue even while the workspace browses another issue.
- Preserve request deduplication, conflict detection, draft protection, and cache refresh after saves.
- Keep GitHub issue state independent of Projects status; keep Linear workflow values native to the selected team.
- Verify utility-menu dismissal on outside pointer/focus, iframe blur, and Escape. Delayed clipboard completion must not steal focus after dismissal.
- Keep names visible alongside semantic marks. Invalid provider colors must fall back to neutral decoration.
- Open details must select the exact original native reference. Returning to inline must restore the original card target.

Free title/body editing, discussion history, relationships, advanced properties, and bulk management belong in the detail workspace. See [screen structure](docs/screen-structure.md).

## Selection annotations

Arco owns the source highlights, numbered markers, and optional-comment editor. Codex owns the composer and attachment preview.

- Add several independent body/comment selections; reopen and edit one without changing the others.
- Keep selected text, source identity, and optional comments distinct in the attachment data.
- Test selection replacement, empty/cross-container ranges, exact-anchor restoration, and source navigation.
- Check IME composition, multiline comments, narrow popovers, and clipping inside scroll containers.
- Add, close/reopen, and remove attachments; verify both the host attachment and Arco markers follow the same lifecycle.
- Confirm model receipt separately from a successful bridge response or visible success notice.

## Loading, refresh, and motion

Initial connection, lists, details, and inline cards have different skeletons. Background refresh keeps loaded content and unsent drafts visible. Failure must lead to a usable retry state.

Action controls use restrained hover feedback. Eligible actions scale to 1.04 over 150 ms for fine pointers. Selectable controls, text entry, issue rows, and reading content do not scale. Reduced motion disables movement and transitions. Layout, source ranges, and annotation anchors must remain stable.

Theme, size, and presentation notifications must not trigger provider writes, context sharing, message sending, or draft resets. Check that purely visual notifications do not multiply data reads.

## Evidence records

These are dated development observations, not verification of every later revision:

- [Workspace audit and integration fixes, 2026-10-23](docs/design/ui-audit-2026-10-23.md).
- [Loading and motion, 2026-10-23](docs/design/motion-loading-validation-2026-10-23.md).
- [Hover colors](docs/design/hover-validation-2026-10-23.md) and [hover scale](docs/design/hover-scale-validation-2026-10-23.md).
- [Inline cards, 2026-10-24](docs/design/inline-card-validation-2026-10-24.md).
- [Inline-first presentation, 2026-10-24](docs/design/presentation-policy-validation-2026-10-24.md).

Only selected English fixture screenshots remain in this checkout. Earlier generated mockups and native/reference captures were retired during OSS documentation cleanup. Dated text records preserve their observations and evidence limits. Treat the current source, product scope, and fresh test results as the authority for a proposed change.

## Compact issue tabs — 2026-10-24

Source visual truth: user-selected prototype A, captured in `dist/dev/compact-tabs-source-A.png`, with the subsequent request to make each tab a small rounded control like the native Open control. The requested change intentionally replaces A's rectangular browser tabs; it does not replace the existing issue card or workspace.

Implementation screenshots: `dist/dev/compact-tabs.png` and `dist/dev/compact-tabs-narrow.png`. These generated local artifacts show the fixture host, not actual Codex. Source and implementation captures were opened together for comparison, including the narrow capture. The source is a 527 × 609 content crop from a 583 × 827 CSS viewport; the implementation is a 583 × 593 crop from the same viewport. The narrow capture is 375 × 900. Captures use one image pixel per CSS pixel, without resampling. The source shows the image mock issue; the implementation uses fictional GitHub fixture issues, so identifiers, text, images, and native editable properties are intentionally different. This is a comparison of the requested tab treatment and hierarchy, not a pixel-match claim for issue content.

Full-view and focused comparison: the shared card retains its identifier, Open details, complete title, native properties, and description. The tab region contains 26 px rounded controls, 12 px text, native identifiers, and ellipsized source titles. Full titles remain in accessible names and tooltips. The control region is clearly visible at native scale in the captures, so no additional enlarged image crop was needed. At 375 CSS pixels the document remains 375 pixels wide and both pills remain 26 pixels high; larger groups wrap rather than widening the page.

Required fidelity surfaces:

- Fonts and typography: existing system fonts and card type remain; tabs use 12 px text, restrained weight, and one-line truncation.
- Spacing and layout: small rounded tabs sit above one existing card, with one outer border. Loading skeletons also use that border. The expanded workspace layout is unchanged.
- Colors and tokens: existing light/dark colors, source-native state decoration, neutral borders, and visible focus treatment are reused. Existing inline theme and invalid-color regressions passed; the compact-tab manual captures are dark theme.
- Image quality: no new image assets or image-renderer replacements. The tiny image in the fixture is existing fictional test data and does not validate production image loading.
- Copy and content: native issue identity, full title, status meaning, quick operations, and explicit sharing remain. No source text is rewritten to generate shorter tab titles.

Comparison history and findings:

1. The initial compact-pill capture matched the requested control treatment. Interactive verification found stale tab state after native quick changes: the card refreshed while the still-mounted tab summary did not.
2. Successful GitHub issue mutations and non-reaction operations, and Linear issue-cache refreshes, now invalidate grouped summaries. Fresh browser checks confirmed both providers update the tab status and selection metadata without enabling inactive UI detail queries. The server may still read complete provider issues to prepare presentation summaries.
3. No actionable P0, P1, or P2 finding remained after this fix. Native Codex rendering/reload is a separate, unverified acceptance boundary.

Verification: `npm run check` passed 571 unit/service cases, static and documentation checks, production/fixture builds, the 74-tool smoke, and artifact inspection. The existing CSS optimizer warning for `::highlight` remains. Thirteen compact-tab browser cases, 19 existing inline-card cases, and 20 existing browser smoke cases passed in their respective runs without retries. Checks include exact mixed-provider targets, native quick updates, denied display changes, draft-write failure recovery, issue-specific description expansion, keyboard navigation, and selection attribution. Manual fixture interaction verified tab switching, keyboard selection, pill geometry, and narrow-width layout. The complete browser suite was not rerun.

Implementation checklist: compact controls, target routing, shared-card reuse, source-state refresh, draft/selection protection, responsive layout, and local visual verification are complete for this change. Actual Codex inline observation remains outside this local QA result.

Icon-removal follow-up: the user requested removal of the circle from tabs. Tab status icons and their unused renderer/CSS were removed; native state remains in tooltips, accessible descriptions, selection metadata, and the existing card's controls. `dist/dev/compact-tabs-no-icons.png` preserves the updated fixture tab strip. Type checking, focused lint/format checks, a production/fixture build, and browser DOM/visual inspection passed; the tab strip contains no SVG icons. The broader suite totals above describe the preceding candidate and were not rerun for this presentation-only removal.

Native-host acceptance follow-up: after restarting Codex, the user approved the compact tabs with actual GitHub mock issues #3/#4, actual Linear issues YU-47/YU-46/YU-45, and a mixed group ordered GitHub #3, Linear YU-47, GitHub #4, Linear YU-46. The Arco presentation tools returned those exact native targets. This records user-reported acceptance in Codex rather than independent agent UI inspection; live native quick writes were not exercised. The user selected this tab presentation for multiple inline issues and requested a push. The side workspace remains unchanged.

Push validation: the final candidate without tab icons passed `npm run check`, including 571 unit/service cases and the 74-tool smoke, plus all 13 compact-tab browser cases in 22.9 seconds without retries. The complete browser suite was not rerun for this push.

final result: passed
