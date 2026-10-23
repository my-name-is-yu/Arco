# 公開SDKの互換性と技術検証記録

確認日: 2026-10-22
状態: 技術選定のための隔離検証。製品repoへ依存や本体コードを導入した記録ではない。Code Reviewに構成を寄せ、追加の認証・保存・runtime依存は必要性の確認後に選ぶ。

## 実装開始時の基準

| 役割 | package / version | 確認範囲 |
| --- | --- | --- |
| 開発Node | `24.22.1` LTS | 公式archiveのSHA-256照合、macOS arm64で実行 |
| UI | `react` / `react-dom` `19.3.1` | UI型チェック・build・peer確認 |
| React型 | `@types/react` / `@types/react-dom` `19.3.0` | UI型チェック |
| TypeScript | `6.0.3` | UIとMCPのstrict型チェック |
| Vite | `8.3.5`、`@vitejs/plugin-react@6.1.2` | 単一HTML build |
| スタイル | `tailwindcss` / `@tailwindcss/vite` `4.3.3` | UI build |
| UI部品 | `@openai/apps-sdk-ui@0.2.2` | Button・Markdown・GFMを含む最小UI build |
| 単一HTML | `vite-plugin-singlefile@2.3.4` | JS/CSSのinline、artifact静的検査 |
| MCP | `@modelcontextprotocol/sdk@1.32.1` | strict型チェック、stdio通信 |
| MCP Apps | `@modelcontextprotocol/ext-apps@1.7.5` | server登録、App生成・型確認、resource読取 |
| OpenAI拡張 | `@openai/mcp-extensions@0.2.1` | rootと`/app`のみ。draft schema、公開metadata/mentions schema |
| Schema | `zod@4.4.3` | 上記SDK間でdedupe、strict型チェック |
| lint | `eslint@10.13.0`、`@eslint/js@10.0.1`、`typescript-eslint@8.72.0`、`eslint-plugin-react-hooks@7.1.1` | 最小UIソースのlint・peer確認 |

Query `5.104.5`、Linear SDK `99.0.0`、Vitest `5.0.5`、Testing Library React `16.3.3`、user-event `14.6.8`、Playwright `1.64.1`、Prettier `3.9.10`はregistryの版・engine・peerを確認した候補。実際の製品上の統合・テストは未実施で、上表のSDK/UI検証と同じ完了状態にはしない。

package managerは一つのnpm/package-lockで足りる。ここで確認した組み合わせを導入時にexact指定し、全依存をlockfileへ固定する。検証環境のnpmは`10.9.9`。製品のNode型は対象runtimeに合う24系を選び、導入時に再確認する。

## MCPの互換性

最新MCP server/client/coreはv2系、MCP Appsの最新は`2.0.3`だった。一方、OpenAI拡張`0.2.1`のoptional peerはMCP Apps `^1.7.5`、Zodはexact `4.4.3`である。

| 組み合わせ | 検証結果 | 判断 |
| --- | --- | --- |
| MCP v2＋Apps v2＋OpenAI `0.2.1` | npm peer解決が`ERESOLVE` | force/overrideして採用しない |
| MCP v1＋Apps v1＋OpenAI `0.1.0` | 型・登録は通るがmessageの`send`が`true`のみ | 採用済みの未送信draft要件が欠ける |
| MCP v1＋Apps v1＋OpenAI `0.2.1`の`/server` | server helperの型がv2 serverを要求 | 混ぜない |
| MCP v1＋Apps v1＋OpenAI `0.2.1`のrootと`/app` | 型・draft schema・stdio通信が成功 | 現在の基準 |
| 上の基準でroot Zodだけ`4.6.7` | nested `4.4.3`のschemaとSDK側型が不一致 | 全体を`4.4.3`へ揃える |

backendはSDK v1の`McpServer` / `StdioServerTransport`とApps v1の`registerAppTool` / `registerAppResource`を使う。入口・display mode・composer検索は公開metadata/schemaを標準登録APIへ渡す。frontendはApps v1の`App`とOpenAI `0.2.1`の`OpenAIExtensions`を使う。
`@openai/mcp-extensions/server`をimportしないため、v2 serverは不要である。OpenAI拡張の通常依存としてcore v2は入るが、独立したserverや追加runtimeではない。

`moduleResolution: NodeNext`ではApps v1の宣言ファイルに相対import拡張子のエラーが出た。MCP serverとApp/extension型の隔離検証では、`module: ESNext` / `moduleResolution: Bundler` / `strict: true` / `skipLibCheck: false`で確認した。MCP schema型の不整合をcastやlib check無効化で隠していない。Apps SDK UIを含む最小UIプロジェクトの確認範囲は次節に分けて記録する。

stdio検証は次を実施した。

