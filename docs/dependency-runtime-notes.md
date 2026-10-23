# 依存関係と配布bundleの検証メモ

確認日: 2026-10-22。現在のlockfile・インストール済みpackage・生成bundleを対象とした記録。依存の更新、override、パッチ適用は行っていない。

## npm auditのbaseline

`npm audit --json` はexit 1。対象packageは6件: high 1、moderate 1、low 4、critical 0。これは依存グラフの検出結果であり、6種類の独立した実行可能な攻撃を実証したものではない。

| 対象 | 現在版・導入元 | auditの検出 |
| --- | --- | --- |
| `lodash` | `4.17.21`。Apps SDK UI `0.2.2`のexact依存 | high: `template`のimports keyに関するコード挿入、moderate: `unset` / `omit`のprototype property削除 |
| `@openai/apps-sdk-ui` | `0.2.2`。直接依存 | moderate。上記lodashとmath関連の依存による集約 |
| `katex` | `0.16.47`。`rehype-katex@7.0.1`と`remark-math@6.0.0 → micromark-extension-math@3.1.0` | low: 既存のprototype pollution等によるtrust制約回避 |
| `rehype-katex` / `remark-math` / `micromark-extension-math` | 上記と同じ経路 | low。KaTeXの影響を依存グラフ上で継承 |

公開advisoryの対象は、[lodash template](https://github.com/advisories/GHSA-r5fr-rjxr-66jc)、[lodash array path bypass](https://github.com/advisories/GHSA-f23m-r3pf-42rh)、[先行するlodash unset / omit](https://github.com/advisories/GHSA-xxjr-mmjv-4gpg)、[KaTeX trust restrictions](https://github.com/advisories/GHSA-238p-pmpm-9mq7)。lodashの現行2件の修正版は4.18.0、先行advisoryは4.17.23、KaTeXの修正版は0.18.2。現在のlockfileには未反映。

## 実際のbundleに含まれるもの

Viteの`generateBundle`で単一HTMLへのinline前のchunk module一覧と`renderedLength`を取得し、`dist/dev/ui-module-report.json`へ保存する。これは開発用の根拠で、`dist/plugin`へコピーしない。moduleがtransformされたことと、実際に出力へ残ったことを区別する。

| module | UIの出力 | Node serverの出力 |
| --- | --- | --- |
| `node_modules/lodash/*` | 0 module | 0 module |
| Apps SDK UIの`components/Slider/*` | 0 module | 0 module |
| `lodash.debounce/index.js` | 1 module、renderedLength 4,161 | 0 module |
| `katex/dist/katex.mjs` | 1 module、renderedLength 483,471 | 0 module |
| `rehype-katex/*` | 2 modules、2,477 | 0 module |
| `remark-math/*` | 2 modules、922 | 0 module |
| `micromark-extension-math/*` | 4 modules、7,354 | 0 module |

`renderedLength`はminify前のmodule寄与量であり、HTMLの実ファイルサイズや転送量ではない。今回のUI reportは1,240 modules。serverは`build-server.mjs`と同一条件に`metafile:true, write:false`を加えたesbuild出力で確認し、`dist/dev/server-module-report.json`へ記録した。分析用出力と当時の`dist/plugin/server.mjs`のSHA-256は一致した: `ddbff2d37b27148661117cdbaf63c4a143df2db0ddaf32f73578c1b1fa137e5c`。以後のbuildではhashは変わり得る。

Apps SDK UIの`Slider/Slider.js`は`lodash/clamp`と`lodash/round`をimportするが、現在のArcoはSliderをimportしておらず、このlodash packageは現在のUI/server出力に残っていない。別packageの`lodash.debounce@4.0.8`は`usehooks-ts`経由でUIに残る。今回のlodash advisoryのpackage名・対象関数と同一視しない。

一方、`Markdown/Markdown.js → useMathPlugins.js → import('remark-math') / import('rehype-katex')`のmath依存は、単一HTMLへまとめたUIに残る。Arcoの`IssueMarkdown`は`includeMath={false}`を明示し、依存側のeffectも`enabled === false`ではmath pluginの読込・有効化へ進まない。しかし、**数式を無効化したことはKaTeXコードの配布除去を意味しない**。この確認ではKaTeXの攻撃経路や全入力の到達不能性を実証していない。標準CSSのKaTeX font-face除去も、JSの除去とは別の処理。

## UIに残る2つのFunction式

生成HTMLをAcornで解析すると、次の2式が残る。入力文字列の動的実行機能をArcoが追加したものではない。

1. `lodash.debounce/index.js`の`Function('return this')()`。`freeGlobal || freeSelf || ...`のglobal取得fallback。通常のブラウザiframeでは`self.Object === Object`が成立するためfallbackへ進まない。serverにはこのmodule自体が残らない。
2. `zod/v4/core/util.js`の空文字列`Function('')`。eval利用可否のfeature test。`globalConfig.jitless`で先にreturnするguardがあり、Arcoは`src/ui/zod-config.ts`をSDKより先に読み、`z.config({ jitless: true })`を設定する。serverにもZodは残るが、iframeのCSPとNode実行を混同しない。

`scripts/check-artifact.mjs`は空文字列と`return this`だけを許容し、その他の直接`eval` / `Function`、dynamic import、外部script/style/CSS URL等を拒否する。ASTで式が残ること、guardがあること、実際のCSP下で実行されなかったことは別の証拠。unsafe-evalを許可しないブラウザharnessでの`securitypolicyviolation`確認と、Codex実機での確認を別に記録する。

再確認は`npm audit --json`、`npm ls lodash lodash.debounce katex rehype-katex remark-math micromark-extension-math`、`npm run build`、module report、`npm run check:artifact`、CSP付きブラウザcheckの順で行う。依存やUI importを変更した際には、このbaselineを流用せず再生成する。
