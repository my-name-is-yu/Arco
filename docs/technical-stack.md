# Arco 技術スタックと責務

更新日: 2026-10-24

React / TypeScript / Tailwind / Apps SDK UI / TanStack QueryのUIと、Node.js ESMのlocal stdio MCPを、一つのnpm packageとして管理する。依存はpackage.jsonとlockfileのexact versionを使う。開発基準はNode 24.22.1で、依存更新は今回の構造整理に含めない。

## 製品の境界

GitHubとLinearのIssueを取得・操作し、選んだ文脈をCodexへ渡す。Issueの正本は元サービス、会話とAIの実行はCodex / hostが担う。サービスを混在させた共通workflow、サービス間同期、独自backendやIssue DBは作らない。[製品スコープ](product-scope.md)と[操作対応表](issue-operations.md)を正とする。

## UIと状態

| 境界                | 責務                                                                         |
| ------------------- | ---------------------------------------------------------------------------- |
| アプリの入口        | 起動情報、サービス切替、表示mode、QueryClientとhost単位のsessionを組み立てる |
| GitHub / Linear画面 | 対象scope、nativeな取得・更新、一覧・詳細・作成・属性・関連Issueを扱う       |
| 共通UI              | 画面枠、通知、dialog、editorと競合比較、inline card、選択controlを表示する   |
| 取得データ          | QueryClientがIssue、コメント、metadata、画像のcacheを所有する                |
| 閲覧session         | sourceごとのscope、閲覧対象、filter、一覧位置、操作中の状態を保持する        |
| 設定・下書き        | 保存revision、保存queue、未送信入力、失敗・競合を共通の管理処理へ集約する    |
| host / 選択共有     | 表示modeと添付snapshot、ACK・削除競合、選択・注釈の位置復元を扱う            |

表示中のサービスだけをmountし、非表示側は通知でcacheを古い状態にするだけに留める。サービス切替では下書き・閲覧位置・進行中の保存を失わず、保存の完了は開始元のsessionへ戻す。閲覧対象の変更では添付を変更せず、共有・注釈の保存や削除は明示操作で行う。

共通部品は元サービスへ直接アクセスしない。GitHubのOpen / ClosedとProjects Status、Linearのworkflow、native ID、権限とページ取得の意味を共通型に押し込めない。

MarkdownはApps SDK UIを使い、raw HTMLと能動的なdirectiveを許可しない。描画部品のidentityを固定して画像の取得状態を保つ。画像はviewport付近で認証付きserver toolから読み、未開始の不要な取得はqueueから除く。tokenをiframeへ渡さない。

## MCPと元サービス

MCP入口は依存の組立、tool / resource登録、通知、stdio接続を担当する。tool引数と結果のJSON境界にZodを使い、SDK modelやcredentialを返さない。

GitHubは公開gh CLIの引数配列を使う。通信、Issue操作、属性・Projects、関連Issue、bulkの責務を分け、read / writeを明示する。既存のAPI version指定と失敗分類は維持する。

Linearは接続先検証、取得、更新、コメント・関連操作、upload・bulkを分ける。一操作内では検証済みcontextを共有し、成功後の不要な取得を避ける。更新直前の所属確認、部分成功、保存後の読取失敗を示すreceiptを維持する。

書込みのrequest IDによる重複防止、曖昧な失敗の扱い、自動再送しない方針を保つ。fixture実装はlive通信へfallbackしない。

## 端末内の保存と互換範囲

設定と下書きはrevision付きJSONをatomic writeとprocess間lockで保存する。Linear token pairはOS credential storeへ保存し、平文fallbackを持たない。保存先とデータ範囲は[端末内の境界](local-data-boundary.md)を参照する。

2026-10-24の整理で旧形式の設定補完、廃止した依頼欄のpromptText / promptTarget、単一selectionだけの旧添付復元を終了した。現在の形式と保存先を維持し、旧形式や壊れたファイルは読取エラーとして上書きせず残す。移行や自動初期化は行わない。初回のファイル未作成はdefaultSettingsで扱う。

現行のannotations配列は1件でも送る。1件時のroot selection / native情報も現在の出力として保持する。host capability差、ACKなし、遅れて届く起動情報、hostが返す実際のmodeの扱いは現行契約であり、旧保存形式とは分ける。

## buildと検証

Viteで単一HTML、esbuildでNode ESM bundleを生成する。配布物はdist/plugin、fixture専用serverや検証記録はdist/devへ分離する。UIからserverやsource SDKをimportせず、sharedへcredentialやserver実装を置かない。依存の外部KaTeX font宣言はPostCSS ASTで除く。

```sh
npm ci
npm run check
npm run test:browser
```

checkは型・lint・整形・unit / adapter・build・stdio smoke・配布物検査を行う。browserはfixture hostと配布HTMLを使う。実Codexの添付表示や実サービスへの書込み成功とは区別して[受入記録](implementation-status.md)へ残す。CI workflowはこの構造整理では追加しない。

## 履歴

- [実装開始時の技術検討](archive/technical-stack-2026-10-22.md)
- [実装開始の引き継ぎ](archive/implementation-handoff-2026-10-22.md)
- [依存互換性の検証](dependency-compatibility.md)
- [inline probeの過去の実画面検証](inline-probe-validation.md)
