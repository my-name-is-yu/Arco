# Arco

GitHub・LinearのIssueをCodex内で閲覧・編集し、選択した文脈を会話へ渡す、ソース非公開・無料のlocal MCP plugin。

実装と受入確認を進めています。操作ごとの実装先と確認範囲は[実装・受入確認](docs/implementation-status.md)を参照してください。完成条件は[要件定義](docs/requirements.md)、[最終スコープ](docs/product-scope.md)、[操作対応表](docs/issue-operations.md)です。

## 開発と検証

開発基準はNode `24.22.1`、npm。一つのpackageとlockfileを使います。

```sh
npm ci
npm run check
npm run test:browser
npm run dev:fixture
```

`dev:fixture`はbuild後に使います。ブラウザ検証用URLは表示されたloopback URLです。公開SDKのAppBridgeとstdio MCPを使い、架空のIssueだけを操作します。実GitHubへのfallbackはありません。

読み込みを目視確認する場合は`ARCO_DEV_TOOL_DELAY_MS=2000 npm run dev:fixture`でfixtureのtool応答を遅らせられます（0〜5000ms、既定0）。[アニメーションとスケルトンの確認記録](docs/design/motion-loading-validation-2026-10-23.md)も参照してください。

`npm run build`は配布候補の`dist/plugin/`と、fixture専用の`dist/dev/`を別々に生成します。UIは単一HTML、serverはNode ESM bundleです。配布候補にはfixtureデータを含めません。

GitHubは公開`gh` CLIの既存認証を利用します。初回は接続済みアカウントのAssigned to meを表示し、Created by me・Mentioned me・All account repositoriesへ明示的に切り替えられます。repoはアクセス可能な候補から選んで絞り込めるため、一覧表示にrepoの入力は不要です。選択したscopeと表示条件は次回へ引き継ぎます。 GitHub・Linearとも検索欄へIssue URLを貼って直接開けます。アカウント一覧の範囲と検索条件は[取得仕様](docs/github-account-discovery.md)を参照してください。Projectsには追加の`project`認可が必要です。Arcoから共有CLIのtokenを取得・複製したり、暗黙にlogoutしたりしません。

Linearは登録したOAuth client IDで本人の`read,write`権限を認可します。token pairはOS credential storeに保存し、利用不能な場合の平文fallbackはありません。[接続と実操作の検証](docs/linear-validation.md)を参照してください。設定・検索条件・未送信の下書きは端末内に保存します。

UIは英語です。取得したIssue本文・タイトル・ラベル名等は元サービスの言語を保ちます。独自アカウント・backend・課金・Issue mirrorはありません。

本人が指定した検証repoにダミーIssueを作って検証する場合だけ、明示したrepoで次を実行します。専用Issueを作成して操作し、最後にCloseします。

```sh
npm run test:live -- --repo owner/name --write
```

本repoでは[検証Issue #1](https://github.com/my-name-is-yu/Arco/issues/1)で作成・本文・ラベル・担当者・コメント・状態変更と再取得を確認しました。既存Issueを検証に流用しません。

## 状態と確認範囲

- [接続・Node起動の検証](docs/connection-verification.md)
- [依存関係とbundleの検証](docs/dependency-runtime-notes.md)
- [既存inline probeの実画面記録](docs/inline-probe-validation.md)
- [実装対応表と残るCodex実画面確認](docs/implementation-status.md)
- [GitHub追加操作の実接続検証](docs/github-live-validation.md)
- [アカウントからのIssue・repo取得](docs/github-account-discovery.md)
- [Code Reviewを基にしたUI比較と整理](docs/design/ui-audit-2026-10-23.md)
- [Linear接続と実操作の検証](docs/linear-validation.md)

ブラウザのmock hostでの成功と、Codex実機のcomposerでのIssue選択・コンテキスト共有・表示の成功は別に記録します。Issue全体やArco内で選択したテキストをAdd to chatで共有し、相談はCodexの通常入力欄から行います。添付のタイトル・グループ表示はCodexが担います。一般公開は行っていません。
