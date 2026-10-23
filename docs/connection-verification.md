# 接続・起動の実装開始時検証

確認日: 2026-10-22 / macOS arm64。実データへの書込み、認可scope変更、既存probe変更は行っていない。

## Nodeと一般pluginの起動

- 通常shell: Node `22.23.4`、npm `10.9.9`、GitHub CLI `2.103.0`、Codex CLI `0.161.0`。
- 通常配布Code Review `26.1016.61520`のmanifestと`.mcp.json`を再確認した。`/bin/sh -c`から`CODEX_MCP_NODE_PATH`で`server.mjs`を起動し、同変数を`env_vars`で許可している。first-party backend・認証cacheは調査していない。
- このタスク環境の`CODEX_MCP_NODE_PATH`はChatGPT同梱Node `24.21.0`を指していた。開発基準の`24.22.1`とは別の観測値である。
- `experiments/host-node-check/`に、既存inline probeとは独立した公式MCP SDK使用の一般pluginを用意した。公開`codex app-server`を別processで起動し、公開の`plugin/list` → `plugin/install` → ephemeral `thread/start` → `mcpServerStatus/list` → `mcpServer/tool/call`を実行した。モデル生成は開始していない。
- host Node変数を継承した場合、一般pluginは`connected`となり、`runtime_info`は`nodeVersion: v24.21.0`、`hostNodeVariablePresent: true`、`sameExecutable: true`を返した。Code Reviewと同じ起動経路で、一般pluginのstdio通信とtool実行まで成功した。
- 親processから同変数を除いた対照実験では、pluginはinitialize前に終了し`failed`となった。このstandalone app-serverは変数を自動補完しなかった。したがって、Codexデスクトップが一般pluginへ常に変数を注入する契約や、全OSでの追加設定不要までは証明していない。
- probeのinstallは公開APIで行い、各実行の`finally`で同probeだけをuninstallした。恒久marketplace設定・既存plugin・既存inline probeは変更していない。既存公開設定にprobe名が残っていないことも確認した。

再現は`node experiments/host-node-check/check.mjs --inherit-host-node`、対照は同commandのflagなし。repoの依存導入が必要。`CODEX_MCP_NODE_PATH`が設定された環境で継承版を実行する。この検証自体はmacOSのCode Review起動方式に限定され、製品のWindows/Linux launcherを確定しない。

