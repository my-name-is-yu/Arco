# Arco 実装開始の引き継ぎ

Arcoの実装を、このチャットで開始してください。要件と基本技術スタックの議論は済んでいます。以下と既存ドキュメントを読み、短い実装方針を共有したら、最初の技術検証・依存導入・実装・テストへ進んでください。計画や再調査の提示だけで終わらず、動くものを作ってください。

## 作業場所と現在地

- 作業場所: `/Users/yuyoshimuta/dev/Arco`。既存のlocal checkoutを使い、新しいworktreeは作らない。
- 2026-10-22時点では、本体のpackage/lockfileや製品コードは未作成。`docs/`、`.agents/`、`experiments/`は既存の未追跡ファイルとして存在する。先に`git status`と適用されるAGENTSを確認し、既存の要件・画像・probeを削除・上書きしない。
- `experiments/inline-probe/`は本体ではない。標準metadataで会話内カードが描画され、MCP Apps bridgeが初期化されたことまでユーザー画面で確認済み。手書きJSON-RPCのprobeを製品frameworkに育てない。
- 最新のユーザー方針は「Code Reviewと同じスタックに揃えればよい」。認証・保存・配布を先回りして独自設計へ広げない。

## 読む順番

まず次の5文書を読む。確定要件・操作範囲を正とし、古い提案で上書きしない。

1. `/Users/yuyoshimuta/dev/Arco/docs/requirements.md`
2. `/Users/yuyoshimuta/dev/Arco/docs/product-scope.md`
3. `/Users/yuyoshimuta/dev/Arco/docs/issue-operations.md`
4. `/Users/yuyoshimuta/dev/Arco/docs/technical-stack.md`
5. `/Users/yuyoshimuta/dev/Arco/docs/dependency-compatibility.md`

次に接続・データ境界と画面を読む。

6. `/Users/yuyoshimuta/dev/Arco/docs/auth-distribution.md`
7. `/Users/yuyoshimuta/dev/Arco/docs/local-data-boundary.md`
8. `/Users/yuyoshimuta/dev/Arco/docs/security-and-privacy.md`
9. `/Users/yuyoshimuta/dev/Arco/docs/screen-structure.md`
10. `/Users/yuyoshimuta/dev/Arco/docs/code-review-reference.md`
11. `/Users/yuyoshimuta/dev/Arco/docs/inline-probe-validation.md`

見た目は実際の参考画像 `/Users/yuyoshimuta/dev/Arco/docs/design/references/code-review-user-reference.png` を確認する。`docs/design/images/*v2*`はArcoの構成案であり、実装済み画面や確定レイアウトではない。
`initial-view-review.md`は過去の初期実装案、`monetization-research.md`は過去の背景調査。現行scopeや提供方針を変更する根拠にしない。

## 確定事項

- ソース非公開の無料Codex plugin。採用機能をFree/Proに分けず、課金・試用期限・seat管理は作らない。
- GitHubとLinearのIssue wrapper。両方の閲覧・作成・編集・進捗変更・会話連携を完成形に含める。正本は元サービス。
- Code ReviewとLinearに近い操作感。一覧＋詳細、コンパクトな表示、素早い属性変更、検索・選択・スクロールの保持、キーボード操作。
- GitHubのOpen/ClosedとProjects Status、Linearのworkflow stateを区別する。共通workflowの合成やサービス間同期は作らない。
- 初版の会話連携は4項目すべて必須: 選択Issue/本文/コメント範囲のcontext共有、composerの`@Arco`検索・選択、現在/新しい会話への下書き準備と明示的な依頼開始、Codex tool更新を同じUIへ再取得・反映。
- 閲覧対象の選択変更だけで会話送信・進捗変更をしない。閲覧対象と会話で扱う対象を区別する。
- 2026-10-23の変更後は、global/thread入口、広い管理画面・会話横パネル・inline・fullscreenを提供する。ユーザーがPiPを不要と判断したため、実装・受入確認から外す。入口と表示modeを混同しない。
- Codexアプリが動く環境を対象にする。macOS/Windows/Linuxを想定し、実際のhost対応OS/archで検証する。特定Macの絶対pathやUnix shellに固定しない。headless/CLI向け製品へ広げない。
- UI＋端末内Node MCPから元サービスを操作する。独自backend、Arcoアカウント、SIWC、課金API、Issue DB/mirror、同期daemon、独自agent runtime・AI実行queueは作らない。別のOpenAI推論APIやAPI keyも要らない。
- 操作の詳細・上限・公式への受け渡しは`issue-operations.md`に従う。Project/cycle等の管理、移行製品、Symphonyの監視・運転管理を追加しない。

## 技術基準と互換性の注意

基本はReact/TypeScript、Tailwind/Apps SDK UI、TanStack Query、Node ESM/stdio MCP、Zod。単一package＋npm lockfile、UI/server/sharedの小さな境界で作る。UIはVite、serverはNode ESM bundle。Router・global store・rich-text editor・汎用provider framework等は必要性なく追加しない。

公開SDKの隔離検証で通った基準は次のとおり。詳細とUI/tooling版は`dependency-compatibility.md`を読む。

- `@modelcontextprotocol/sdk@1.32.1`
- `@modelcontextprotocol/ext-apps@1.7.5`
- `@openai/mcp-extensions@0.2.1`のrootと`/app`のみ。v2 serverを要求する`/server` helperをimportしない。
- `zod@4.4.3`へ統一。OpenAI拡張のexact依存と揃える。
- TypeScript `6.0.3`、bundle前提の`moduleResolution: Bundler`。
- 開発検証NodeはLTS `24.22.1`。グローバル環境を無断更新せず、現在の実行環境を確認する。

