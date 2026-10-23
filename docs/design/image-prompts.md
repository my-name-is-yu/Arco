# Arco 画面イメージと生成プロンプト

作成日: 2026-10-22
生成方法: 組み込みImage Genツール。4回の独立した生成。
状態: 画面構成を議論するための未実装のイメージ。Codexの周囲のUIも概念表現であり、実機のスクリーンショットではない。

2026-10-23追記: PiP案はユーザー希望により採用を取り消した。以下は当初の構想の記録である。

4枚で同じ架空のIssue `yu/Arco #42 Issueを会話へ渡す` を使う。会話横・会話内・PiPは、最初の管理画面をスタイルと表示内容の参照として生成した。

## 1. 広い管理画面

[画像](images/wide-management.png)

### 生成プロンプト

```text
Use case: ui-mockup.
Create ONE realistic, high-fidelity product UI concept image for Arco, a GitHub Issues management plugin embedded in Codex desktop. This image depicts the WIDE MANAGEMENT / HOST FULLSCREEN presentation. Target dimensions 1440 x 1024, crisp front-on flat screenshot composition, no device mockup, no perspective.
This is a proposed UI concept, not a capture of the actual Codex app. The host chrome should be plausible, simple, and understated, not falsely exact. Add a tiny unobtrusive caption "Arco · UI concept" along an outer edge.

Shared design system for this series: native desktop productivity app, light warm white #FAFAF9 base, white content, charcoal text, subtle gray separators, one restrained blue accent #2563EB for selection and primary actions. SF-like system sans with clear readable Japanese, body size 14–16 px. Small monochrome line icons. Flat continuous surfaces, normal table rows rather than cards, no gradients, no decorative illustrations, no dashboards or metric tiles. Focus on readable hierarchy and excellent spacing.

Context date October 22, 2026; do not show unnecessary calendar data.
Mock issue data must be fictional and consistent:
Project selector "My work"; repositories "yu/Arco", "yu/nest".
Selected issue "yu/Arco #42" title exactly "Issueを会話へ渡す"; Status "In progress"; assignee "yu"; label "enhancement".
Issue body exactly two short paragraphs:
"選択したIssueをCodexの会話に追加する。"
"本文・ラベル・ProjectのStatusを引き継ぐ。"
One short comment by yu: "選択と送信を分けたい。"

Layout:
At far left, a narrow quiet Codex host sidebar with the host name "Codex", a few generic chat entries, and a visibly selected "Arco" plugin entry, clearly communicating sidebar launch. Do not add a second large navigation sidebar inside Arco.
Arco occupies the large remaining area. A compact app header contains "Arco", Project dropdown "My work", repo filter "すべてのrepo", a search field, and modest "新規Issue" action.
Below, a TWO-PANE master-detail layout: left about 55 percent is an issue table, right about 45 percent is selected issue detail, separated by a simple vertical divider.
Table column labels "Status", "Issue", "Repo", "担当者"; about 6 readable rows. Selected #42 row has a pale blue highlight. Other short believable rows include "#43 ラベルを一括編集する", "#44 検索条件を保持する", and "yu/nest #18 設定画面を整理する". Use small status icons with Todo / In progress / In review. Do not add counts or widgets for their own sake.
Right detail shows repo and issue number, selected issue title at comfortable heading scale, compact metadata, the short body and one comment. A clearly visible primary action "会話へ追加" with a small add-to-chat icon and a subtle "GitHubで開く" link. The detail is spacious and readable, no unnecessary tabs.
A slim native HOST composer along the lower edge may remain available, visually outside Arco's content. No AI chatbot or chat sidebar embedded inside Arco.
The hero use case is finding an Issue, reading it, and adding it to a Codex conversation. Show a clean usable state, not a feature inventory. Make all Japanese text legible and carefully typeset.
```

## 2. 会話横パネル

[画像](images/conversation-panel.png)

参照画像: `images/wide-management.png`。元の構図を維持する編集ではなく、表示場所に合わせた構成への展開。

### 生成プロンプト

