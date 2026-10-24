# Hover color validation

Recorded on 2026-10-23 on macOS with Node 24.22.1. This is evidence for that development build, not a fresh check of the current revision. No provider writes or real conversation attachments were made during these checks.

## Behavior reviewed

Custom buttons, links, disclosures, issue rows, state controls, chips, reactions, Markdown links, and annotation markers received a common 150 ms hover color treatment. Inputs used border feedback; checkboxes and radios used a small ring. Search and annotation editors avoided duplicate inner borders.

SDK buttons, selects, and portalled options retained their existing feedback. Hover did not change values, selected colors, layout dimensions, source text positions, or keyboard focus outlines. Disabled, loading, inert, and hidden controls were excluded. Fine-pointer hover was required; reduced motion removed transitions while retaining immediate color feedback.

The subsequent [hover-scale change](hover-scale-validation-2026-10-23.md) added movement only to eligible action controls.

## Native and fixture observations

A freshly opened installed Arco view showed the new hover tokens and 150 ms transitions, while preserving issue content, selection, and existing drafts.

In the fixture host, actual pointer movement and intermediate computed styles were checked for filters, search, and checked Markdown tasks. The selected/checked state remained intact and geometry did not move.

The original screenshots were retired during OSS documentation cleanup. Pointer interaction and computed styles supplied the recorded timing evidence; those observations were not inferred from static images alone.

## Recorded automated results

- Type checking, lint, formatting, build, smoke, and artifact checks passed.
- Unit/adapter tests: 185 across 21 files; smoke: 68 tools.
- Browser tests: all 93 scenarios passed together, including six hover scenarios, page-error checks, and CSP checks.
- Coverage included both providers, SDK controls, selected state, dimensions, disabled controls, file/date/color inputs, annotations, light theme, keyboard focus, reduced motion, and touch.
- Built HTML: 1,624,642 bytes, SHA-256 `07c13aef8cbaea0c5d67ed215b010aba7746a31e8ed5100903e9c220682e35f3`; the installed copy matched.

These counts and hashes identify the recorded build only. Re-run relevant checks for any new change.
