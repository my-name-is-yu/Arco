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
