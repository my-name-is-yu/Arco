# Inline issue cards QA — 2026-10-24

final result: passed

## Source and implementation

- Selected truth: 「属性を上に・おすすめ」 in `/Users/yuyoshimuta/.codex/visualizations/2026/10/24/01a16bd9-7f4d-7021-a1e8-31aee31cc1ed/arco-inline-layout.html`.
- Source capture: [selected-reference.png](docs/design/references/2026-10-24-inline/selected-reference.png), 620 × 346 pixels.
- Implementation capture: [implemented-collapsed.png](docs/design/references/2026-10-24-inline/implemented-collapsed.png), 680 × 373 pixels.
- Both use the built-in browser at 1280 × 720 CSS px, dark theme, collapsed description, the same Japanese Issue title and body, at 1x capture density. Product-card crops exclude the mock host chrome and carousel stage. No raster rescaling was applied.
- Both complete card crops were opened together in the same comparison input. Text and controls are readable at native scale, so no smaller focused crop is necessary.

## Fidelity review

No actionable P0/P1/P2 differences remain for the selected layout.

- **Typography:** system font, 19px medium title, 14px Markdown body, 12px property labels and secondary text. The existing product's English controls and provider-supplied account names are retained; the selected mock used Japanese controls and a fictional short username.
- **Spacing/layout:** one column; identifier and details action above title, properties directly below title, Markdown separated by a subtle divider. Existing SDK selection pills replace the mock's outlined selectors. Maximum card width is 680px to use the available conversation width. Properties wrap at narrow widths. The compact description expands the card rather than creating an inner scroll area.
- **Colors/tokens:** existing Arco dark/light surfaces, neutral borders and secondary controls. Following the approved operation boundary, the state now uses the shared SDK selection pill, matching the other editable properties.
- **Assets:** no decorative raster assets in the selected card. Existing SDK icons are used for details, utilities and disclosure. Provider Markdown images use the existing authenticated image path.
- **Copy/content:** source-native identifier and body remain intact. Open details, Expand description / Collapse description, Assignees and Labels follow the product's existing English UI. Shared issue / Browsing and the fixture-only footer preserve existing context cues.

## Interaction fixes and evidence

1. Initial keyboard review found that a clipped long first Markdown block could leave a link focusable outside the visible preview. The crop now uses overflow: clip, and focusing a cropped descendant expands the description.
2. The first regression run then found that focus remained below the viewport after expansion. Scrolling the focused element into view after the render fixed this. The focused-link regression now passes, preserves focus, and asserts internal scrollTop remains zero.

Both providers pass Markdown, controlled link, expand/collapse, 375px layout and fixture assignee/label mutation tests. Scope tests retain the original shared Issue while browsing another repo/team and verify that only the retained Issue changes. Existing shared-target/detail-return, host-refusal and hover regressions pass. Manual browser error logs were empty.

- [x] Selected layout and complete-card comparison.
- [x] All five fidelity surfaces.
- [x] Real fixture roundtrips through the stdio MCP.
- [x] Keyboard focus and narrow layouts.
- [x] Local installed artifact matches the build.
- [x] User confirmed that the new inline card with assignee/label controls below its title is visible after app restart. This is user-reported display evidence, separate from the automated side-panel observation.
- [ ] Expand/collapse and provider writes from the actual Codex inline card; fixture checks remain separate evidence.

See [verification details](docs/design/inline-card-validation-2026-10-24.md).

## Approved operation boundary extension

The selected one-column layout now supports GitHub close reasons/reopen, native Linear workflow and priority, Markdown checklist completion, eligible self-first assignment, and a utility menu for native identifiers, URLs and provider navigation. Free title/body editing, comments/history, relationships, Project/cycle/milestone, due dates/estimates/custom fields and list/bulk management stay in details. No nested reading scroll area was added.