```text
Use case: ui-mockup.
Create ONE high-fidelity UI concept image showing Arco in a CONVERSATION SIDE PANEL beside a Codex chat. Target dimensions 1440 x 1024. Flat front-on desktop screenshot composition.
The supplied image is a STYLE AND PRODUCT CONTENT REFERENCE ONLY: retain the same light native desktop design, restrained blue accent, typography, Arco identity and selected sample Issue; completely recompose the layout to show the conversation-panel presentation. Do not reproduce the wide issue table. This is a proposed UI, not an actual Codex screenshot. Tiny caption "Arco · UI concept".

Design: warm white #FAFAF9, white content, charcoal text, subtle gray separators, blue #2563EB accents, readable Japanese system sans 14–16 px, small monochrome outline icons. No gradients, no metric tiles, no unnecessary cards or new features. Maintain the clean consistent visual identity from the reference.
Mock context date October 22, 2026. Use only fictional data.
Shared Issue: Project "My work"; repo "yu/Arco"; "#42"; title exactly "Issueを会話へ渡す"; Status "In progress"; assignee "yu"; label "enhancement".
Body: "選択したIssueをCodexの会話に追加する。" then "本文・ラベル・ProjectのStatusを引き継ぐ。"
One GitHub comment by yu: "選択と送信を分けたい。"

Layout:
A quiet far-left Codex host sidebar around 180 px wide. The main middle region is a normal chat around 700 px wide. The rightmost region is the Arco side panel around 450 px wide, separated from chat by a simple vertical divider.
Chat is visible and readable, with a short user message "このIssueの仕様を一緒に詰めたい" and a modest Codex reply "Issueの選択と、依頼の送信を分けましょう。". Use comfortable whitespace and just these short example turns, no giant prose or code.
At bottom of CHAT column only, show the host's native composer, containing a small attached-context chip "yu/Arco #42" and placeholder "このIssueについて相談する…". A normal send arrow. No second AI input inside Arco.

Arco PANEL content: small app header "Arco" with an expand icon and close icon. Small "一覧へ" back link. Then repo/number "yu/Arco #42", issue title wrapping naturally, compact editable Status, assignee and label, two short body paragraphs, one GitHub comment.
Panel footer has primary button "会話へ追加" and subtle "GitHubで開く".
The panel is a SINGLE COLUMN focused on ONE ISSUE. Do not squeeze a table or another sidebar inside it. Distinguish GitHub comments from AI chat through the divider and a section label "GitHubコメント".
The key visual message is: the same issue remains visible on the right while the user converses with Codex on the left. No annotations, no large presentation title outside the app, no extra floating windows.
```

## 3. 会話内カード

[画像](images/inline-card.png)

参照画像: `images/wide-management.png`。元の構図を維持する編集ではなく、表示場所に合わせた構成への展開。

### 生成プロンプト

```text
Use case: ui-mockup.
Create ONE high-fidelity product UI concept showing an Arco INLINE ISSUE CARD INSIDE A CODEX CONVERSATION. Target dimensions 1440 x 1024. Flat front-on desktop screenshot composition, no perspective, no device bezel.
The reference image is a STYLE AND PRODUCT CONTENT REFERENCE only: match the same light warm-white native desktop appearance, restrained blue accents and Japanese typography. Recompose completely for INLINE; no full Arco management view, no side panel, no floating mini window.
This is a UI concept, not an actual product screenshot. Tiny caption "Arco · UI concept" at outer bottom edge.

Consistent series styling: base #FAFAF9, white surfaces, charcoal text, subtle gray separators, blue #2563EB, system sans with crisp legible Japanese, readable 14–16 px body, small monochrome outline icons. No gradients, no metrics, no decorative illustrations, no nested cards. The single issue card is appropriate here because it is a self-contained plugin result.
Mock date October 22, 2026, fictional data only.
Shared data: Project "My work", repo "yu/Arco", "#42", title exactly "Issueを会話へ渡す", Status "In progress", label "enhancement", assignee "yu".
Summary sentence: "選択したIssueをCodexの会話に追加する。"

Layout: quiet narrow Codex host sidebar on far left, normal spacious conversation filling the rest. Header title "Issueの相談". Main chat column centered within available area, around 840 px wide. A short user message near top reads "Arcoの #42 を見せて".
Below the user message, show an Arco tool-result label with a small icon and name "Arco". Directly below it, one compact wide inline card about 760 x 280 px, clearly part of the message flow rather than a floating window. It has a very subtle border and restrained rounded corners.
Card content:
small repo/number "yu/Arco #42";
headline "Issueを会話へ渡す";
compact Status "In progress" and label "enhancement";
one short summary sentence;
two bottom actions: blue "詳細を開く" and quiet "会話へ追加".
No tabs, no table, no list of other issues, no full comments section, no internal scrolling.
Immediately after the card, a small ordinary Codex assistant sentence: "詳細を開いて、本文やコメントを確認できます。"
At the bottom is the HOST conversation composer, a normal empty field with placeholder "Codexにメッセージを送信…", not an Arco-specific separate chat field.
Keep generous whitespace but the inline card should be large enough to read. The visual point is a focused summary and a couple of actions embedded in chat, with the full app available through the detail button. Do not use a large external slide title or explanatory arrows.
```

