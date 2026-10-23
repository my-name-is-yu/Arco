# Code Reviewを参考にしたArco画面案

作成日: 2026-10-22
生成方法: 組み込みImage Genツール。4回の独立した生成。
状態: 未実装の画面構成案。画像はCodexの実機動作を確認した結果ではない。

2026-10-23追記: PiP案はユーザー希望により採用を取り消した。以下は当初の構想の記録である。

## 参照と変更点

- [ユーザー提供のCode Reviewスクリーンショット](references/code-review-user-reference.png)を4回すべての生成へ添付した。
- ダークテーマ、左の縦一覧、本文を広く取った詳細、補助情報列、小さなツールバーと中立色のボタンを参考にした。
- 会話横・inline・PiPには、最初のArco管理画面案もスタイルと架空Issueデータの参照として添付した。
- 実際のPR本文やリポジトリ名をmockデータへ複製せず、架空の`yu/Arco #42 Issueを会話へ渡す`を使用した。
- 各表示はCode Reviewそのものの再現ではなく、参考画面をArcoの目的へ展開した案。Open／ClosedとProjectsのStatusを分ける。
- Code Reviewのホスト専用sidebar操作を、第三者pluginの公開APIで再現できるとは扱わない。
- [初稿4枚](image-prompts.md)は比較用として保持する。

