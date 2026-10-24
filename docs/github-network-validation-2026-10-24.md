# GitHub一覧のGraphQL・ETag取得

確認日: 2026-10-24 JST

## 取得経路と互換性

リポジトリ指定一覧はGraphQL `search(type: ISSUE)`で100件ずつ取得する。GitHubから取得するフィールドを一覧の要約・labels・assignees・ページ情報に限定し、本文・コメント・reactionを要求しない。`nextCursor`をUIが次の`cursor`へ渡す。repo・検索・状態・並び順を変更するとcursorをリセットする。

個人一覧は従来のnative `GET /issues`を維持する。担当・作成・メンション・全体のscope、状態、並び順、PRの除外とnativeページ継続を変えない。初回や内容変更時のREST応答は本文を含むが、`gh --jq`で要約のみをArcoへ渡す。次の再取得にはETagを送り、GitHubが304を返した場合のみ、メモリ内の要約を再利用する。GitHubの同順位行の順序が変わった場合も新しい200応答を表示し、無理に304へ固定しない。

互換性のため、検索内の明示的`sort:`、Boolean演算・括弧、cursorなしの旧ページ指定、100件を超えるlabels・assigneesがあるページは既存REST検索を使う。1,000件の検索上限、repo同一性確認、検索の状態・並び順を維持する。GraphQLの認証・通信失敗や部分応答をRESTの成功として隠さない。個人一覧を`viewer.issues`やSearchへ置き換えない。

ETagキャッシュは要約だけを最大32件・8 MiBまでメモリに保持する。CLIの実credentialのハッシュで分離し、同じユーザーでのcredential変更も破棄対象とする。前後のcredential確認、同時要求の統合、失敗時の無効化、LRUの上限、返却データの独立性を検証した。credentialを読むコマンドは`gh auth token --hostname github.com --no-refresh`で、更新操作とログへの出力を避ける。現在のCLIでオプションの存在と環境credentialの選択を確認した。

100件取得、末尾で最大3ページずつの自動追加、手動継続、次ページ失敗時の明示的再試行、複数ページ時の定期全取得停止は前回の修正を維持する。コメント30件ずつの取得、画像・reactionの段階取得、詳細・編集のREST経路を変更していない。GraphQLのlabel IDは一覧内でのみ使い、編集用のmetadataは引き続き別取得する。

## ローカルと実接続

- Node 24.22.1で`npm run check`が成功。型検査・lint・format・単体316件・build・smoke・配布物検査を含む。既存CSSの`::highlight`警告は残る。
- 新しいcursor browser検証3件が成功。cursorの受け渡し、repo・検索・状態・並び順変更時のリセット、個人一覧の数値ページ継続を確認した。
- 最初のbrowser実行ではテストの`.sidebar-filters summary`が入れ子のsummaryにも一致したため、直下のsummaryへ限定した。製品コードの待機・再試行条件は変えていない。
- 再起動後の全browser検証130件が成功した（5.9分）。cursor、PR-only/PR-heavyページ、自動追加の上限と失敗時の再試行、コメント分割、画面外画像・reactionの段階取得、下書き・共有・サービス切替を含む。ログは`dist/dev/github-network-browser-2026-10-24.log`。
- 実接続の担当一覧で`200 → 304`と304本文0 bytesを確認した。担当Issueは0件、全体/Openの先頭は58件・続きあり。空の担当一覧を全体へ自動変更しない。
- 自repo/AllはGraphQLで2件。公開`cli/cli`のOpen・作成日時昇順ではGraphQLの100件×2ページが重複せず、2ページ目のIssue番号・順序が旧REST経路と完全一致した。明示的`sort:`のREST経路も確認した。
- 実通信の確認は8回の一覧API読み取り、sourceへの書き込みは0件。件数・HTTP状態のみの最終証跡は`dist/dev/github-network-live-2026-10-24.json`。`bodyBytes`はCLIの投影後の出力サイズで、GitHub側の圧縮通信量ではない。

## 導入

`codex plugin add arco@arco-local --json`で導入した。`dist/plugin`と導入先のSHA-256が一致した。

別processの公開app-serverでも、導入済みpluginの71 tools、personal / project起動、GitHub / Linear接続が成功した。これは実画面確認とは別の検査で、証跡は`dist/dev/github-network-plugin-host.log`。

| ファイル   | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| arco.html  | `342e728c855265e98dc32f28bbd207c83861e9b06eca86d3af9ba02e0029195c` |
| server.mjs | `9d9bfd493316556fd6b32ea910153f48b21bbd0f94b6b5e20c19f752265f2ffe` |

## 再起動後の実Codex

ユーザーの再起動後、native toolのschemaと説明に`cursor`が現れた。実際の`cli/cli`/Open・作成日時昇順の呼び出しで、`nextCursor`を返す100件と、それを渡した次の100件を取得し、200件に重複がないことを確認した。個人一覧の同じnative toolは全体/Openで58件・続きありを返し、いずれも本文・コメントを含まない要約だった。

実Codexパネルでは、リポジトリの既存設定を読み込み、TrueForgeHackathon/Allで46件を表示した。Arco/Closedは2件で、`label:documentation`を入れると1件に絞られた。既存の検証用Issue `my-name-is-yu/Arco#2`では本文・Closed状態・属性・コメント0件・reaction操作欄を開けた。検索と検証で変更した設定を戻し、最後は元のCreated by me/All表示に復帰した。

個人一覧はAll account repositories/Openで58件を表示した。末尾の`Load more`へ移動すると自動追加が先に完了してボタンが消え、145件・追加ボタンなしとなった。sourceへの投稿・更新・reaction追加は行っていない。

実画面の端末内証跡はgit管理外に保持し、配布物へ含めない。

- `dist/dev/github-network-real-codex-repo.png`: ラベル検索で1件のリポジトリ一覧。
- `dist/dev/github-network-real-codex-account.png`: 追加完了後の個人一覧。
- `dist/dev/github-network-real-codex-detail.png`: 既存検証Issueの詳細。

大量コメント、画面外画像、通信失敗の注入、PR-onlyの連続ページはfixtureのbrowser検証で確認し、実画面では上記の範囲を確認した。再起動で中断されたbrowser実行は成功件数に含めず、再実行が全130件成功した。
