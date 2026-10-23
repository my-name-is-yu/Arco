# Arco Issue操作対応表

更新日: 2026-10-22
状態: 確定。2026-10-22、ユーザーが本対応表のおすすめ案を採用。完成形の製品範囲を定めるもので、初版の削減表・実装予定順ではない。

## 境界の考え方

ArcoはGitHub・LinearのIssueを日常的に扱い、その文脈をCodexへ渡すクライアントとする。
Issueと既存の属性・所属・関係を操作する。Projectや組織の運用設定、AI作業の実行管理は別の責務とする。
ラベル定義の管理は、ユーザーのラベル管理目的に合わせて含める明示的な例外。

以下の操作と非目標を、両sourceの編集・進捗変更・会話連携という方針を具体化した完成形として採用する。
採用表示形式（inline／fullscreen）と初版必須の会話連携4項目は維持する。PiPは2026-10-23のユーザー希望で対象外とした。

## 完成形に含める操作

操作は元サービスに存在し、接続ユーザーに権限がある場合に提供する。「同じ位置で操作できる」と「意味を統一する」は区別する。

| ID  | 操作                           | GitHub                                                               | Linear                                                         | 上限・注意点                                                                                        |
| --- | ------------------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| O01 | 対象範囲の選択                 | 明示したrepo・Project                                                | 明示したworkspace・team・Project                               | 複数対象も扱える。source混在一覧の採否は別のUX判断                                                  |
| O02 | 一覧・検索・絞り込み・並べ替え | Issue検索、状態・担当・ラベル・所属等                                | Issue検索、workflow state・担当・ラベル・所属等                | 元サービスの検索・API取得を利用。独自全件indexを作らない                                            |
| O03 | 詳細閲覧                       | タイトル・Markdown本文・コメント・属性・画像・リンク                 | 同左、コメントの親子も保持                                     | APIと権限の範囲で表示。未対応情報は削除・平坦化しない                                               |
| O04 | 作成                           | repoを選びIssue作成                                                  | teamを選びIssue作成                                            | 入力中・失敗時の下書きを保持。Arco独自の確定Issueは作らない                                         |
| O05 | タイトル・本文編集             | Markdown編集、本文内チェック項目の変更                               | Markdown編集、本文内チェック項目の変更                         | チェック項目を独自タスクへ変換しない。独自の共同編集基盤は作らない                                  |
| O06 | 状態・進捗変更                 | Open/Closed・終了理由と、ProjectごとのStatus                         | teamのworkflow state                                           | GitHubの2種類を分ける。Open/ClosedとProjects StatusをArcoが自動連動させない                         |
| O07 | 担当者変更                     | 元サービスで有効な担当者の追加・解除                                 | 元サービスで有効な担当者の指定・解除                           | 人数制約・割当可能範囲をsourceに従わせる。招待・権限管理はしない                                    |
| O08 | ラベルの付け外し               | repoの既存ラベル                                                     | workspace・teamの既存ラベル                                    | 同名でも別定義。指定外ラベルを保持し、既存group制約も尊重する                                       |
| O09 | ラベル定義管理                 | 一覧・作成・名前/色/説明の変更・削除                                 | 同左、元のworkspace/teamの範囲で扱う                           | groupの作成・再編・scope移動は公式へ。Issueからの解除と定義削除を区別する                           |
| O10 | 通常コメント                   | 閲覧・投稿・権限内の編集/削除                                        | 同左＋スレッド返信                                             | Linearの本文内注釈・スレッド解決・AI要約機能の再実装は含めない                                      |
| O11 | リアクション                   | Issue・コメントへの追加/取消                                         | Issue・コメントへの追加/取消                                   | sourceで選択可能な既存の種類を使う。カスタム絵文字の登録・管理はしない                              |
| O12 | 既存属性の値変更               | 既存Issueタイプ、Issue fields、Projects fields                       | priority・estimate・due date                                   | 型と属性は下記の固定リスト。存在しない属性をラベル等で自動補完しない                                |
| O13 | 既存の所属先へ追加・変更・解除 | Project、milestone                                                   | Project、Project milestone、cycle                              | 所属先そのものは作らない。repo/teamの移管はこの操作に含めない                                       |
| O14 | 親子Issue                      | 子Issue作成、既存親子の設定・付け替え・解除                          | 同左                                                           | 別Issueとして元サービスへ保存。階層の一括編集・依存グラフeditorは作らない                           |
| O15 | 依存・関連Issue                | blocks/blocked-byの閲覧・追加・解除。その他参照は元のリンクで表示    | blocks/blocked-by/relatedの閲覧・追加・解除                    | source内の既存関係だけ。duplicate統合とsource間の独自関係は含めない                                 |
| O16 | 添付・リンク                   | 既存添付の閲覧、MarkdownへのURL追加。ローカルファイル追加は公式へ    | 既存添付の閲覧、URL追加、公式APIで元サービスへのファイルupload | Arco独自の添付保存先を持たない。外部連携カードを任意に定義するeditorは作らない                      |
| O17 | 単純な既存テンプレートの利用   | 本文と採用済み属性の既定値だけを持つもの                             | 同左                                                           | フォーム、子Issue生成、未対応属性、必須入力等を含む場合は公式で作成。未対応部分を無視して適用しない |
| O18 | 複数選択で整理                 | 状態・担当者・ラベル・既存属性値の変更                               | 同左                                                           | 同じsourceで適用先/値が明確な選択だけ。本文・コメント・関係・定義管理・移管のbulkは含めない         |
| O19 | Codexとの往復                  | Issue/選択範囲の共有、@Arco、現在/新規会話への依頼、tool更新の再取得 | 同左                                                           | 採用済みの4項目。閲覧変更と送信は別。独自agent実行管理は持たない                                    |
| O20 | 元サービスへの導線             | Issue/コメントのURL・識別子コピー、公式で開く                        | 同左                                                           | 未対応操作へ直接到達でき、戻った後は再取得する                                                      |