- Current fixture captures: [GitHub controls and utilities](docs/design/references/2026-10-24-inline/operations-github.png), 680 × 466; [Linear controls and task completion](docs/design/references/2026-10-24-inline/operations-linear.png), 680 × 451. Both are unscaled product-card crops from the built-in browser at 1280 × 720 CSS px. The earlier selected-layout comparison above remains historical evidence for the initial layout.
- [375px GitHub menu](docs/design/references/2026-10-24-inline/operations-github-narrow.png) and [375px Linear properties](docs/design/references/2026-10-24-inline/operations-linear-narrow.png) remain inside the viewport; document scrollWidth is 375px for both. Properties wrap without an inner scroll region.
- Manual fixture roundtrips confirmed GitHub Closed · Not planned persists with the same card, checklist completion persists, Copy issue ID closes/refocuses the menu, and Linear Done/Urgent/checklist values persist. Browser error logs were empty on the independent verification session.
- The expanded 11-test inline suite covers actual fixture saves, body line/CRLF/reference integrity, state/filter retention, native priority, stale update/retry, utility targets, and local draft protection. A focused read-only peer review found no actionable issues.
- The full browser run passed 148 cases; its only failure referenced the preceding card's removed DOM selector. Updating that identifier assertion to the current card header and rerunning it passed. All 149 cases are covered across those runs; this is distinct from a single all-green full run.
- After the reported restart, the native app panel's DOM style elements contain the operation extension's `.inline-card-actions` and `.inline-card-utilities .detail-utility-menu` markers. GitHub Issue #2 detail loading succeeded; [native panel capture](docs/design/references/2026-10-24-inline/native-operations-after-restart.png). Installed HTML/server hashes still match the build. The API exposes only the side panel. The user subsequently confirmed both new controls are visible and supplied an [actual conversation card screenshot](docs/design/references/2026-10-24-inline/native-operations-inline-user.png), preserved without modification. This verifies the current inline State/menu display. Actual Codex inline interactions and provider writes remain unverified.
- A subsequent user report found that the utility menu required its own trigger to close. Outside pointer/focus and iframe blur now dismiss it without taking focus from the clicked control. Copy fallback and Escape remain usable; delayed copy success cannot restore focus after dismissal. The expanded inline suite passed 12 cases. This dismissal fix is installed locally and awaits the next restart for actual-host interaction confirmation; the screenshot above predates this fix.

## Approved property colors and icons

The existing card layout and neutral selection-pill backgrounds remain. The selected value and corresponding menu option now share the same decoration: native label dots, GitHub semantic state colors and shapes, native Linear workflow color/type, neutral assignee initials or unassigned person, and priority bars with restrained Urgent emphasis. Names stay visible and decorations do not change accessible names or SDK search text.

- Current fixture captures: [GitHub](docs/design/references/2026-10-24-inline/colors-github.png), 680 × 466; [Linear](docs/design/references/2026-10-24-inline/colors-linear.png), 680 × 451. Unscaled card crops from 1280 × 720 CSS px in the built-in browser, dark theme. [State options](docs/design/references/2026-10-24-inline/colors-github-menu.png) and [priority options](docs/design/references/2026-10-24-inline/colors-linear-priority-menu.png) show the same leading visuals as their triggers.
- [Light, 375px card](docs/design/references/2026-10-24-inline/colors-light-narrow.png) uses normal fixture values after Done/Unassigned/Urgent saves. Text remains neutral and readable; colored marks and shapes add recognition. Properties wrap inside the existing card without increasing its maximum width or adding scrolling.
- Typography, spacing, layout, neutral surfaces and source content are retained. Initials are 18px circles; state/person/priority glyphs are 14px; label dots are 8px with a neutral edge. No raster assets or new image requests were added.
- Native color strings are validated; missing/invalid color metadata produces a neutral mark while preserving the name. Light/dark tokens apply at the document root so menu portals share the trigger's semantic colors.
- 15 inline browser cases and 365 unit/adapter tests passed. Eight targeted related cases are verified: seven passed in the first run and a transient image-loading assertion was repaired and passed on retry. The 149-case full suite was not repeated. Manual fixture errors were empty; focused peer review found no actionable issue.
- Installed HTML/server match the current build. These color/icon interactions remain fixture evidence until the updated plugin is loaded after a Codex restart; earlier native screenshots apply to the preceding display build.

## Inline-first presentation policy

The approved card layout stays unchanged. A dedicated `arco_show_issue` tool uses an inline-preferred resource with no sidebar entrypoint. Explicit issue details and workspace lists use fullscreen-preferred tools/resources. The same component bundle supports both presentations, and Open details selects the original card's exact native target.

- [Initial inline result](docs/design/references/2026-10-24-inline/presentation-default-inline.png) was opened in the built-in browser without clicking the mock inline control. The fixture reads actual MCP tool/resource metadata to choose its initial mode.
- [Open details](docs/design/references/2026-10-24-inline/presentation-open-details.png), [returning to the original card after browsing another issue](docs/design/references/2026-10-24-inline/presentation-returned-card.png), and [explicit Linear YU-43 detail entry](docs/design/references/2026-10-24-inline/presentation-explicit-linear-detail.png) preserve exact targets. The unrelated shared context remains separate. These are unscaled 1280 × 720 built-in browser screenshots of the fixture host, not Codex side-panel captures.
- Typography, visual property marks, spacing, width, surfaces and content rendering are unchanged by this policy. No new visual assets were added. Manual fixture error logs were empty, and focused source reviews found no actionable issue in the normal result paths.
- Unit/adapter 399 cases and targeted launch/inline 31 cases passed, along with type/lint/format, build, 73-tool smoke and artifact checks. The final build also passed all 159 browser cases in one run (5.0 minutes), without retries or assertion changes.
- Installed HTML/server match the build. Native tool routing, the host's presentation choice, reuse of an existing panel for an explicitly opened detail, and restart restoration remain separate acceptance checks after restart. See [verification details](docs/design/presentation-policy-validation-2026-10-24.md).

