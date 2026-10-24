# Hover scale validation

Recorded on 2026-10-23 on macOS with Node 24.22.1, after the [hover color work](hover-validation-2026-10-23.md). This record describes that build and its follow-up audit.

## Interaction boundary

Eligible actions use a uniform `scale(1.04)` over 150 ms: annotation markers, icon actions, reactions, removable property chips, menus, and create/save/post/share/copy/retry/cancel/detail/pagination actions. For disclosures, scale the heading content rather than the full-width hit area.

Selections, filters, property selects, editing-mode switches, checkboxes, text inputs, issue rows, and reading links do not scale. Hover preserves layout dimensions and annotation anchors. Disabled/loading/inert/hidden controls are excluded. The effect requires a fine pointer; reduced motion disables scale and transition.

Current implementation entry points include [motion.css](../../src/ui/motion.css) and [DisclosureSummary](../../src/ui/DisclosureSummary.tsx).

## Observed geometry

| Fixture action         | Visual change            | Preserved behavior                                        |
| ---------------------- | ------------------------ | --------------------------------------------------------- |
| Add to chat            | Width 96.55 to 100.41 px | Layout stayed 97 by 28 px; returned on pointer exit.      |
| Annotation number      | 30 to 31.2 px            | Lower-left anchor and source-range geometry stayed fixed. |
| Filters heading        | Width 56.73 to 59.00 px  | Full disclosure area stayed 261 by 30 px.                 |
| Source select          | No scale                 | Width 87.90 px and height 28 px; normal source switching. |
| Linear reaction action | 30 to 31.2 px            | Layout stayed 30 by 28 px.                                |
| Annotation trash/save  | 28 to 29.12 px           | Layout stayed 28 px; glyph 18 to 18.72 px.                |

Actual pointer movement, transition values, intermediate/final styles, and restoration were inspected. Static images alone were not treated as motion proof.

The original screenshots were retired during OSS documentation cleanup. The native view confirmed the installed tokens and ordinary issue display. Detailed pointer measurements and annotation deletion used fixtures; real provider data and conversation annotations were not changed.

## Audit and recorded checks

The source audit counted definitions rather than rendered controls: 96 native buttons, 51 SDK buttons, 25 disclosures, 45 select components, and 49 input/textarea definitions. Reading, selection, and text-entry exclusions were intentional. SDK Markdown copy actions were included; select portals and provider-content links remained excluded.

An older open native tab still had color-only feedback while a newly opened tab had the scale token. A freshly reopened view confirmed the updated build. The audit did not determine which tab had been visible in the original report.

Recorded results:

- `npm run check` passed, including 185 unit/adapter tests across 21 files, build, 68-tool smoke, and artifact checks.
- All 93 browser scenarios passed together before the follow-up test-only audit.
- Six strengthened hover scenarios then passed, collecting 101 hover observations. A rendered-control audit covered 42 native button/disclosure targets across the workspace, action menu, and creation dialog.
- Trash/save checks covered scale, 150 ms timing, restoration, layout stability, pending disabled state, reduced motion, touch, and actual tap behavior.
- The follow-up changed tests only; the full 93-scenario suite was not rerun at that stage.

Built HTML: 1,626,048 bytes, SHA-256 `7188696e5c942c0b329d815d78071a110d078f57540341515cc7ff3c2d30f026`. Server SHA-256: `5f83f4bafe8aa2d4fcaa6a391f9ed61dff5643089a8ef5c5d0ea431f2672ee59`. Installed files matched at the time. These historical hashes do not identify later builds.