O02の検索条件保存、一覧の位置・選択保持、一覧/詳細での属性メニュー、キーボード操作はこの責務内のUI機能として扱う。
検索条件の保存と、GitHub/Linear側の共有Viewを作成・編集する操作は区別する。

### O12で編集する属性・型

- GitHub Issue本体: 既存のIssueタイプ。ラベル、担当者、milestone等はそれぞれの操作で扱う。
- GitHubのorganization Issue fields: text、number、date、single-select、multi-selectの既存値を設定・変更・解除。
- GitHub Projects fields: text、number、date、single-select、iterationの既存値を設定・変更・解除。Statusはsingle-selectの一つ。対象Projectとfieldを必ず特定する。
- Linear: priority、estimate、due date。teamの見積尺度に従う。project/cycle等はO13、workflow stateはO06。

GitHubのIssue fieldsはProjects fieldsとは別の保存先である。名前が同じPriorityやDue dateも自動同期しない。
field定義・選択肢・iteration期間・見積尺度の作成や変更は含めない。上記以外の型は閲覧可能な情報と公式への導線にとどめる。
この固定リストは、接続先に新しい型が追加されても自動拡張しない。

## 表示・公式への受け渡しまでにする操作

「後で実装する」候補ではなく、完成形でも直接操作を持たない。

| 対象                           | Arcoで行うこと                                               | 直接操作を持たない理由                                                              |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| repo/team間の移管              | 現在の所属を表示し、公式へ渡す                               | identifierやStatus、ラベル、Project等の再対応を伴い、通常の属性変更とは影響が異なる |
| Issueの削除・archive・restore  | sourceの状態を表示し、操作は公式へ                           | 日常の完了/再開と区別し、ライフサイクル管理機能を広げない                           |
| duplicate統合                  | 重複先への参照・既存状態を表示し、統合は公式へ               | 関係追加だけでなくStatusや添付等に影響する。単純な関連付けと扱わない                |
| Lock・公式Pin・購読者管理      | 元の情報を必要に応じて表示し、操作は公式へ                   | モデレーション・通知管理までをArcoの操作対象にしない                                |
| フォーム型・複雑なテンプレート | 公式の作成画面へ渡す                                         | 独自のフォーム実行・検証機構を持たない                                              |
| 詳細な変更履歴・本文の版復元   | APIで得られる直近の変更情報を表示し、完全な履歴/復元は公式へ | 履歴viewer・復元機能を独立した管理領域にしない                                      |
| 関連PR・commit・check          | 元リンクや取得済みの概要を表示し、Code ReviewやGitHubへ渡す  | PRレビュー・diff編集・merge・CI実行をIssue wrapperに含めない                        |
| 未対応型・高度なコメント機能   | 内容と公式への導線を保持する                                 | source全機能への自動追随を完成条件にしない                                          |