MCP Apps v2＋現OpenAI拡張はpeer不一致、OpenAI拡張0.1には`send:false`がない。全部latest、force/override、castでの回避に戻らない。
MCP/bridgeのstrict型チェック・stdio通信、最小UIのbuild・src lintは隔離環境で成功済み。ただしApps SDK UIの依存型全体は未解決箇所がある。`skipLibCheck:false`で`AppsSDKUI` namespace不足が出たので、公開の型読込み方法を確認し、検証範囲を正しく記録する。
Apps SDK UIのMarkdown/GFM部品を使えば別rendererの直接依存は不要。標準CSSの外部KaTeX font参照は、数式を使わない場合に未使用font-faceをPostCSS ASTで除く方法で単一HTML化を確認した。配布artifactの外部参照を検査する。
tempのNodeや互換性spikeは消え得る。tempの絶対pathを製品の前提にせず、記録から再現する。

## 最初に検証すること

### 1. 一般pluginとしての起動と公開SDK

Code Reviewの通常配布コードを参考に、一般pluginでも同じhost Node経路で起動できるかを、小さな検証で確認する。観測対象は通常配布plugin `/Users/yuyoshimuta/.codex/plugins/cache/openai-bundled/code-review/26.1016.61520/`だが、存在とversionを再確認する。
Code Reviewは`.mcp.json`で`CODEX_MCP_NODE_PATH`を参照する。第三者への提供は未確認であり、公開資料に見つからないだけで利用不可とも断定しない。Node同梱・独自launcher・自動installer・native保存ライブラリを先に作らない。
基準SDKを導入し、strict型チェック、stdio initialize→tool/resource一覧→resource読取→mock tool、UI buildを製品の構成で再現する。MCP stdoutへlogを混ぜない。

### 2. GitHubの公開接続とProjects

Code Reviewと同様に、公開`gh` CLIの既存認証と`gh api`をまず検証する。shell文字列へ引数を連結せず、公開コマンドを引数配列で呼ぶ。credentialをArcoへ複製・表示することを前提にしない。
選んだrepoのIssue読取、個人/組織Projectsの読取と必要な認可、採用操作への対応、CLI未導入/未認証時の導線を確認する。Code Review専用のChatGPT GitHub backendは接続基盤にしない。
公開CLI経路が要件を満たさないと分かってから、GitHub App/OAuthや直接API SDKが必要か判断する。共有`gh`認証をArcoの解除操作で暗黙に削除しない。

### 3. 会話4連携と表示の実機確認

既存probeはinline描画とbridge初期化までの証拠。composerの選択、context共有、現在/新しい会話のdraftと送信、tool更新後の同一UI再取得は未確認なので、公開SDKで一つずつ実証する。
ブラウザのmock host、stdio成功、schemaが`send:false`を受け付けたことを、Codex実機での送信成功と混同しない。Codex本体の非公開内部や認証cacheを調べる回避策は使わない。必要な画面確認はユーザーの協力を得て記録する。
実際に一つが未対応ならその境界を示し、勝手に初版要件から削らない。独自chat/runtimeで補わない。

### 4. Linearの認可

GitHubとは別に、Linearの既存公開接続を利用できるか、必要ならPKCEからlocal MCPへ戻す経路を確認する。GitHubの成功をLinear認可の成功に読み替えない。
直接OAuthとtoken保存をArcoで担う必要が確認された場合に、安全な保存・更新処理を最小で選ぶ。平文fallbackを作らず、先に大きな認証frameworkを入れない。
登録・利用資格・ユーザー操作が必要なら、必要な点だけ確認し、その間も他の実装を進める。

## 最初に成立させる動作と進め方

まず一つの実装として「GitHubのIssue一覧→詳細→本文/属性編集・コメント等の操作→会話への受け渡し→更新結果の再取得」を通す。会話4連携を初版から落とさない。Code Reviewに近い密度で、一覧の状態とdraftを保持する。
実書込みのテストはmock/fixtureから始め、実データは本人が検証用repo/Issue/Projectを指定してから行う。実Issueへのコメント・進捗・ラベル変更を任意の既存対象へ試さない。
書込みの二重実行、ラベル保持、field/Project IDの混同、bulk部分失敗、送信とdraftの区別を意味のあるテストで確認する。視覚・キーボード確認とCodex実機の結果も残す。

source切替/混在、複数account/workspace、初期ビューの最終合意は未決。ブロックしない箇所は合理的な暫定案を明記して実装できるが、最初の1repo実装を完成形の恒久制限へ変えない。Linearと、採用したinline／fullscreenの完成形も維持する。

## 作業範囲と報告

ローカルの依存導入・製品コード・テスト・文書更新を進めてよい。この新チャットは実装開始の依頼であり、再度「実装していいか」の確認は不要。
この依頼はcommit/push、repoの公開、pluginの一般公開、外部Issue投稿、source権限の変更を依頼したものではない。これらを実装開始の条件として要求しない。実データの書込み先や認可に必要な情報だけ適切な時点で確認する。
本体の変更と既存probeを区別し、ユーザーの既存作業を保つ。作業終了時は変更点、通ったcheck、Codex実機で観測できたこと、未検証/ブロッカー、次の具体作業を短く報告する。技術調査だけで終わらず、実装可能なところを動く状態まで進める。
