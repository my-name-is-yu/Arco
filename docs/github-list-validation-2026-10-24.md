# GitHub一覧の取得量と継続読み込み

確認日: 2026-10-24 JST

## 問題と変更

GitHubの個人一覧は、PRを含むnativeページを取得した後でPRを除外する。実接続で `all` / `open` / 更新日時降順の先頭ページを確認すると、旧30件取得はIssue 8件・PR 22件だった。同条件の100件取得はIssue 58件・PR 42件で、一覧の少なさにPRの混在が影響していることを確認した。`assigned` / `open` は両方とも0件であり、空の担当一覧を広いscopeへ変更する処理は入れていない。件数比較のJSON証跡には取得したタイトル・本文を含めない。実データを表示した画面画像はgit管理外の端末内に保持し、配布物にも含めない。

- 個人一覧とリポジトリ検索は100件ずつ取得する。nativeのfilter、並び順、リポジトリID確認と、検索の1,000件上限を維持する。
- `gh api --jq` で一覧向けの項目だけを子processから返し、本文や詳細専用のデータをNodeでparseしない。RESTのGitHub→`gh`の通信量はこの変更では減らない。
- 一覧の末尾200px付近で次のページを取得する。短いページやPRだけのページでも続くが、1回のscroll要求に対する自動追加は最大3ページで停止する。`Load more`で追加取得できる。
- 次ページの失敗では自動再試行を止め、現在の一覧を保持する。compact表示とCSSで隠れた狭幅の一覧では自動追加を止める。
- 複数ページを読み込んだ後は30秒pollとwindow focusによる全ページの再取得を止める。明示的なRefreshと保存後のinvalidateは利用できる。
- コメントの30件ずつの取得、画像・reactionの段階取得、詳細の表示契約は維持する。

## ローカルと実接続の確認

- 型検査、lint、format、単体258件、build、smoke、配布物検査が成功。単体258件はNode 24.22.1でも成功した。
- 全browser検証127件が成功した（6.5分）。既存のコメント分割、画像・reaction遅延取得、待機処理の破棄、共有・下書き・サービス切替を含む。ログは `dist/dev/github-list-browser-2026-10-24.log`。
- 新規browser検証6件は成功。PR-onlyページ、scroll時の選択・位置保持、失敗ページの再試行、自動取得上限とscope変更、compact表示、狭幅での詳細表示を確認した。
- 新規browserの即時mockが起動時のdata通知より先に完了して取得回数を二重計上したため、fixtureの接続応答を起動通知の完了まで待たせた。製品の待機時間や再試行条件を緩める修正は行っていない。
- 生成済みproduction serverの読取で `all` / `open` は58件、`assigned` / `open` は0件、`my-name-is-yu/Arco` / `all` は2件を返した。一覧にbody・comments等が含まれないことを確認し、sourceへの書込みは0件、server stderrは0 bytesだった。
- 別processの公開app-serverで導入済みpluginの71 tools、personal / project起動、GitHub / Linear接続を確認した。これは実画面確認とは別の検査である。

端末内の件数証跡: `dist/dev/github-list-live-2026-10-24.json`。

## 導入と実Codex

`codex plugin add arco@arco-local --json` で導入した。`dist/plugin`と導入先のHTML / serverのSHA-256は一致した。

| ファイル   | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| arco.html  | `dc9c85ab0864ae056b366fd742087eb7cb7b275317cdcc2b875ce57fe3b3f887` |
| server.mjs | `11629066a1a5b2814d1973f40f49f731ad1f946ada7f570887405fd18e2fdabd` |

更新直後、起動済みCodexのnative toolは旧8件の結果を返していた。ユーザーがCodexを再起動した後、同じnative toolが58件とsummary-onlyの結果を返した。導入済みファイルの一致と、実際のserver更新を分けて確認している。

実CodexのArcoパネルでも、`All account repositories` / `Open`で58件の行と`58 issues loaded`を確認した。末尾の`Load more`へ移動した際に自動追加が先に完了し、ボタンが消えて145件の一覧になった。nativeの2ページ目は87件・`hasMore:false`であり、58+87件の結果と一致する。

既存の検証用Issue `my-name-is-yu/Arco#2`を開き、本文・Closed状態・属性・コメント0件・reaction操作欄を確認した。本文やコメントの投稿・更新、reactionの追加は行っていない。確認後は元の`Created by me` / `All`の一覧表示へ戻した。

実画面の端末内証跡:

- `dist/dev/github-list-real-codex-58.png`: 更新後の最初の一覧。
- `dist/dev/github-list-real-codex-145.png`: 続きを自動追加した一覧。
- `dist/dev/github-list-real-codex-detail.png`: 既存検証Issueの詳細。

実画面の対象はこのMacのCodexと現在の狭幅・暗色パネルである。大量コメント、画面外画像、通信失敗の注入、PR-onlyの連続ページはfixtureのbrowser検証で確認する。
