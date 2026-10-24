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
