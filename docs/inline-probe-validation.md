# Codexの会話内カード検証

確認日: 2026-10-22
状態: 修正版0.0.2の標準経路で、Codexの会話本文内へのカード表示とMCP Apps bridgeの初期化を確認。ユーザー提供の実画面が根拠。counter操作は未確認。

## 退役と記録の扱い

2026-10-24、初期の描画検証を終えたinline probeのコードとmarketplace項目を削除した。以下は2026-10-22の検証履歴であり、現在の導入手順ではない。実画面の証拠は保持する。本体Arcoのmarketplaceと導入済みpluginの設定は変更していない。

## 検証対象

`experiments/inline-probe/` に、外部依存のないローカルstdio MCPプラグインを作成した。
架空のIssueとクリック用counterを持つHTMLを返す。標準の`ui.resourceUri`と互換の`openai/outputTemplate`を別toolに分け、両方とも同じinline専用resourceを使う。
global/thread entrypointは宣言しない。

## 今回確認したこと

| 段階 | 結果 |
| --- | --- |
| MCPサーバーの起動・initialize | PASS |
| tool一覧と標準・互換の両tool呼び出し | PASS |
| HTML resourceの取得、inline指定、tokenの一致 | PASS |
| ローカルmarketplace登録 | 成功。`arco-local` |
| pluginのインストール・有効化 | 成功。`arco-inline-probe@arco-local`、修正版0.0.2 |
| インストール内容とソースの一致 | インストール時に修正版10ファイルのSHA-256一致とlauncher実行権限を確認 |
| 実行中のこの会話へのtool反映 | 修正版の読込後、この会話でも標準・互換の2toolが利用可能 |
| ユーザー側のplugin一覧 | 「Arco Inline Probe」が表示されていると回答あり。0.0.1では一覧に表示されてもtoolは0件だった |
| 明示的なplugin指定 | 0.0.1の状態でユーザーが`@Arco Inline Probe`を指定してもtoolは0件 |
| plugin経由のMCP読込 | 修正後、CLI 0.161.0の公開APIで2toolと1resourceを検出 |
| 再起動なしの公開reload経路 | default `codex app-server proxy` の接続先socketが存在せず利用不可 |
| Codex内での会話内描画 | 確認。会話本文内にカードが表示され、Host modeがinline |
| MCP Apps bridge初期化 | 確認。BridgeがMCP Apps initialized、Tool linkageがstandard ui.resourceUri |
| counterのクリック操作 | 未確認。提供画像ではLocal counter: 0 |
| 互換経路の実表示、fullscreen、PiP | 未確認 |

`codex mcp get arco-inline-probe`ではサーバーが見つからなかった。この結果だけで、plugin由来のMCPサーバーの起動失敗とは判断しない。
実際に実行できたprotocol往復と、hostがHTMLを描画することは別の確認である。

## 実画面による表示確認

2026-10-22 21:20:15の[ユーザー提供スクリーンショット](design/references/arco-inline-probe-codex-inline-user.png)を確認した。生成画像やブラウザ単体の表示ではなく、Codexの会話画面内に次が見える。

- 会話本文のtool表示の中に、青枠の`ARCO INLINE PROBE`カードがある。
- `Host mode: inline`。
- `Bridge: MCP Apps initialized`。
- `Tool linkage: standard ui.resourceUri`。

この環境では、ローカルpluginの標準経路でinlineカードを表示できると確認した。元画像を加工せず保存した。
counterは0のためクリック後の動作は確認していない。画像内のtokenと、その呼出しの生のtool結果との独立した照合も行っていない。
Arco本体のIssue操作や他の表示形式まで検証済みとは扱わない。

## 起動設定の不具合と修正

0.0.1は単独のMCP通信テストが通っても、pluginのloaderには拒否されていた。
CLI 0.161.0の公開app-serverを独立したstdioプロセスで起動し、新しいchatやモデル呼び出しを作らずに調査した。

- 修正前の`plugin/read`: installed/enabledはtrueだが`mcpServers: []`。
- 自分のpluginに関する警告: `Agent Plugins stdio command must be a bare executable name or a contained ./ path`。
- 原因: portable `mcp.json`の`command`へNodeの絶対パスを置いていた。
- 修正: `command: ./launch.sh`とし、パッケージ内のlauncherから既知のNodeを起動する。0.0.2へ更新。
- 修正後の`plugin/read`: `mcpServers: ["arco-inline-probe"]`。
- 修正後の`mcpServerStatus/list`（serverNameをown serverへ限定）: `render_inline_probe`、`render_inline_probe_compat`、HTML resource 1件を検出。

[公開loaderの制約](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/codex-mcp/src/agent_plugin_config.rs#L150-L175)とも一致する。
これはCLI側での設定解析・起動・公開の確認であり、実行中のdesktopが再読込した証拠やinline描画の証拠にはしない。

## 当時のインストール記録

CLI: `codex-cli 0.161.0`。
marketplaceは`.agents/plugins/marketplace.json`から`./experiments/inline-probe`を参照する。
以下は実行済み。

```sh
codex plugin marketplace add /Users/yuyoshimuta/dev/Arco --json
codex plugin add arco-inline-probe@arco-local --json
codex plugin list --marketplace arco-local --json
```

インストール先:
`/Users/yuyoshimuta/.codex/plugins/cache/arco-local/arco-inline-probe/0.0.2`

## 再現手順と残る確認

[公式のローカル導入手順](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)は、ローカルpluginの追加・更新後にdesktop appを再起動するよう案内している。
[公式の利用手順](https://learn.chatgpt.com/docs/plugins#install-and-use-a-plugin)はインストール後に新しいチャットを使うよう案内している。
0.0.1で再起動や新しいチャットを案内したが、起動設定が拒否されていたため、それだけでは解決しなかった。
0.0.2への更新後にdesktopを再起動し、新しいCodexチャットで`@`からArco Inline Probeを選択して次を依頼する。

> Arco Inline Probeのrender_inline_probeを呼んで、会話内カードを表示して。

まず標準toolを呼び、表示されなければ互換toolを呼ぶ。次を記録する。

1. 会話の本文の流れにカードが出るか。テキスト・JSON・別タブ・横パネルのみはinline成功としない。
2. `ARCO INLINE PROBE`とtool結果に一致する`ARCO-...` tokenが見えるか。
3. `Local counter: 0`をクリックして1へ変わるか。
4. カード内の`Host mode`と`Bridge`の実際の値。

標準経路のinline描画とbridge初期化は上記の実画面で確認済み。互換経路を試さなくても、今回の表示可否の検証は成立する。
counterのクリック、UIからのサーバー操作、Arco本体の会話への受け渡し、他の表示形式は必要な実装段階で確認する。

## 現在の配布範囲

inline probeの再導入は現在の配布対象から外した。Arco本体は同じarco-local marketplaceで提供するため、probe退役を理由にmarketplace全体を削除しない。導入済みprobeの削除・host設定変更は今回実施していない。
