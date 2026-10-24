# Inline-card validation record

Recorded on 2026-10-24 JST. The checks below describe successive development builds. Provider-changing interactions used local fixtures; actual Codex display observations are called out separately. They are not proof of current-revision behavior on every host.

## Layout and description

The card places its native identifier and Open details above the title, then state/assignee/labels, then the existing safe Markdown renderer. The preview keeps complete Markdown blocks and reference definitions rather than cutting raw Markdown inside a fence or list. A long block is clipped without an inner reading scroll area and can be expanded.

An early keyboard test found that a hidden link could remain focusable below the clipped preview. The implementation was changed to expand when a descendant outside the visible preview receives focus and then scroll that descendant into view. The regression check preserved focus and asserted that the description's internal `scrollTop` remained zero.

When the card's issue differs from the workspace's browsing target, property candidates and writes use the retained issue's repository/team and native reference. Save paths retain request IDs, update-time conflict detection, draft protection, and post-save cache refresh.

## Successive recorded results

| Stage                    | Recorded automated evidence                                                                                                                         | Scope limit                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Initial layout           | 365 unit/adapter tests across 32 files; five new inline browser cases plus related target/return/hover cases; build, 71-tool smoke, artifact checks | Manual comparison and writes used fixtures.    |
| Common native operations | Eleven inline cases; 148 of 149 full browser cases, then the remaining old-selector assertion updated and passed alone                              | This was not one all-green 149-case run.       |
| Utility-menu dismissal   | Twelve inline cases, then two focused final regressions after delayed clipboard focus protection                                                    | Full browser suite not repeated at this stage. |
| Property decoration      | Fifteen inline cases; seven related cases initially passed and the remaining image-wait assertion passed after a targeted test repair               | Full browser suite not repeated at this stage. |

Each stage also passed type, lint, formatting, build, smoke, and artifact checks. The existing CSS optimizer warning for `::highlight` remained. Test totals and artifact sizes identify historical builds rather than a standing release guarantee.

## Common operations

The extension added GitHub open/closed reasons and reopen, native Linear workflow and priority, eligible self-first assignment, Markdown checklist updates, and copy/provider-navigation utilities. Unknown GitHub close reasons retain their source meaning; Projects status stays independent. Linear duplicate handling remains in Linear.

Checklist saves update only the target line in the original retained issue body. CRLF, reference definitions, and unrelated lines are preserved. Dirty title/body drafts, draft read errors, or conflicts require resolution in details. Closing or reassigning an issue may remove it from the active list filter but must not remove the retained card.

Free title/body editing, comments/history, relationships, Project/cycle/milestone fields, due dates, estimates, custom fields, and bulk management remain in the detail workspace. See [screen structure](../screen-structure.md).

Independent fixture interaction confirmed persistence after GitHub close, checklist and copy actions, and Linear workflow/priority/checklist saves. Both providers stayed within a 375 px viewport; properties wrapped and the utility menu remained on screen. Browser error logs were empty in that session.

[Historical GitHub utility-menu fixture](references/2026-10-24-inline/operations-github.png), [narrow GitHub](references/2026-10-24-inline/operations-github-narrow.png), and [narrow Linear](references/2026-10-24-inline/operations-linear-narrow.png) show fictional fixture data. These operation captures predate the later property decoration.

## Menu dismissal and focus

Outside `pointerdown`, outside `focusin`, and iframe `blur` close the utility menu without moving focus back from the user's chosen control. Escape and successful in-menu copy retain trigger focus behavior. Clipboard refusal exposes the existing manual-copy field. A delayed clipboard promise must not steal focus if the menu has already been dismissed.

Tests covered outside card clicks, actual taps in the mock host input, Tab navigation, Escape, clipboard refusal, and delayed resolution for both providers. Actual Codex interaction with this dismissal change remained unverified in this record.

## Property decoration

The selected pill and its corresponding menu option use the same source-native decoration:

- GitHub state: green open ring, purple completed mark, neutral not-planned or unknown-closed mark.
- Linear state: native configured color and workflow-type shape.
- Labels: native color dot.
- Assignees: neutral initials or an unassigned person mark; no new avatar image requests.
- Linear priority: native name and bars, with restrained emphasis for Urgent.

