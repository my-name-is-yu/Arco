# GitHub追加操作の実接続検証

確認日: **2026-10-23、00:03–00:04 JST**。ユーザーが指定したこのrepoと検証用Issueを使い、生成済み`dist/plugin/server.mjs`を公式MCP Clientからstdioで起動した。ブラウザfixtureへの書込みではなく、製品tool → 公開`gh api` → GitHubへの実際の読取り・書込みを確認した。

対象は既存の検証用 [Issue #1](https://github.com/my-name-is-yu/Arco/issues/1) と、この実行が作成した [Issue #2](https://github.com/my-name-is-yu/Arco/issues/2)。通常の既存Issueへの変更、Project・milestone・type定義の作成、認可scopeの変更はこの検証では行っていない。

## 結果

**6項目すべて成功、後片付け4項目すべて成功。server stderrは0 bytes。**

| 操作 | 実際に確認した結果 |
| --- | --- |
| ラベル定義 | 実行固有名で作成 → 名前・色変更 → Issue #1へ付与。既存`documentation`ラベルを保持 |
| 通常コメント | 本人の一時コメントを投稿。同じrequestIdで再呼出しして1件のまま。numeric comment IDで編集、リアクション追加・取消、削除 |
| Issueリアクション | 本人が未使用の種類を追加・取消。元からあったリアクションのID集合に復帰 |
| 親子Issue | 新しい子Issue #2を作成して#1へ所属 → 親解除 → 既存親を再設定 → 再解除 |
| Issue依存関係 | #2 blocked-by #1と逆方向の関係を、それぞれ追加・閲覧・解除。blocked-byとblockingの両側の表示を確認 |
| bulk部分失敗 | #2のClosed変更成功と、存在しないIssue番号`2147483647`の失敗を、別々の結果として返却 |

終了時に#1と#2はともにClosed。#1の既存ラベルID集合と状態を維持した。今回の一時ラベル定義・コメント・リアクション・親子／依存関係は削除・解除した。作成した検証Issue #2は追跡可能な状態でClosedとして残した。

## 証跡と再実行

- 実行script: [`scripts/validate-github-operations.mjs`](../scripts/validate-github-operations.mjs)
- 実行ID: `437f656b-6477-48ae-bbde-5a05b2a97cc8`
- ローカルJSON証跡: `dist/dev/github-live-validation-437f656b-6477-48ae-bbde-5a05b2a97cc8.json`
- JSONには結果・作成した対象のID・後片付け状態を記録し、credentialや取得した本文／コメント全文は保存しない。

次は**実データへ書き込む明示的な検証コマンド**。通常CIやplugin起動時には実行しない。実行固有の対象を作成するため、実行ごとに新しい検証Issueが残る。

```sh
node scripts/validate-github-operations.mjs --repo my-name-is-yu/Arco --issue 1
```

scriptは対象タイトルの`[Arco validation]`とClosed状態を確認してから書き込み、曖昧な失敗を自動で再試行しない。同一process内の重複排除と、processをまたぐexactly-once保証は別であり、後者を実証したものではない。

## この実行に含めない確認

- Projectsの取得・所属・field値更新、organization Issue fields、既存milestone／Issue typeの実書込み。この時点の通常Issue接続とProjects認可は別であり、未検証の操作を成功扱いにしない。
- Codex実機のUI表示、composerの`@Arco`、context共有、現在／新規会話の下書きと送信、実機での同一UI更新。stdio成功をこれらの完了へ読み替えない。

上記の高度属性・ID混同防止・field単位の保持・各型の値検証・bulk部分失敗・draftを消さないための失敗状態は、`tests/github-operations.test.ts`と`tests/github-operations-fixture.test.ts`で別途確認する。fixtureで全型の往復が成功したことと、今回のGitHub上の実書込み範囲を区別する。

利用した公開API: [ラベル](https://docs.github.com/en/rest/issues/labels)、[コメント](https://docs.github.com/en/rest/issues/comments)、[リアクション](https://docs.github.com/en/rest/reactions/reactions)、[親子Issue](https://docs.github.com/en/rest/issues/sub-issues)、[依存関係](https://docs.github.com/en/rest/issues/issue-dependencies)。

## Projects認可後の実接続確認

2026-10-23、GitHub Projects認可完了後に、Codexで公開されたArcoのnative MCP toolから確認した。`arco_projects`は本人`my-name-is-yu`のpersonal Projectsを正常に取得し、`projects: []`・`hasMore: false`を返した。専用Issue #1の`arco_issue_projects`も正常に取得でき、`memberships: []`・`errors: []`だった。本人の既存personal Projectは存在しないため、この対象範囲での所属・field実書込みは未実行。認可失敗やfixtureの成功とは区別する。Project・field定義は作成していない。

読取り証跡は`dist/dev/github-project-preflight.json`。既存Projectが明示された場合の検証scriptは[`scripts/validate-github-project.mjs`](../scripts/validate-github-project.mjs)で、`--project-id`を必須とする。専用Issueの作成済みitemだけを操作し、既存field値を保存・復元し、この実行で追加したitemだけを解除する。存在しない型を検証用に作成せず、利用できなかった型は結果へ記録する。

## 新しいprivate検証Projectを使う場合の準備

以下は承認前に準備した計画で、承認後の実行結果を次節に記録する。既存personal Projectがないため、本人の`Arco validation`だけを新規作成するopt-in scriptを用意した。通常起動・CIからは呼ばない。

```sh
# 読取りだけで、対象・field定義・後片付け手順を表示する。
node scripts/setup-github-project-validation.mjs --keep-open-for-ui

# 新規作成の明示承認後だけ実行する。
node scripts/setup-github-project-validation.mjs --execute --keep-open-for-ui
```

scriptは空のpersonal Projectを作り、`public:false`を明示設定して再取得する。privateであることを確認するまでIssue・fieldを追加しない。[現在の公開GraphQL API](https://docs.github.com/en/graphql/reference/projects)には`createProjectV2`のprivacy入力がないため、作成時のdefaultを前提としない。同APIでtext・number・date・single-select・iterationの検証専用fieldを作成し、製品MCPから専用Issue #1の所属と5型の設定・取得・clear・復元を確認する。field定義は製品の提供機能ではなく、この明示的なテスト準備に限る。

API検証が成功すると、field値を元へ戻してからprivate Projectと専用itemを一時的に残す。Codex内ArcoでProjects Statusを実際に操作するUI確認が終わるまで閉じない。証跡は固定5fieldと実行結果・source ID・本文のSHA-256だけを保存し、credentialや取得したIssue本文／コメントを保存しない。曖昧なmutation失敗を自動再試行しない。

UI確認後、setupが出力したJSON証跡を指定して後片付けする。

```sh
node scripts/cleanup-github-project-validation.mjs --receipt dist/dev/github-project-setup-<run-id>.json
```

cleanupは本人・Project名・private・専用Issue・作成済みitem IDを再確認し、そのitemだけを解除する。Projectに別itemがないことを確認してからprivateのままClosedにする。Projectと検証専用fieldは追跡用に残す。UI確認のための保持は完了扱いにせず、証跡に`cleanupPendingUi:true`を記録する。

## 承認後のprivate Project実書込み結果

2026-10-23 **07:37–07:39 JST**、ユーザーが個人の非公開検証Project作成を承認した後に実行した。作成先は本人の[Arco validation #1](https://github.com/users/my-name-is-yu/projects/1)、対象Issueは専用の`my-name-is-yu/Arco#1`だけ。createの返却値は`public:false`で、さらに明示設定と再取得でprivateを確認してから内容を追加した。組織Project・無関係なIssueは操作していない。

| 実接続で確認した操作 | 結果 |
| --- | --- |
| text / number / date / single-select / iteration | 全5型で設定 → 製品toolによる再取得 → clear → 再取得 → 元の値へ復元 → 再取得が成功 |
| 検証後の復元 | 5fieldの復元とIssue本文・状態・担当者・ラベルの保持、計6項目すべて成功。server stderrは0 bytes |
| built-in Status | native `arco_project_status`でDone → In Progress、generic fieldでclear、native toolで元のDoneへ復元。各段階の再取得に成功し、IssueはClosedを維持 |

公開APIで作成したfield定義は、この承認されたテスト準備だけに限る。製品からProject・field定義を作成する機能を追加したものではない。iterationも現在の公開APIを使い、取得したnative IDで検証した。

Projectの`items.totalCount`・`items.nodes`が空を返す一方、専用Issue側の所属取得とitem IDの直接取得が同じ非archive itemを返す不整合を観測した。初回setupの集計値guardがProjectを早く閉じたため、同じ本人のprivate検証Projectと作成済みitemを直接確認して再度Openにした。新しいProjectやitemは追加していない。証跡には初回の失敗と回復を両方保持した。scriptは現在、UI準備にexact item IDの所属再取得を使い、未知のitemや不完全な一覧があればProject状態を変えずに停止する。

- setup・回復証跡: `dist/dev/github-project-setup-f4f6bf78-657c-44f6-98b1-d4bce6a7b0f8.json`
- 5型の製品MCP検証: `dist/dev/github-project-validation-f4f6bf78-657c-44f6-98b1-d4bce6a7b0f8.json`
- native Status検証: `dist/dev/github-project-status-f4f6bf78-657c-44f6-98b1-d4bce6a7b0f8.json`

**実機UI確認と最終cleanupも完了。** ユーザーがCodex内Arcoの#1詳細右側の`Projects Status`にある`Arco validation status`を`Done`から`In Progress`へ変更し、IssueがClosedのままであることを確認した。root側でもnative `arco_get_issue` / `arco_project_fields`から`In Progress`のsource option ID `47fc9ee4`とClosed状態を再確認した。選択肢は`Todo`・`In Progress`・`Done`だった。

2026-10-23 **07:42 JST**、rootがUI更新検証用の一時タイトルを元へ戻した後、review済みcleanup scriptを実行した。Statusを元の`Done`へ戻してから作成済みexact itemだけを解除し、ProjectはprivateのままClosedにした。Issue本文・タイトル・状態・担当者・ラベルのSHA-256 fingerprintは元と一致した。終了後のnative `arco_get_issue`は元タイトル・Closed・`projects: []`、`arco_issue_projects`は`memberships: []`・`errors: []`を返した。setup証跡は`complete:true`・`cleanupPendingUi:false`・`statusRestoredBeforeItemRemoval:true`・`issueContentUnchangedAfterUi:true`。

作成したprivate Projectと検証専用field定義は追跡用に残り、専用Issue itemは残っていない。この確認はProjects Statusの実UI操作に関するもので、別途発見されたPiP表示の問題を完了扱いにはしない。
