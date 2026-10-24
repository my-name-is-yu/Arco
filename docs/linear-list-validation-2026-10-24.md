# Linear一覧の軽量化と継続読み込み

確認日: 2026-10-24 JST

## 変更

一覧は公式SDKの`client.request`を使う専用GraphQLに分離した。100件ずつのIssue識別子・タイトル・URL・更新日時・状態と、認可先organization/teamの確認項目だけを取得する。本文・reaction・共有先User情報・全編集metadataは一覧のAPI応答から外した。選択後の詳細と編集用metadataは従来の経路を維持する。SDK clientや認証情報をリクエスト間でキャッシュしない。

空検索の`issues`、検索ありの`searchIssues`、未加工の検索文字列、`includeComments:true`、team/state/assignee/label/projectフィルター、作成日時・更新日時順、cursor、archivedの既定動作は維持する。本文・コメントを検索できる範囲と、一覧へ返すフィールドを分けて扱う。

organizationのUUIDとURL key、teamのUUIDと所属organization、各Issueのteam・正規URL・identifierを検証する。GraphQLの部分エラー、不完全な行、同一ページの重複ID、続きがあるのに空・欠落・反復するcursorは失敗として扱い、部分的な一覧を成功表示しない。

一覧末尾200px付近でcursor付きの次ページを取得する。1回のscroll要求による自動追加は最大3ページで、手動`Load more`で続きを取得できる。失敗時は自動再試行を止め、既存行を保持して手動で同じcursorを再試行する。compact表示と、詳細表示で一覧が隠れた狭幅画面では自動追加しない。

30秒pollとfocus復帰による一覧再取得は、fullscreenで1ページだけ読み込んでいる場合に限る。複数ページでは明示Refresh・保存後のinvalidateを維持する。検索条件変更時は先頭ページへ戻り、待機中の古い一覧要求にはAbortSignalを渡す。コメント30件ずつの取得、画像・reactionの段階取得、下書き・選択共有の処理は変えていない。

## ローカルと実接続

- Node 24.22.1で`npm run check`が成功。型検査・lint・format・単体348件・build・smoke・配布物検査を含む。既存のCSS `::highlight`警告は残る。
- 実接続で通常一覧、state、assignee、label、project、作成日時順、コメントを含む検索の7条件を、同じ条件の公式SDK応答と比較した。Issue・順序・表示項目がすべて一致し、各一覧は1 APIリクエストだった。結果件数は順に48・19・39・5・9・48・23件。ソースへの書き込みは0件。
- 同じ100件上限で旧一覧処理と比較した。対象の実Issueは48件。旧コードの取得上限だけを30から100へ変更して比較条件を揃え、旧処理14リクエスト・295,092 bytesに対して、新処理1リクエスト・20,905 bytesだった。bytesは展開後のGraphQL JSONで、圧縮後の実通信量ではない。元の旧30件取得では14リクエスト・210,300 bytesだった。
- 件数・操作名のみの端末内証跡: `dist/dev/linear-list-audit-2026-10-24.json`、`dist/dev/linear-list-before-100-2026-10-24.json`、`dist/dev/linear-list-live-2026-10-24.json`。タイトル・本文・認証情報は最終証跡に含めない。
- 新規browser検証8件が成功した。100行のscrollと選択保持、短いページのcursor継続、team・検索・各filter・並び順での先頭再開、追加取得の上限、失敗時の手動再試行、compact/狭幅で隠れた一覧の停止、複数ページのpoll/focus停止と明示Refresh、1ページの自動更新維持を確認した。
- 全browser検証138件が成功した（4.9分）。既存のコメント・画像の段階取得、下書き、共有、保存後の再取得、サービス切替を含む。ログは`dist/dev/linear-list-browser-2026-10-24.log`。
- browser初回の3失敗は、新規テストのlabel表記・戻るボタン名・focusイベントの送信先が実UIと異なるためだった。テストを修正し、focusイベントの肯定ケースも含めて8件成功した。製品の待機時間・再試行条件は変更していない。

## 導入

`codex plugin add arco@arco-local --json`で導入し、`dist/plugin`と導入先のSHA-256が一致した。

| ファイル   | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| arco.html  | `c34ab51cd69bd3675f8b320ee6d74b9c0327f8478c8f6b2ea976949573988c51` |
| server.mjs | `b3f90238d82700294db51ea2af54d2735306d8d801d3fa336d024c0f5864a5e5` |

別processの公開app-serverで71 tools、personal/project起動、GitHub/Linear接続を確認した。証跡は`dist/dev/linear-list-plugin-host.log`で、実画面確認とは別の検査である。

導入済みserverを新しいstdio MCP processでも読み取り確認した。一覧は48件・続きなし・本文/コメントなし。既存の専用検証Issueでは本文、コメント1件、commentsHasMore:false、添付・reaction配列を取得できた。source書き込み0件、stderr 0 bytes。証跡は`dist/dev/linear-list-installed-live-2026-10-24.json`。

## 再起動後の実Codex

ユーザーの再起動後、native toolの説明が100件の軽量一覧へ更新された。同toolは48件・続きなしを返し、本文・コメント・reactionが一覧に含まれないことを確認した。

実CodexパネルでもYu teamの48件を表示した。`YU-48`の検索とDone状態を組み合わせて1件へ絞り込み、既存の専用検証Issueを開いた。本文、taskの状態、画像、コメント1件、属性を確認した。YU-49も本文・コメント0件・属性を正常に表示した。sourceへの投稿・更新・reaction追加は行っていない。

YU-48の詳細では、既存の旧形式下書きに関する警告も確認した。旧下書きの廃止済み`promptText`/`promptTarget`を現在と同一の変更前HEADスキーマが拒否することを読み取りで再現し、今回の一覧変更による回帰ではないと確認した。既存ファイルは変更・削除せず保持した。YU-49にはこの警告はない。

確認後はLinearの検索を空・状態をAll workflow statesに戻し、元のGitHub / Created by me / All表示へ復帰した。実環境は48件のため、100件を超えるcursor追加・失敗注入・非表示時の停止はfixtureのbrowser検証で確認している。

実画面の端末内証跡はgit管理外に保持し、配布物には含めない。

- `dist/dev/linear-list-real-codex-48.png`: 軽量一覧の48件表示。
- `dist/dev/linear-list-real-codex-filter.png`: 検索と状態フィルターの組み合わせ。
- `dist/dev/linear-list-real-codex-detail.png`: YU-49の詳細表示。
- `dist/dev/linear-list-real-codex-detail-draft-warning.png`: YU-48の本文・画像・コメントと既存下書き警告。