1. client/serverを別processで起動して`initialize`。
2. `tools/list`、`resources/list`、`resources/read`。
3. mockの表示toolと`mentions/search`公開marker付き検索toolを呼び出す。
4. UI MIME `text/html;profile=mcp-app`、登録結果、検索結果を確認する。
5. frontendのApp/extensionを生成し、型と`target: "new", send: false`のschemaを確認する。実ブラウザの`ui/initialize`通信はこの検証に含まない。

当初の実行環境はNode `22.23.4` / npm `10.9.9`。公式archiveから一時展開したNode `24.22.1`でもstrict型チェックとstdio smokeを再実行して成功した。OS上のNodeやグローバルpackageは更新していない。

MCP v1はmaintenanceであり、公式はv2公開後少なくとも6か月の修正・security supportを案内している。Code Reviewと同じmajorであることだけを採用理由にせず、公開拡張のpeerが揃った段階でv2を再検証する。独自forkや恒久的な旧版固定は前提にしない。

根拠: [MCP SDK](https://ts.sdk.modelcontextprotocol.io/)、[SDK registry](https://registry.npmjs.org/@modelcontextprotocol%2Fsdk/1.32.1)、[Apps registry](https://registry.npmjs.org/@modelcontextprotocol%2Fext-apps/1.7.5)、[OpenAI拡張registry](https://registry.npmjs.org/@openai%2Fmcp-extensions/0.2.1)。

## UI buildの検証

Vite、React plugin、Tailwind Vite plugin、singlefile pluginでHTML一つを生成できた。Apps SDK UIの`Markdown`にGFMが含まれるため、別のMarkdown rendererを直接追加せずに済む。

| CSSの扱い | HTML bytes | gzip bytes | 静的な外部参照 |
| --- | ---: | ---: | --- |
| 標準CSS | 887,186 | 254,230 | KaTeX font 20件 |
| 未使用KaTeX font-faceのみ除去 | 883,923 | 253,970 | なし |
| 同梱fontをdata URLへinline | 1,232,701 | 516,620 | なし |

gzip値は当初Node 22環境の検査スクリプトによる値。Node 24でも未使用font除去版のbuildが成功し、HTMLは同じ883,923 bytesだった。圧縮量や最小サンプルのサイズを、完成したArcoのサイズ予算とはしない。

数式を有効化しない現在の基準では、該当する未使用font-faceだけをPostCSS ASTで除く。外部CDN許可を増やす必要はない。将来数式表示を選ぶ場合もローカルfont inlineが可能だが、この検証を数式機能の採用とは扱わない。

最終artifactはHTML一つで、外部script/stylesheet、CSS `@import`、外部font URL、実行コードのdynamic import、`eval` / `new Function`がないことを静的検査した。文字列検索だけでなくJS ASTでも確認した。
UIソースのtypecheck/lintも確認した。UI spikeの初期typecheckはstrict・`skipLibCheck: true`で、依存型全体の確認とは区別する。`false`で追加確認した際はApps SDK UIの`AppsSDKUI` namespace不足が出たため、製品導入時に公開の型読込み設定を整える。検証用font処理・検査スクリプトも仮コードであり、製品では型付きPostCSS処理とNode用lint設定を用意する。仮スクリプト一式に製品のlintが通ったという意味ではない。

根拠: [Vite](https://vite.dev/guide/)、[singlefile plugin](https://github.com/richardtallent/vite-plugin-singlefile)、[UI registry](https://registry.npmjs.org/@openai%2Fapps-sdk-ui/0.2.2)、[OpenAI UI guide](https://developers.openai.com/plugins/build/chatgpt-ui)。

## Code Reviewに揃える範囲

導入済み通常配布`26.1016.61520`では、React 19.2.7、Tailwind 4.3.3、TanStack Query、Node ESM、SDK 1.29.0、Apps 1.7.5を確認した。Arcoは同じ基本構成に寄せ、互換性が確認できた公開packageを使う。

- 起動は`/bin/sh`から`CODEX_MCP_NODE_PATH`のNodeを呼ぶ。第三者pluginに同じ起動契約があるかは未確認で、使用不可とも確定していない。
- GitHubは公開`gh` CLI経路と、Code Review専用のChatGPT backend経路がある。Arcoは公開CLI利用を先に検証し、専用backendを接続基盤にしない。
- SQLiteはreview記録用。ArcoへDBや任意のKeychain wrapperを追加する根拠にはしない。
- first-party bridgeの存在は、同じ操作が第三者向け公開APIとして使える根拠にはしない。

根拠: [Code Review起動設定](/Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/.mcp.json:8)、[gh認証確認](/Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/server.mjs:35709)、[review保存](/Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/server.mjs:45441)。詳しい観測は[技術スタック](technical-stack.md)を参照。

## 未検証の境界

ここまでの成功は、Codex実画面・composer選択・draft準備/送信・全表示の動作、実GitHub/Linearの認可・更新、全OSでの起動、配布資格、実装の安全性の検証を代替しない。
次セッションではこの基準で製品へ依存を導入し、Code Reviewと同じ方法で成立する部分を使い、不足が確認された範囲に限って認証・保存・配布の追加を選ぶ。