ここでの「表示」は、公開APIで取得でき、権限がある情報の範囲。全イベント・全外部連携情報の取得を約束しない。
公式へ渡す機能は、Arco内で未対応だと分かる表示にし、無反応のボタンや隠れた将来実装扱いにしない。

## 製品に含めない機能

- Project・cycle・milestone・Teamそのものの作成/編集、workflow/field/estimate尺度の定義、テンプレート定義管理。
- roadmap、工数集計、スプリント運営、組織の権限/メンバー管理、顧客要求やSLA運用。
- 通知Inbox、snooze、独自リマインダー、常駐triage/自動割当/自動Status変更。
- source間同期、全件mirror、重複自動統合、汎用の移行/CSV import-export製品。
- 独自Issue正本、共通の業務workflow、AI実行queue/再試行/agent編成、Symphonyの運転管理。

通常のAPI接続・認証・MCPサーバー・表示cache・入力下書き・元サービスへのuploadは、この非目標に当たらない。
Issue/コメントを読んだCodexへの明示的な調査・整理依頼はO19に含む。独自のAI実行基盤は要らない。

## 正確さの条件

- source、元のID、repo/team、必要なProject/fieldのIDを保持し、同名項目を混同しない。
- 対象項目だけを書き込み、指定外の属性・ラベル・field値を保持する。全置換APIの安易な利用を避ける。
- source側に既存のautomationや親子の自動処理がある場合、それをArcoで再実装・相殺しない。保存後に再取得し、実際の結果を表示する。
- bulkでは互換性のない選択に対して値を推測しない。対象を分けるか操作不可とし、成功・失敗はIssue別に表示する。
- 未対応情報を含むテンプレート・本文・属性を、対応したように見せて欠落保存しない。
- source側で可能なこと、公開APIで可能なこと、Codex内で実機検証したことを区別する。

## 調査根拠と未検証事項

2026-10-22、公式資料を確認。実アカウントへのIssue/field/upload操作は行っていない。製品範囲の採用と、Arco実装の動作確認は区別する。

- [GitHub Issues API](https://docs.github.com/en/rest/issues/issues): Issueの作成・編集・状態等。PRも返るendpointがあるため一覧では区別する。
- [GitHub sub-issues API](https://docs.github.com/en/rest/issues/sub-issues)、[dependencies API](https://docs.github.com/en/rest/issues/issue-dependencies): 親子・依存の閲覧と更新。
- [GitHub Issue field values API](https://docs.github.com/en/rest/issues/issue-field-values): org定義の既存field値の取得・設定・解除。multi-selectは引数/例に記載がある一方、一部の型の列挙に抜けがあり、実装時の接続検証が必要。
- [GitHub Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects): 既存Projectへの追加と、field値の更新。Issue本体の属性とProject itemの属性を区別。
- [Linear Issues](https://linear.app/docs/creating-issues)、[Issue properties](https://linear.app/docs/issue-property)、[GraphQL](https://linear.app/developers/graphql): 通常操作、元の属性、移管時の影響。
- [Linear parent/sub-issues](https://linear.app/docs/parent-and-sub-issues)、[comments/reactions](https://linear.app/docs/comment-on-issues): 親子・コメント・source側automation。
- [Linear upload](https://linear.app/developers/how-to-upload-a-file-to-linear)、[attachments](https://linear.app/developers/attachments): ファイル保存と外部resourceのattachmentは別の機能。認証付き画像表示・Codexからのupload経路は要実装検証。
- [GitHubのIssue作成とテンプレートURL](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue)、[Linear templates](https://linear.app/docs/issue-templates): 既存テンプレートにはフォームや既定属性等がある。単純な本文コピーで完全対応とは扱わない。

GitHubのIssue添付ファイルをuploadする公開APIの根拠は今回の確認範囲で得られていないため、O16は公式画面へ渡す。非公開endpointや別ストレージで埋めない。将来のAPI追加は自動採用せず、操作表の変更として判断する。

## レビュー結果

独立した2 subagentに、完成形の責務とsource差の両面から敵対的レビューを依頼した。
親子・依存・返信・リアクション・正式APIでのsource保存uploadはIssue clientの責務内という評価。
fieldの型を固定すること、ラベル定義管理を明示的な例外にすること、移管/重複統合を単純な属性編集と混同しないことを反映した。
移管・削除・restoreも含めるべきというレビュー意見はあったが、日常操作と管理操作の境界として公式への受け渡しを採用した。2026-10-22、ユーザーがこの境界を含むおすすめ案を承認。