[公開docsと公式ソースの調査](../code-review-reference.md) / [Code Review公式docs](https://learn.chatgpt.com/docs/code-review)

## 1. 広い管理画面

[画像](images/wide-management-v2-code-review.png)

参照画像: `references/code-review-user-reference.png`。

### 生成プロンプト

```text
Use case: ui-mockup. Create ONE high-fidelity desktop UI concept for Arco's WIDE MANAGEMENT / FULLSCREEN view, based closely on the attached user-provided OpenAI Code Review screenshot. Target 1536 x 1000, matching its desktop aspect ratio. Flat front-on screenshot, app content and titlebar only, no macOS menu bar, no device mockup.
INPUT IMAGE ROLE: actual visual reference for dark theme, type scale, spacing, density, navigation, compact toolbar, pill controls, dividers and native composer. Preserve this design language closely. Replace all actual account/repository/PR content with the fictional Arco Issue data below. No claim of actual working software: tiny caption "Arco · 構成案" at bottom edge.

Use the reference's charcoal #181818 content, subtly lighter #212121 sidebar, #323232 titlebar, soft near-white text, muted gray secondary text, hairline dark dividers. Rounded pill toolbar controls, white primary button with dark text. Small semantic blue/green status icons only; no large blue buttons, no gradients, no dashboard cards, no invented illustrations, no GitHub logo for Codex or Arco. Plain "Arco" wordmark. Native system sans, readable Japanese. Regular body about 14–16px, compact controls 13px, secondary text 12px. Main title around 25px. No marketing headline.

Layout:
Retain a very narrow far-left host icon rail and restrained native top titlebar similar to the reference. All Arco navigation and Issue content is INSIDE its app area, not a claim of publicly controlling the native host sidebar.
Arco's left navigation pane around 275px wide: heading "Arco", subtle Project dropdown "My work", rounded search field "Issueを検索 / URLを貼り付け", scope label "自分の担当", and about seven compact two-line issue rows. Active row has a rounded dark gray fill, not bright blue. Each row has short title and small repo/#number. Small pin section for saved issue. This is a vertical issue list, not a wide table.
Large main detail pane. Compact 42px top toolbar with pill tabs "概要" and "アクティビティ" on left. On right: pin, copy-link, GitHub link icons, a small quiet "編集" control and white primary button "会話へ追加". No oversized CTA at bottom.
Detail heading: small "Open" pill followed by "yu/Arco #42"; title exactly "Issueを会話へ渡す"; author row with generic initial avatar "yu" and muted recent timestamp. Do NOT reuse the photo or actual PR content from the reference.
Main readable body occupies central wide region; secondary metadata in a slim right rail around 245px, with flat sections and thin dividers, not cards.

Fictional data: Project "My work", repo "yu/Arco", Issue #42, assignee "yu", label "enhancement", GitHub Issue state "Open", Project Status "In progress".
Body:
heading "やりたいこと"
"選択したIssueをCodexの会話に追加する。本文・ラベル・ProjectのStatusを引き継ぐ。"
heading "受け入れ条件"
three bullets: "選択したIssueを確認してから会話へ追加できる", "一覧で別のIssueを見ても会話の対象は変わらない", "添付と依頼の送信を分ける".
Below, "コメント" with one short entry from yu: "まずはIssue本体を渡せれば十分。"
Right metadata rail: "進捗" then "In progress"; "担当者" yu; "ラベル" enhancement; "Project" My work. Keep Open and Project progress distinct.
Other left list items: "#43 ラベルを一括編集する", "#44 検索条件を保持する", "yu/nest #18 設定画面を整理する", "#45 キーボード操作を整える", "#46 コメントを会話へ渡す".
Retain the reference-style native host composer at bottom centered under detail, placeholder "このIssueについて相談する…", with small plus and send controls. No extra AI chat panel inside Arco.
Make the whole frame feel like a professional native companion to the supplied Code Review screenshot, with calm density, broad readable content, and few small controls.
```

## 2. 会話横パネル

[画像](images/conversation-panel-v2-code-review.png)

参照画像: `references/code-review-user-reference.png`、`images/wide-management-v2-code-review.png`。

### 生成プロンプト

```text
Use case: ui-mockup. Create ONE Arco CONVERSATION SIDE-PANEL concept in the exact calm dark-native design language of the provided references. Target 1536 x 1000, front-on desktop app screenshot, no desktop menu bar.
Reference 1 is the actual user-provided OpenAI Code Review screen: follow its charcoal surfaces, subdued type hierarchy, small pill toolbar, neutral gray/white actions, subtle dividers and rounded native composer. Reference 2 is Arco's proposed wide management screen: keep the same fictional Issue and Arco-specific content. Completely recompose for a chat plus side-panel layout. Do not copy any real repository names, PR descriptions or avatar photos from reference 1.
This is a conceptual screen, not a working app capture; tiny caption "Arco · 構成案".

Palette: #181818 main content, #212121 secondary surfaces, #323232 titlebar, off-white primary text, gray secondary text, hairline separators. Main buttons are compact white pills with dark text; secondary actions are quiet gray or ghost. No large bright blue CTA, no decorative gradient, no dashboard cards. Native system Japanese text, body 14–16px, labels 12–13px. Plain text Arco identity, no GitHub logo standing for Codex.

Layout: narrow host icon rail at far left, slim dark native titlebar at top. Main left region around 960px is an ordinary Codex conversation with comfortable text width. Right region around 460px is the Arco Issue panel, separated by one subtle divider. NO full-height issue list in this view.
Chat heading "Issueの仕様を相談". A short user message "このIssueの受け入れ条件を一緒に詰めたい。" and concise Codex reply "Issueの選択と、会話への添付を分ける形がよさそうです。". Keep ample whitespace, do not fill with code.
At the bottom of chat column, use the reference-style native rounded composer. Include a small context chip "yu/Arco #42", placeholder "このIssueについて相談する…", plus and send icons. No separate AI input in Arco.

Arco right panel: small header "Arco" with back-to-list, expand and close icons. Compact tabs "概要" / "アクティビティ" below, and a small white "会話へ追加" action in its toolbar.
Selected detail: small green "Open" badge and muted "yu/Arco #42"; title exactly "Issueを会話へ渡す".
Project progress is separately labeled "進捗 · In progress". Compact properties show "担当者 yu" and label "enhancement", with no separate right-hand metadata rail inside the narrow panel.
Body paragraphs:
"選択したIssueをCodexの会話に追加する。"
"本文・ラベル・ProjectのStatusを引き継ぐ。"
A small "受け入れ条件" section with two bullets "添付するIssueを確認できる", "添付と依頼の送信を分ける".
Section "GitHubコメント" with one entry by generic initial avatar yu: "まずはIssue本体を渡せれば十分。"
Subtle "GitHubで開く" link as secondary action. No giant bottom button.
The key is the actual Code Review-like restrained density and native integration, while the user can read one Issue beside the chat.
```

## 3. 会話内カード

[画像](images/inline-card-v2-code-review.png)

参照画像: `references/code-review-user-reference.png`、`images/wide-management-v2-code-review.png`。

### 生成プロンプト

```text
Use case: ui-mockup. Create ONE conceptual Arco INLINE RESULT CARD embedded in a Codex conversation. Target 1536 x 1000, front-on desktop app composition. Use the actual Code Review screenshot (reference 1) for dark native visual language and the new Arco wide screen (reference 2) for consistent fictional Issue identity. This is a new view composition, not the wide app shrunk down.
Preserve reference's #181818 canvas, #212121 muted surfaces, dark gray hairline dividers, near-white typography, low-contrast secondary text, compact neutral pill controls and rounded native composer. NO light theme, no bright blue primary buttons, no gradients or large shadows. No GitHub mark used for Codex identity. System font with crisp readable Japanese. Tiny caption "Arco · 構成案" outside active content. Mock date October 22, 2026; do not reproduce actual private PR text or author photos.

Scene: thin native titlebar and a narrow far-left host icon rail. The rest is a normal spacious dark conversation titled "Issueの相談". No Arco issue-list sidebar and no right detail pane.
One user turn: "Arcoの #42 を見せて". Below it, a small tool-result heading "Arco", then one compact in-flow card around 720px wide and 230–260px tall. Its border is thin dark gray and corners gently rounded, like a modest native surface rather than a large dashboard panel.
Card hierarchy:
small muted "yu/Arco #42" and small green "Open" state;
medium title exactly "Issueを会話へ渡す";
secondary row "進捗 In progress" and a quiet "enhancement" label;
summary "選択したIssueをCodexの会話に追加する。";
bottom row with small white pill "詳細を開く" and quiet ghost action "会話へ追加".
Only a summary and these two actions. No editable property forms, no tabs, comments feed, internal scrolling, tables or other Issues.
After the card, an ordinary short Codex response: "本文やコメントは、詳細を開いて確認できます。"
At bottom, reference-style native composer with placeholder "Codexにメッセージを送信…", plus icon, compact controls and white send circle. No separate app chat input.
Card text should be comfortably readable while the card remains clearly one message within the broader conversation. The hero use case is reviewing one fetched Issue and deciding to open or attach it.
```

## 4. PiP

[画像](images/pip-companion-v2-code-review.png)

参照画像: `references/code-review-user-reference.png`、`images/wide-management-v2-code-review.png`。

### 生成プロンプト

```text
Use case: ui-mockup. Create ONE Arco PICTURE-IN-PICTURE concept. Target 1536 x 1000, front-on dark desktop app composition. Reference 1 is the user-provided OpenAI Code Review screen: use its restrained dark palette, thin separators, compact neutral controls, type density, small icon rail and native pill-shaped composer. Reference 2 is Arco's new management concept: use its fictional Issue data and visual identity. Recompose as a small FLOATING companion over a normal conversation, not a full-height side panel.
This is a proposed Arco UI, not an actual host screenshot. Small unobtrusive caption "Arco · 構成案". No actual PR content, account names or avatar photos from the reference. Use a simple letter A if Arco needs an icon; never use the OpenAI logo for Arco.

Dark style: #181818 chat canvas, #212121 floating surface, subtle #343434 border and a soft compact shadow for PiP only; near-white text and muted gray metadata. Compact neutral or white pill controls. No bright blue CTA, gradients, data dashboards, timers, agent execution monitor or Symphony.
Text should be native Japanese system sans, 14–16px body and 12px secondary text.

Layout: slim native app titlebar at top, narrow host icon rail far left, spacious ordinary Codex chat in the remaining region. Chat heading "Issueの実装を相談".
User message "本文を確認して、実装方針を決めたい。"
Short Codex answer "まず、Issueの選択と会話への受け渡しを分けましょう。"
Keep conversational content readable toward the center-left and open space on right. Bottom native rounded composer includes the context chip "yu/Arco #42", placeholder "このIssueについて相談する…", plus and send controls. No second AI input.

At UPPER RIGHT, inset at least 30px from right/top content edges, place ONE small floating PiP about 350px wide and 220px high. It must have visible conversation background around all sides and must not touch the bottom composer or become a side panel.
PiP header: plain text "Arco · 作業中" with very small pin, expand and close icons.
Content:
small muted "yu/Arco #42";
title exactly "Issueを会話へ渡す";
small green text "Open" and separate small blue status dot with "In progress";
a muted line "新しいコメント 1件";
one compact secondary pill "詳細へ戻る".
Minimal, readable information; no full Issue body, labels, assignee form, multiple cards, comments editor or extra actions.
The main point is a pinned active Issue quietly staying available while the user continues the normal Codex conversation. Preserve the actual Code Review screenshot's native calm tone and spacing rather than inventing a new brand.
```