[desktop-only公式のNode例](https://developers.openai.com/plugins/deploy/desktop-only)はshellを使わず`command: "node"`、`args: ["${PLUGIN_ROOT}/server/dist/index.js"]`としており、`${PLUGIN_ROOT}`をbuilt-in placeholderと説明している。任意の環境変数を`command`で展開する公開契約は今回の公式資料では確認できない。`${CODEX_MCP_NODE_PATH}`を直接commandへ置く方法を推測で製品へ採用しない。製品で公開例の`node`起動を使う場合も、PATH上の利用可能なNodeの確認と全OS検証は別に必要である。

公開APIの資料: [app-server](https://learn.chatgpt.com/docs/app-server)、[local plugin](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)、[marketplaceとplugin設定](https://developers.openai.com/codex/config-reference/)。app-serverのplugin管理APIは開発中のため、このprobeを製品の接続層として使わない。

## GitHub公開CLI

- `gh auth status --active`は有効なgithub.com本人アカウントとkeyring保存を報告。credentialの取得・複製は行っていない。
- `gh api user`、本人repo一覧、本人organization一覧、現在の作業repoのIssue GETが成功した。作業repoのOpen Issueは0件で、既存Issueの本文・コメントの実読取はまだ検証していない。
- 個人Projects、所属organizationのProjectsの両方で`missing required scopes [read:project]`を再現した。これはProjects非対応ではなく、現在の共有CLI認可の不足である。
- 現scopeは`gist`、`read:org`、`repo`、`workflow`。Projects閲覧には`read:project`、更新には`project`が必要。本人が認可変更する際の公開CLIは`gh auth refresh -h github.com -s project`。今回は実行していない。
- 公開`gh api`はREST/GraphQL、明示method、JSON標準入力を扱えるため、採用操作をCLI固有subcommandの有無で制限する必要はない。IssueやProject field更新の実データ検証は、本人が指定する検証対象と必要な認可を待つ。
- 未導入時は`gh`導入、未認証時は`gh auth login`、Projects権限不足時は追加認可を案内する。Arcoで`auth logout`を暗黙に呼ばない。`gh`自体はcredential store失敗時に平文へfallbackし得るため、Arcoから平文保存flagやtokenコピーを導入しない。現在観測した認証はkeyringである。

実装は`spawn`/`execFile`へ引数配列を渡し、`gh api --method … --input -`のJSONをstdinへ渡す。read時にfieldを指定するとPOSTへ変わるCLI仕様に注意し、`--method GET`を明示する。標準出力はJSON、エラーはcredentialを含めず利用者向けに分類する。

公開資料: [gh api](https://cli.github.com/manual/gh_api)、[auth login](https://cli.github.com/manual/gh_auth_login)、[auth refresh](https://cli.github.com/manual/gh_auth_refresh)、[Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects)。

## Linearの独立した認可境界

Linear接続toolはこのCodex環境で公開されている。しかし、それはArcoのlocal Node processが同じ接続やcredentialを利用できる証拠ではない。今回はcredential cacheを探索していない。

[Linear公式MCP](https://linear.app/docs/mcp)はremote Streamable HTTPとOAuth 2.1/Dynamic Client Registrationを提供し、Codexからの接続手順もある。これはhostがLinear MCPを接続する経路であり、別のArco MCPやUIにcredentialを渡す契約は確認できていない。既存connectorのtool一覧が見えることを、Arco内の認可成功に読み替えない。

[Linear OAuth公式](https://linear.app/developers/oauth-2-0-authentication)には、登録したcallback、PKCE S256、state照合、secret不要のcode交換とrefreshが明記されている。localhost callbackの例もある。よって端末内の小さなOAuth clientを実装する公開上の経路はあるが、実callback・refresh・失効は未検証である。

次に必要なのは、Arco用の登録済みclient ID/callbackを用意できるかと、既存接続を公開APIだけで使う経路が本当にないかの最終確認。独立OAuthを採用する場合にだけOS安全保存を選び、read/writeを本人に認可してもらう。登録や認可を代行・推測せず、tokenの平文fallback、独自backend、認証frameworkは追加しない。

## 残る受入検証

1. Codexデスクトップの通常起動から、Arco一般pluginのhost Nodeを確認する。今回の成功はstandalone app-serverであり、描画・composerの証明ではない。
2. 本人指定のGitHub検証Issue/Projectで、必要なscopeを認可後に読取・更新・再取得を確認する。
3. Linear固有の登録・認可と安全保存の最小経路を実証する。GitHubの成功で代替しない。

## 実装後の追記（2026-10-23）

上記は実装開始時の記録である。現在はArco本体をローカルinstallし、公開app-server経由の62 tools、GitHub/Linearの接続成功、本人repoの専用GitHub Issue、本人Yu workspaceの専用Linear Issueでの保存と再取得を確認した。LinearのPKCE認可・OS安全保存・実provider refreshも成功した。詳細は[実装・受入確認](implementation-status.md)、[GitHub実操作](github-live-validation.md)、[Linear実操作](linear-validation.md)を参照する。

GitHub追加project scopeの最初の試行は、Safariの既存passkey本人確認（Touch ID）で待機中に`context deadline exceeded`（exit 1）となった。2026-10-23 07:25 JST、本人が操作可能と伝えた後に新しいdevice flowを開始し、本人操作によってSafariが「Your device is now connected」、CLIが`Authentication complete`（exit 0）となった。keyringの本人アカウント`my-name-is-yu`で、scopeは`gist`、`project`、`read:org`、`repo`、`workflow`である。追加consentはProject / Manage projectだけで、tokenは取得・複製していない。

その後の公開GraphQL読取でProjects権限不足は解消した。本人所有、Hugmeid、aieo-product、skillport-devの既存Projectsは0件。pimu-incに既存Project「Game With」#4（`PVT_kwDOBlcef84AZwDR`）が1件あり、closedであった。この確認ではProject/item/fieldの書込みや、Projectの再開・新規作成を行っていない。実field更新の検証対象は、既存Projectの状態と本人の指定を踏まえて決める。その他の受入状況は[実装・受入確認](implementation-status.md)を参照し、standalone app-serverやmock hostの成功をCodex実画面・composerの証明とはしない。
