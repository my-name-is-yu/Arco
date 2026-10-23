# Arco Inline Probe

Codexの会話内にMCP AppのHTMLが実際に描画されるかを切り分ける、ローカル専用の小さな実験です。Arco本体の実装ではありません。GitHub・ネットワーク・認証・永続化を使いません。外部依存パッケージもありません。

## 構成

- `server.mjs`: Node標準モジュールだけのstdio MCPサーバー。JSON-RPCメッセージだけをstdoutへ出します。stderrには既知のmethod・tool名・resource URIだけをtraceし、引数は記録しません。
- `card.html`: bridge初期化を待たず描画する固定カード。目印は`ARCO INLINE PROBE`、架空のIssueは`yu/Arco #42 Issueを会話へ渡す`。
- `plugin.json`と`mcp.json`: portable Agent Plugins形式。
- `.codex-plugin/plugin.json`と`.mcp.json`: 同じサーバーを示すdesktop互換形式。
- `launch.sh`: portable loaderが許可するパッケージ内の実行パスから、ローカルNodeを起動します。
- `smoke-test.mjs`: launcherを使う実プロセスへのprotocol往復確認。

サーバー名は`arco-inline-probe`。実験はMCP `2025-11-25`を基準とし、古い対応バージョンも同じ小さな機能範囲で受け付けます。それより新しいバージョンを要求された場合は`2025-11-25`へnegotiationします。

## 起動とローカル確認

このMacで確認したNodeは`/Users/yuyoshimuta/.nvm/versions/node/v22.16.0/bin/node`です。portable manifestのcommandには`./launch.sh`を指定し、スクリプト内からこのNodeを起動します。GUIのPATHへ依存せず、portable loaderが禁止する絶対commandも避けます。launcherとserverは現在の作業ディレクトリに依存しません。互換形式の`${PLUGIN_ROOT}`はhostが展開するpluginフォルダです。

```bash
cd /Users/yuyoshimuta/dev/Arco/experiments/inline-probe
npm test
```

stdioサーバーだけを起動する場合:

```bash
/Users/yuyoshimuta/.nvm/versions/node/v22.16.0/bin/node /Users/yuyoshimuta/dev/Arco/experiments/inline-probe/server.mjs
```

起動後はstdinへのMCPリクエストを待ちます。起動だけで画面は開きません。依存インストールやbuildは不要です。

## 二つのtool

| tool | UIへの結び付け | 目的 |
| --- | --- | --- |
| `render_inline_probe` | 標準の`_meta.ui.resourceUri` | 最初に確認する主経路 |
| `render_inline_probe_compat` | 互換の`_meta["openai/outputTemplate"]` | 主経路の結果と比較する別経路 |

共通resourceは`ui://arco-inline-probe/card.html`、MIMEは`text/html;profile=mcp-app`です。`resources/read.contents[*]._meta["openai/ui"]`に`availableDisplayModes: ["inline"]`と`preferredDisplayMode: "inline"`を置きます。

どちらのtoolにもglobal／thread／fileのentrypointを宣言しません。panelへ開くtoolや、自動的にfullscreenへ逃がす処理もありません。標準経路が失敗したときに互換経路で成功しても、別の結果として記録します。

## host上で確認すること

このフォルダの作成・`npm test`では、hostへの登録・インストール・設定変更を行いません。hostの接続は別の作業です。

接続・アプリ再起動後、Codexの会話からまず`render_inline_probe`を空の引数で呼びます。既存会話でtoolが反映されない場合は新しい会話が必要か確認します。成功の判定には次を実際に確認します。

1. 会話の本文の流れに`ARCO INLINE PROBE`のカードが見える。toolのJSON、通常のテキスト、別タブ、side panelだけではinline表示成功としない。
2. カードの`ARCO-...` tokenがtool結果の`serverToken`と一致する。tokenはサーバープロセスごとに新しくなります。
3. `Local counter: 0`をクリックして1へ変わる。これはカード内だけの処理です。
4. `Host mode`と`Bridge`、開いた`Host diagnostics`の値を記録する。hostがmodeを返さない場合は`not reported`のままです。カード上の`Requested mode: inline only`は観測結果ではありません。

カードは常にHTMLとして描画し、bridgeなしでもcounterを使えます。MCP UIの`ui/initialize`へ応答がなければ5秒後にその事実を示します。standaloneでHTMLを開いてもhost上のinline表示の証拠にはなりません。

## 検証状態

| 段階 | この実験での扱い |
| --- | --- |
| 起動・tool/resourceの往復 | 2026-10-22、Node v22.16.0で`npm test`成功 |
| hostへの登録・インストール | 2026-10-22 `arco-inline-probe@arco-local` 0.0.2をインストール・有効化済み |
| plugin経由のserver・tool・resource検出 | CLI 0.161.0の公開app-server APIで2toolと1resourceを確認 |
| Codex内でのinline表示 | 2026-10-22、ユーザー提供のCodex実画面で標準経路の会話内表示を確認 |
| hostのUI bridge | 実画面のMCP Apps initializedとHost mode: inlineを確認 |
| counter操作 | 未確認。提供画像では0 |

インストールと実画面確認の記録・再開手順・取り外し方法は[検証記録](../../docs/inline-probe-validation.md)を参照してください。

## 参照

- [OpenAI: MCP serverへのUI追加](https://developers.openai.com/plugins/build/chatgpt-ui)
- [OpenAI: Plugin packageとmanifest](https://developers.openai.com/plugins/build/plugins)
- [OpenAI: desktop-only stdio構成](https://developers.openai.com/plugins/deploy/desktop-only)
- [OpenAI MCP Extensions: Display Modes](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#display-modes)
- [MCP Apps stable仕様](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)、[stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#stdio)
