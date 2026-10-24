# 構造整理とUI統一の確認記録

更新日: 2026-10-24

この記録は導入前のローカル検証である。その後の導入・再起動・実操作は[実Codex確認](real-codex-refactor-validation-2026-10-24.md)へ分けて記録した。

## 変更の基準

採用済みのGitHub / Linear操作を保ち、画面、状態、通信、添付の責務を分ける。既存の依存とNode 24.22.1を使い、依存更新や新しい状態管理ライブラリは追加しない。変更はローカルのソースと生成物に留める。

着手前はunit / adapter 244件、型、lint、build、stdio smoke、artifact検査が成功。全browserは107件成功・2件失敗で、画像取得と取得待ち破棄の2件は個別実行でも再現した。整形はhover-browserの1ファイルで不一致があった。

## 既存失敗の解消

- Markdownのa / img / liを安定したcomponentへ移し、変動する値をcontextで渡す。親の更新で画像をremountせず、進行中の取得を保持する。
- 取得待ち破棄のテストは、画像2件を保留し、その後でreactionをqueueへ入れてからIssueを切り替える。取得順を固定的に仮定しない。
- 元の2件と「下書きの入力中も画像が同じDOMで保持され、取得は1回」の追加回帰、合計3件がNode 24.22.1で成功した。

## 責務と保存形式

- 共通の入口がサービスを切り替え、表示中のworkspaceだけをmountする。非表示側のデータ更新通知はcacheをstaleにし、戻った時に取得する。
- 取得データはQueryClient、閲覧・操作はhost単位のsource session、未送信入力と保存revision / statusは共通の下書き管理が所有する。
- 会話添付はhost snapshotを正とし、閲覧対象から独立させる。注釈のDOM監視と位置計算を親でまとめる。
- GitHub / Linearのnative ID、workflow、権限、部分成功、保存後の取得失敗receiptを維持する。GitHub API versionの移行は行わない。
- 廃止済みのpromptText / promptTarget、旧設定の欠損補完、selectionだけの旧添付入力を削除する。現行形式と保存先は維持し、旧形式のファイルは読取エラーとして上書きせず残す。
- inline probeのコードとmarketplaceの該当項目を退役させた。本体のmarketplaceと過去の実画面記録を保持し、導入済みpluginの設定は変更していない。

## 最終検証

Node v24.22.1で次を実行した。

| 確認              | 結果                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| npm run check     | 成功。型・lint・整形・unit / adapter 255件 / 26ファイル・buildを含む               |
| stdio smoke       | 成功。71 tools、resource / mention、fixture更新と重複防止、stdout / stderr framing |
| artifact検査      | 成功。単一HTML、外部script / styleなし、fixtureやsource mapの配布混入なし          |
| 追加の重点browser | 作成画面、競合比較、切替中保存、bulkのlock / retry ID、注釈、画像の回帰を個別確認  |
| 全browser         | 成功。121件、retryなし、5.4分                                                      |
| 差分の空白検査    | git diff --check成功                                                               |

独立レビューでは、MCP登録metadata・結果envelopeの差分、GitHubのread / write分類とAPI version、Linearの対象検証・保存済みreceiptを照合した。画面の分割で見つかったscroll復元marker、bulk実行状態、URL読取中のbusy、leaf操作の失敗表示の寿命も修正した。

両サービスの広幅 / 390px、作成dialog、Linearの競合比較を、現在のfixture画像で目視確認した。header / close / footer、focus表示、最新タイトルとMarkdown本文の表示を確認し、重なりや切れを認めなかった。inline / fullscreen、明暗とreduced motionも全browserで確認した。

共通UIのregion / alertと設定取得後のサービス起動に合わせ、既存browserの期待値3件を更新した。該当3件の個別成功後、全121件を最初から再実行して成功した。

検証時点の配布候補SHA-256:

- dist/plugin/arco.html: `52e63ff27143db5f9bbf13086077d191e5dc4ba735e5794396c4de19e0024650`
- dist/plugin/server.mjs: `8147611afd881dbd6765f9d374d3487bd1cd7a66b99a2b9da3cd376710de9b3e`

browser生成物はdist/dev/refactor-browser-finalへ保存した。これはfixtureでのローカル検証であり、実Codexのインストール更新や実サービスへの書込み成功を意味しない。このローカル検証の終了時点では、公開、commit / push、導入済みpluginと認証の変更は実施していなかった。
