# 初期ビュー・横断範囲の敵対的レビュー

確認日: 2026-10-22
状態: 当時の初期実装案を対象とした独立した2 subagentのレビュー記録。ユーザー訂正により、初版の削減案を最終版の非目標とは扱わない。完成形の責務は[最終製品スコープ](product-scope.md)を参照。

## ユーザー指定の制約

小さくシンプルなGitHub Issue wrapperとして作る。独自runtimeや独立した管理基盤を増やさない。Code Review・Linearに近い操作感と、採用済みの会話連携4項目は維持する。

## 推奨する初期ビュー

| 項目 | 推奨案 |
| --- | --- |
| 初回 | 対象repoを1件選び、Open Issueを更新順に表示する |
| 横断範囲 | 明示登録したrepo集合だけ。初回は1件で成立させる。複数repoを扱っても独自workspaceやgroupを作らない |
| 以後の起動 | repo設定を復元する。画面内の検索条件・選択・一覧位置を保つ |
| 一覧 | 一つの一覧と詳細。repo名とIssue番号を各行に表示する |
| 絞り込み | Open／Closed、自分の担当、自分が作成、repo、ラベルなどの固定条件。専用の複数画面には分けない |
| Projects Status | 初版の一覧はOpen／Closedを表示する。Projects Statusは詳細を開いてProject名付きで取得・編集する |
| 会話欄の検索 | `@Arco`も登録repo集合を対象とする。UIの一時的な絞り込みと、登録対象の設定は分ける |

表示中の範囲は常に分かるようにする。「全件」は選択したrepo・条件の範囲を指し、全ページを取得済みという意味にはしない。
範囲外のIssue URLを明示的に開いても、登録repoや一覧の範囲を自動で広げない。

## レビューで退けた案

| 案・指摘 | 結論 |
| --- | --- |
| 初期表示を自分の担当／作成に限定する | 未割当・他者・bot起票を隠す。担当／作成は任意の絞り込みにする。一方のreviewerは最初この案を推したが、反論後にOpen全件へ修正した |
| Projectを一覧の唯一の入口にする | Project未追加のIssueを落とす。通常一覧の入口には使わない推奨 |
| アクセスできる全repoを自動横断する | 認可範囲と日常の対象範囲を混同する。repoの自動巡回・網羅管理を持たない |
| 自分の担当／作成／すべて／Project別の各画面を作る | 一つの一覧と固定フィルターへ縮小する。保存ビュー、独自ビューDSL、ピン留め、専用Inboxは初版に足さない |
| 複数ProjectのStatusを統合する | 共通の進捗モデルや自動推測を作らず、元Projectを示して編集する |
| UI反映のため独自runtimeを作る | UIとCodexのツールで同じGitHubを操作し、保存結果・表示復帰・手動更新などを契機に再取得する。チャット一覧、ジョブDB、常駐監視、全カードへの即時配信は要件化しない |

複数repo選択UIは、それ自体を初版の必須機能へ自動昇格させない。1repoで一巡を成立させ、必要な範囲だけ追加する。
会話連携4項目を「小さくするため」に落とす判断は行わない。

## GitHub wrapperの責務

- GitHub: Issue・コメント・ラベル・担当者・Projectsのデータを保存する。
- Codex／host: 会話、AIの実行、依頼の送信先を扱う。
- Arco: 取得・表示・更新、選択内容の共有、会話と画面の受け渡しを行う。

Issueの複製DB、検索index、独自agent実行基盤、同期engine、一般化したprovider frameworkを初版に作らない。必要なrepo設定と表示状態は小さな設定として保持する。
Projects用の権限はIssue用と別に確認する。Issue作成後のProject追加やStatus設定が失敗しても、Issue作成済みの事実を失敗で上書きしない。

## Linear表示を追加する場合の境界

比較検討後、ユーザーが完成形ではLinearも編集・進捗変更・会話連携まで対応すると決定した。以下は追加範囲ごとの比較記録であり、Linearを恒久的に参照専用にする仕様ではない。

| 範囲 | 評価 |
| --- | --- |
| URLを指定してLinear Issueの基本情報を読む | 小さく切り出しやすい。タイトル・本文・識別子・元のStatus・URLなどの表示を再利用できる |
| sourceを切り替えてLinearの一覧・詳細を読む | Linearの接続、team等の範囲、検索、ページ取得、エラー処理が追加される |
| GitHubと同じ一覧へ混在させる | 並び順・ページング・片側失敗・フィルターの意味を両sourceで決める必要がある |
| 編集・Status・会話連携を両sourceで同等提供する | 更新処理と受入確認が二系統になる。今回のGitHub向け初版要件をLinearへ自動適用しない |

似た表示項目があることはUI再利用には効くが、認証やworkflow stateまで同じにはならない。識別子はsourceと元のIDを保ち、Status・ラベル・Projectを自動変換しない。
Linearの画像・添付には認証が必要なため、本文テキストの表示と完全な添付再現も分けて考える。
既存のCodex Linear connectorが存在することは、Arcoから同じ接続や資格情報を再利用できる証拠にはしない。

以前の参照専用案は完成形の方針として採用しない。元のLinearへ書き込む通常のwrapper機能と、GitHubとの同期・統合Status・自動の重複対応付けは、別の製品機能として判断する。

## 一次資料

- [Code Reviewのinbox](https://learn.chatgpt.com/docs/code-review#find-reviews-that-need-attention)
- [Linear My issues](https://linear.app/docs/my-issues)
- [GitHubのIssue検索](https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests)
- [GitHubのフィルター](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests)
- [GitHub Search API](https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests)
- [Issue fieldsとProject fieldsの違い](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-fields-in-your-organization#issue-fields-and-projects)
- [Projects APIの認証](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects#authentication)
- [LinearのAPIと認証・Issue取得・画像](https://linear.app/developers/graphql)