Names remain visible and decorations do not change accessible names or SDK search labels. Color input accepts six-digit hex; missing/invalid values produce neutral decoration. Light/dark tokens reach menu portals as well as triggers.

[GitHub fixture](references/2026-10-24-inline/colors-github.png), [Linear fixture](references/2026-10-24-inline/colors-linear.png), and [light 375 px fixture](references/2026-10-24-inline/colors-light-narrow.png) preserve this stage's visual evidence. These screenshots contain only fictional local data and do not show actual Codex.

## Native observations and artifact identity

Built and installed HTML/server hashes matched at each recorded installation. A freshly opened native side panel loaded the dedicated GitHub issue and contained the new inline-card CSS markers. This established installed code loading in that side panel, not direct observation of the conversation card.

After restart, a user report and supplied conversation screenshot confirmed the inline state control, assignees/labels below the title, utilities, and Open details. The original native captures were retired during OSS documentation cleanup; the dated observation is retained here without substituting fixture screenshots for native evidence.

Actual Codex inline writes and description expansion remained unverified. The dismissal and later color/icon changes also needed fresh native interaction/display checks. No provider writes occurred during native display inspection.

Selected historical HTML hashes:

| Stage               | SHA-256                                                            |
| ------------------- | ------------------------------------------------------------------ |
| Initial layout      | `587771518525d07f5a610b98d1df308969ec8e20c12a317c36346e64bfc497da` |
| Common operations   | `9ed130841f436e9b2f115126db58c4e9f0e4579816b426fc6f2602a9915a0e93` |
| Menu dismissal      | `6240a9f07e180494a8229691b12f73ed8b6c3b1240038526d9659fb8040be812` |
| Property decoration | `b56c71f5021ee368443df297d9512519840542bf5478229b77720e4658146ae5` |

The server hash for these stages was `976fe639641b270d56c80268f23f3f15737f7fc11b841b549e096652553131e9`. Later revisions require new checks; these hashes are not current build assertions.

## Motion parity follow-up

Recorded on 2026-10-24 JST against `834507e` plus the working-tree changes. Inline description expansion and collapse now use the workspace's shared 180 ms opacity reveal. The persistent chevron rotates over the shared 150 ms interval. Markdown is not remounted to replay motion, and neither reading content nor its ancestors are translated or scaled.

Action hover remains 1.04 over 150 ms. Select controls keep their geometry; initial card loading, menus, and save notices continue to use the existing shared rules. Rapid toggles update the description immediately while the current reveal completes. Reduced motion skips the reveal and chevron transition; enabling it during a reveal clears that animation state, so restoring the preference does not replay a stale description animation.

Verification:

- `npm run check` passed, including 549 unit/service cases, production/fixture builds, 73-tool smoke, and artifact inspection. The existing CSS optimizer warning for `::highlight` remains.
- All 33 related browser cases passed together without retries in 1.3 minutes, covering inline cards, hover, loading/motion, and selection annotations. The two new provider-specific cases observed actual animation start/end, opacity, shared timing, unchanged text transforms, action/selection hover boundaries, no whole-card replay, and live reduced-motion changes. Existing keyboard auto-expansion and narrow-layout cases also passed. The complete 175-case browser suite was not rerun for this change.
- Manual fixture interaction checked both providers' description controls. This was a local mock host, not the Codex conversation UI; no real provider data was changed.
- Refreshed the existing local plugin with `codex plugin add arco@arco-local --json`. The installed HTML and server matched the candidate SHA-256 values below. This does not establish that an existing Codex card or running server has reloaded.

| Artifact     | SHA-256                                                            |
| ------------ | ------------------------------------------------------------------ |
| `arco.html`  | `3d821d7bba883337957ce20f9d677d1705fb7214dec31be2370034b92025dab7` |
| `server.mjs` | `63831c8d6de5803c0ff518be8a80cbcbf8fbcc96ebd31cfe675a55ce5dd441dc` |

After restarting Codex, the user confirmed that both action-hover enlargement and description expansion/collapse fading worked in the newly requested validation card. This completes the requested native motion check as user-reported evidence; the automation could not directly inspect the inline-only card. This confirmation does not extend native verification to Linear or reduced-motion preference changes, which retain the fixture evidence above.