## 4. PiP

[画像](images/pip-companion.png)

参照画像: `images/wide-management.png`。元の構図を維持する編集ではなく、表示場所に合わせた構成への展開。

### 生成プロンプト

```text
Use case: ui-mockup.
Create ONE high-fidelity UI concept showing Arco as a SMALL PICTURE-IN-PICTURE ISSUE COMPANION FLOATING OVER A CODEX CONVERSATION. Target dimensions 1440 x 1024. Flat front-on desktop screenshot, no perspective, no physical monitor or device bezel.
The supplied image is only a STYLE AND PRODUCT CONTENT REFERENCE. Match the light native desktop styling, system font, blue accent, Arco identity, and fictional selected Issue. Recompose completely for PiP. Tiny outer caption "Arco · UI concept". This is a proposed UI concept, not a capture of actual Codex or a verified host layout.

Shared style: warm white #FAFAF9, white content, charcoal text, subtle gray separators, blue #2563EB accent, readable Japanese SF-like system sans, body 14–16px. Small monochrome outline icons. No gradients, no dashboards, no chart, no Symphony agent monitor, no timer. Shadow is permitted only to communicate that the tiny PiP window is floating.

Shared fictional Issue, context date October 22, 2026:
repo "yu/Arco"; "#42"; title "Issueを会話へ渡す"; Status "In progress"; assignee "yu"; label "enhancement".
PiP does NOT need the full body, assignee, labels, comments or a table. It should retain just the issue identity, status and a small update signal.

Layout:
Narrow quiet Codex host sidebar at far left. The rest is a normal spacious chat, titled "Issueの実装を相談". Keep the chat column comfortably readable toward center-left, with open whitespace on the right.
Show two short readable chat turns. User: "本文を確認して、実装方針を決めたい。" Codex: "まず、Issueの選択と会話への受け渡しを分けて考えましょう。" Nothing elaborate.
Native host composer along the lower edge contains a small attached-context chip "yu/Arco #42", placeholder "このIssueについて相談する…", and send arrow.

In the UPPER RIGHT of the conversation viewport, put ONE genuinely SMALL floating Arco PiP window approximately 350–380px wide and 230–260px tall, at least 32px inset from top/right. This must read as an overlay, NOT a full-height side panel and NOT an inline message card. Show background conversation whitespace all around its edges, a gentle compact elevation shadow, and a slim header with "Arco · 作業中", pin icon, expand icon and close icon.
Inside this little window:
small "yu/Arco #42";
the title "Issueを会話へ渡す" at restrained bold size;
small Status "In progress";
subtle update line "新しいコメント 1件";
a compact single action "詳細へ戻る".
Keep generous padding and fit naturally. The floating window should take only a small fraction of the screen and should not obscure the host input.
The visual message is: keep the current Issue visible while the user continues a normal Codex conversation. Do not add a full Arco app, management table, second chatbot, other floating windows or explanatory arrows.
```