---

# Selection annotations QA — 2026-10-23

final result: passed

## Scope and visual truth

App-owned selection feedback and optional-comment editor match the supplied Codex interaction. The existing Arco workspace is retained. Codex owns the composer and attachment preview; its private annotation editor is not recreated inside the composer.

- Source: `/tmp/arco-codex-reference-20261023/comment.png`, extracted from the supplied 15:14:58 recording (1212 × 556 pixels). Reference controls are normalized from the Mac's 2x capture to CSS-pixel scale. The reference frame is preserved in the full and focused comparison images linked below.
- Additional source: supplied `スクリーンショット 2026-10-23 16.08.43.png`, showing one native annotation group and its item list.
- Implementation: [two retained annotations](docs/design/references/2026-10-23-conversation/08-multiple-annotations-fixture.png), [reopened comment 1](docs/design/references/2026-10-23-conversation/09-annotation-comment-fixture.png), 1176 × 827 CSS pixels at 1x in the built-in browser, dark theme, local fixture host.
- [Full comparison](docs/design/references/2026-10-23-conversation/13-annotation-full-comparison.jpg) and [focused comparison](docs/design/references/2026-10-23-conversation/10-annotation-comparison.png) were opened together for comparison. Page content and viewport differ because the source is the Codex chat and the implementation is the existing issue workspace; only the annotation controls are fidelity targets.
- [Real Arco evidence](docs/design/references/2026-10-23-conversation/11-multiple-annotations-native.png) is the app region of the user's 16:06:40 capture, normalized from 2x. All four selected passages subsequently arrived in this chat as four numbered records.

## Comparison and fixes

The early editor was too wide and inherited Arco's outlined textarea focus treatment. It was reduced to a 300 px pill with a 28 px confirmation button and plain focused text. The revised focused comparison shows the compact control without an inner outline. Blue highlight color was sampled from the reference (`#193d68`).

The final app-owned UI has no actionable P0/P1/P2 visual differences:

- **Typography:** system UI font, 14 px comment text, 20 px line height, 14 px numbered markers. Input grows for multiline text without expanding past the viewport.
- **Spacing/layout:** compact pill, rounded confirmation control, markers next to source ranges, clamped popovers. Scroll-container clipping is respected. Multiple selections in one input have separated, clickable markers.
- **Colors:** reference blue for retained text, blue markers with white border, existing Arco dark/light surface tokens. The small surface-tone difference is intentional reuse of the product's theme.
- **Assets:** SDK Check and Trash icons. There are no decorative raster assets. Trash removes an Arco annotation; no inactive microphone control is shown.
- **Copy/content:** `Add to chat`, `Add an optional comment…`; original source text and user comment remain separate. Numbers stay associated with their own selection when another annotation is edited or removed.

The native composer's annotation-count chip and private annotation editor are host-owned. Arco supplies per-item content, titles and a count group through the public bridge. The user's [16:14:01 capture](docs/design/references/2026-10-23-conversation/15-native-grouped-attachment.png) confirms a `3 annotations · 3` group with three separate numbered titles and comments. Its native item rows show delete controls; they do not show Codex's native annotation pencil controls. The proposed additional Arco annotation list was canceled by the user; existing blue-number editing remains.

## Interaction evidence

Native drag selection, two additions, comments `1つ目`/`2つ目`, saving, reopening comment 1, and both retained ranges were exercised in the built-in browser using the fixture host. The real MCP app first showed four numbered ranges and delivered all four without optional comments. On the final per-item bridge build, three distinct selections arrived with respective comments `1`, `2`, `3`; the same values appeared in visible content and structured data. This confirms the final installed bridge's selection/comment delivery.

Browser checks cover independent comment edits/deletes, whole-collection removal, IME Enter without sending, narrow layouts, same-input selections, native Issue/comment identity, source navigation and exact-anchor restoration, and host context removal/replacement. Page errors and CSP violations are asserted by the browser suite. The fixture results are separate from authenticated native observations.

## Checklist

- [x] Compare source and implementation in combined full and focused views.
- [x] Check all five fidelity surfaces and correct the compact-editor mismatch.
- [x] Verify multiple retained ranges, independent comments and keyboard behavior.
- [x] Verify real MCP delivery of four distinct numbered selections.
- [x] Verify the final per-item attachment grouping and optional comments in the real Codex composer/model input.
