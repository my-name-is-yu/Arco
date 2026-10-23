# Code Reviewを参考にしたArcoの画面方針

確認日: 2026-10-22。2026-10-23、同じ導入済み配布ソースを再確認。

公開ドキュメント、このMacに導入済みの公式Code Reviewプラグイン `26.1016.61520` のソース、ユーザー提供の画面画像から整理した参考資料。画像による視覚確認と、host上での操作検証を区別する。以下の事実とArcoへの提案も区別する。

## 公開ドキュメントで確認できたこと

- 個人用inboxでrepoを横断し、自分への依頼、チームへの依頼、自分が作成したPRを切り替える。[Find reviews that need attention](https://learn.chatgpt.com/docs/code-review#find-reviews-that-need-attention)
- sidebarからPRを選ぶか、検索欄にリンクを入力する。詳細はSummaryとChangesに分かれる。[View a pull request](https://learn.chatgpt.com/docs/code-review#view-a-pull-request)
- ツールバーでpinしたPRはsidebarのPinnedへ入り、SummaryのThreadsから関連する自分の会話へ戻れる。[Pinned](https://learn.chatgpt.com/docs/code-review#find-reviews-that-need-attention)、[Threads](https://learn.chatgpt.com/docs/code-review#continue-in-a-chat)
- ChecksのFixは失敗情報を会話へ添付し、未送信のメッセージを準備する。一方、Review with Codexは新しい会話でレビューを開始する。[Fix](https://learn.chatgpt.com/docs/code-review#continue-in-a-chat)、[Review with Codex](https://learn.chatgpt.com/docs/code-review#ask-questions-about-the-change)

これらはCode Reviewの利用方法であり、同じhost機能を自作プラグインに公開するAPIの説明ではない。

## ユーザー提供画像で確認できたこと

[Code Reviewの参考画像][user-reference]では、暗い配色、細いアイコン列、縦のPR一覧、Summaryの詳細、右の補助情報を確認した。上部はpill状のタブとコンパクトな操作群、下部はhostのcomposerになっている。

この画像からCode Reviewの配色・表示密度・情報階層を確認した。こちらからhostを操作して、クリック・送信・表示切り替えを検証したものではない。

画像内の実際のアカウント名・repo名・PR本文はmockへ複製せず、引き続き架空の`yu/Arco #42 Issueを会話へ渡す`を使う。

## 導入済みソースで確認できたこと

元ファイルは圧縮済みのため、行番号に加えて関数名を記す。

| 項目             | ソース上の事実                                                                                                                                                                                                                            | 根拠                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 一覧と詳細       | hostから検索語・scope・表示セクションなどを受け取り、一覧データを`setSidebarSections()`で返す。詳細側の未選択表示はsidebarから選ぶよう案内する。                                                                                          | [JS:3596][src-sidebar] `J$s()`、[JS:8672][src-detail] `eMl()` / `dHn()` |
| 小さいツールバー | 内容タブと操作を分け、実際の横幅を計測して補助操作をoverflowメニューへ移す。移動時のフォーカスも扱う。                                                                                                                                    | [JS:3594][src-toolbar] `tIs()` / `YRs()` / `d8i()`                      |
| 詳細の情報階層   | Status・repo・番号、タイトル、作者・日時を区別する。repo名や番号のコピー操作もある。                                                                                                                                                      | [JS:8450][src-metadata] `tOl()` / `nOl()`                               |
| 狭い領域への対応 | 詳細の内容領域が800px以上では補助情報を右列に置き、それ未満では本文側にまとめる。外枠はhostの領域寸法も参照する。                                                                                                                         | [JS:3596][src-sidebar] `USi()`、[JS:3550][src-shell] `M_s()`            |
| 会話への受け渡し | Add to chatはcomposerに内容を準備する操作。Review with Codexは明示的な開始操作として別に実装される。                                                                                                                                      | [JS:8440][src-chat] `p8t()`、[JS:3716][src-review] `RFs()`              |
| 密度と色         | 基本tokenは本文14px、control label13px、sm12px、toolbar46px、pane toolbar40px、lgの角丸10px。Electron/browser向けの上書きもあり、実表示がすべてこの数値になるとは扱わない。surface・text・border等の意味を持つ色tokenと明暗テーマを使う。 | [CSS:2][src-tokens]                                                     |

アカウント・repo・scopeの選択UI自体の配置や見た目は、この3ファイルの調査だけでは確定していない。検索や一覧状態をhostと交換する実装と、実際の画面を見た確認は区別する。

## first-party専用sidebarとの境界

HTMLの`hz()`はhost contextの`openai/first-party-plugin-bridge`が有効か確認し、`vz()`が専用RPC `ui/openai/first-party-plugin-bridge`を通してremote bridgeを作る。`Sz()`がこれを`pullRequestsReviewBridge`に保存する。[HTML:151][src-bridge]

JSの`kl()`がそのbridgeを返し、`J$s()`が`kl()?.setSidebarSections()`を呼ぶ。[JS:1692][src-bridge-reader]、[JS:3596][src-sidebar]

したがって、Code Reviewがhost側のsidebarを利用していることを根拠に、Arcoも標準MCP AppのAPIだけでそこへIssue一覧を出せるとは判断しない。同じAPIの利用可否は未確認であり、画面案ではArco自身の表示領域内に一覧を置く。会話連携の専用bridgeも、汎用APIとしてそのまま採用しない。

## Arcoへの提案

- 広い管理表示は、選択中Projectのrepo横断一覧とIssue詳細を中心にする。Project・repo・検索はコンパクトにまとめ、独自の固定ナビを増やし過ぎない。
- 詳細冒頭でrepo・番号・タイトルを識別できるようにする。GitHub IssueのOpen／Closedと、採用済みのProjects Statusは別の情報として示す。
- 主要操作を少数に絞り、補助操作はoverflowへまとめる。「会話へ添付」と「依頼を送信」を区別し、選択だけでは送信しない。
- 会話横では同じ詳細を一列に再配置する。inlineは要約と少数の操作、詳細への復帰に絞る。PiP案は2026-10-23のユーザー希望で採用を取り消した。
- Code Reviewの色・文字・境界線の密度を参考にする。Code Reviewの機能名やPR向け構造を、そのままIssue管理の要件にしない。

上記は画面設計の提案。Code Reviewの資料から、Arcoの全表示形式や標準API上の動作が確認できたという意味ではない。

## 画面イメージの扱い

既存の4枚はv1として保持する。対象は[管理表示][mock-wide]、[会話横][mock-panel]、[inline][mock-inline]、[PiP][mock-pip]。これらは新規デザイン案であり、Code Reviewの実画面の再現ではない。

ユーザー提供画像の暗い配色と、今回確認した情報階層・コンパクトなツールバー・表示密度を反映した[v2の4枚](design/code-review-image-prompts.md)を別の画像として作成した。各画像生成に実際の参考画像を添付し、会話横・inline・PiPにはv2管理画面も参照として添付した。v1を上書きせず、いずれも未実装の構想図として扱う。

[src-bridge]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.html:151
[src-bridge-reader]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.js:1692
[src-shell]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.js:3550
[src-toolbar]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.js:3594
[src-sidebar]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.js:3596
[src-review]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.js:3716
[src-chat]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.js:8440
[src-metadata]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.js:8450
[src-detail]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.js:8672
[src-tokens]: /Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/assets/pull-requests.css:2
[mock-wide]: /Users/yuyoshimuta/dev/Arco/docs/design/images/wide-management.png
[mock-panel]: /Users/yuyoshimuta/dev/Arco/docs/design/images/conversation-panel.png
[mock-inline]: /Users/yuyoshimuta/dev/Arco/docs/design/images/inline-card.png
[mock-pip]: /Users/yuyoshimuta/dev/Arco/docs/design/images/pip-companion.png
[user-reference]: /Users/yuyoshimuta/dev/Arco/docs/design/references/code-review-user-reference.png
