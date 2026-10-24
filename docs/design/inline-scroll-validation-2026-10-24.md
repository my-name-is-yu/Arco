# Immediate inline body scrolling — 2026-10-24

final result: passed

## Selected behavior and implementation

The user selected the comparison prototype's revised A: preserve the existing card width and compact body height, omit Expand/Collapse, and scroll through the complete body immediately. Both GitHub and Linear use the shared `InlineSummaryCard`. Short descriptions retain their natural height; long descriptions use `max-height: 13.6em` at 14px, approximately 190px, with vertical overflow and stable scrollbar space.

The named body region is keyboard focusable. Reading position is saved by issue URL within the host session and restored before paint when revisiting a tab or returning from details. Scroll events update a ref without rerendering or replaying the description fade. The obsolete preview extractor, its unit tests, expansion state, and toggle animation were removed. The existing safe Markdown renderer, task source lines, authenticated image path, source attribution, and detail navigation remain in use.

## Visual evidence

Source visual truth: the selected left-hand A in `dist/dev/inline-scroll-source.png`, copied from the approved comparison prototype before changing production. Source capture is 1280 × 918 pixels from a 1280 × 900 CSS viewport, with 568px cards. Implementation captures are `dist/dev/inline-scroll.png` (583 × 834 pixels at the default 583px CSS width) and `dist/dev/inline-scroll-narrow.png` (375 × 990 pixels from a 375 × 900 CSS viewport). Full-document capture includes content outside the viewport; capture density is one image pixel per CSS pixel. No resampling was used.

The source and implementation images were opened in the same comparison input. This compares the chosen compact reading behavior and retained card hierarchy, not a pixel match across different wrappers. The source is a simulated conversation with simplified properties. The implementation uses Arco's actual fixture host, mixed-provider tabs, native editable properties, and different fixture identities. The same complete mock issue #3 body and title were copied into fixture GitHub #42; the body was also used for fixture Linear YU-42. No real provider issue was changed. Wrapper dimensions and native property wrapping intentionally differ. The body height measured 190px in both wide and narrow implementation views; the narrow document width remained 375px.

Required fidelity surfaces:

- Typography: existing system font, card title styling, safe Markdown typography, and 14px body remain. Native controls retain their existing styles. Line wrapping follows available width.
- Spacing and layout: existing card width, padding, borders, title and property hierarchy remain. The compact body scrolls without changing card height; no toggle or new reading wrapper is visible. A short fixture body measured 24px high.
- Colors and tokens: existing Arco dark tokens, source status/label colors and focus treatment remain. No theme-specific colors were introduced.
- Images and assets: no new imagery, icon replacements, or renderer changes. The comparison content is text-only; production image behavior was not separately exercised in this run.
- Copy and content: the complete source body is rendered from the start, preserving headings, table, code, tasks and END OF MOCK. Expand/Collapse copy and its control are removed.

The full captures make the card hierarchy, controls and body typography readable at native scale. A magnified crop was unnecessary. No actionable P0, P1 or P2 visual issue remained; no visual repair iteration was needed.

## Verification

`npm run check` passed: TypeScript, lint, formatting, 53 Markdown documents and 311 local links before adding this record, 567 unit/service cases, production and fixture builds, the 74-tool smoke, and artifact inspection. The existing CSS optimizer warning for `::highlight` remains.

Manual verification used the in-app browser against the built, fixture-only host on port 4177:

- Both providers expose the complete description immediately and have no Expand/Collapse control.
- End, Home and PageDown navigate inside the named reading region. The full body remains about 190px high; short text stays at its natural height.
- GitHub/GitHub and GitHub/Linear tab changes retain independent positions. Returning from details restores the original inline target and reading position.
- A late task checkbox was changed successfully for each fixture provider.
- Selecting body text offered Add to chat and attached an annotation with the correct native issue and `origin: body`. Its numbered marker hid when scrolled outside the reading area, returned with the source text, and was removed through the annotation UI.
- At 375px, tabs wrap and the document has no horizontal overflow.
- Browser warning/error logs were empty after these interactions.

During the initial implementation pass, the affected browser regression specifications were updated and statically checked but not executed through Playwright CLI. Light theme, touch hardware, image-loading layout shifts and actual Codex inline parent scrolling were not separately observed in that manual run. Subsequent browser execution is recorded under push preparation below.

## Local installation boundary

`codex plugin add arco@arco-local --json` refreshed the existing local cached plugin. The installed `arco.html` SHA-256 matched `dist/plugin/arco.html`. This verifies the cached artifact, not that the current desktop process or an already-rendered card has reloaded it. Restart Codex and open a fresh card to observe the updated installed UI. At the time of this local validation, no commit, push, CI run or remote deployment had been performed.

## Implementation checklist

- [x] Full body immediately available without expansion.
- [x] Existing compact height and width; natural height for short text.
- [x] Keyboard scrolling and issue-specific reading positions.
- [x] Native quick task operations, selection sharing and detail navigation preserved.
- [x] Shared GitHub/Linear implementation and updated regression expectations.
- [x] Local build/checks, manual fixture interaction and cached-plugin refresh verified.

## Footer removal follow-up

The user requested removal of the conversation card's `Browsing` / `Shared issue` label and `Updated` date. The bottom row, its unused shared-state prop, the unused Linear shared-state calculation, and both footer CSS rules were removed. GitHub's empty/error placeholder and the detail workspace are unchanged. Three existing browser assertions were updated to expect no bottom row; no new test case was added for this presentation-only change.

TypeScript, scoped ESLint, formatting, production/fixture build and artifact inspection passed. Manual IAB inspection of both fixture providers confirmed no footer row or time element, with the body still 190px high and no browser warning/error logs. `dist/dev/inline-scroll-no-footer.png` records the result. At this footer-only validation stage, the earlier 567-case run preceded the footer change and the unit and Playwright CLI suites had not been rerun.

## Native acceptance follow-up

After restarting Codex, the user approved both the immediate body scrolling and the footer removal. Fresh Arco presentation calls requested the exact GitHub mock issue `my-name-is-yu/Arco#3` for each check. This is user-reported native acceptance; the automated visual inspection above used the fixture host.

## Push preparation

The final candidate passed `npm run check`, including 567 unit/service cases, the 74-tool smoke, static/documentation checks, builds and artifact inspection. The 40 affected inline-card, compact-tab and hover browser cases were exercised. The first run passed 37 and exposed three test-measurement problems: two motion cases counted a queued initial fade end after animation-finished promises resolved, and the reading-position case rejected a stable 1px end-of-scroll rounding difference. The motion observer now drains two animation frames before installing listeners; the end check allows a 1px difference between integer DOM heights and fractional scrolling. Production behavior was unchanged by these corrections.

The two corrected motion cases passed in a focused run. A subsequent 23-case run passed the corrected reading-position case, both changed footer/navigation cases, and all 20 critical browser smoke cases. Across these runs, all 40 affected browser cases and the 22 additional smoke/navigation cases passed. Fresh type checking, scoped lint and formatting checks passed after the test corrections. The complete browser suite was not run.
