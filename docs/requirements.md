# Arco 要件定義

更新日: 2026-10-23
状態: v1.2 / 完成形の操作範囲・基本技術スタック・ソース非公開での無料提供を採用。端末内のMCPから元サービスへ直接接続し、plugin公開を目指す。具体的な利用許諾・公開配布方法は未決。

実装と受入確認の現在地は[実装・受入確認](implementation-status.md)に記録する。以下の製品要件と、実サービス・Codex画面で確認済みの範囲を区別する。

## 目的

Codex内でGitHub・LinearのIssueを快適に表示・操作し、同じIssueを見ながら相談・依頼・更新まで行えるクライアントを作る。
まず開発者本人が使う個人向けの版を作り、その後の公開を目指す。
本格的なCodex pluginの実装を学ぶ目的も持ち、会話内カード（inline）と詳細画面（fullscreen／会話横）を用意する。PiPは2026-10-23のユーザー希望で対応範囲から外した。
ソース非公開の無料pluginとして公開し、実際の利用と継続的な改善を、pluginの設計・実装・運用の実績として育てる。現時点ではOSS化しない。

Code ReviewとLinearに近い使用感を目指すことを、ユーザー指定の方針として採用する。次の具体的な操作体験を要件案として詰める。

- 一覧から目的のIssueを見つけやすい。
- 一覧の位置や絞り込みを保ったまま、詳細を読んで編集できる。
- キーボードで主要な操作ができる。
- 複数のIssueをまとめて整理できる。

Code Review・Linearに近い操作感を目指し、完成形で担う責務と非目標を先に定める。実装順や初版の範囲は別に整理する。

## 確定した方針

| 項目           | 方針                                                                                                                                                                                                                          |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 利用場所       | MagicPathのように、Codex内で表示・操作するMCP Appを目指す。                                                                                                                                                                   |
| 最初の利用者   | 開発者本人。後から他の利用者に公開したい。                                                                                                                                                                                    |
| 配布目標       | 無料のpluginとして公開する。公開経路・審査条件は確認中。                                                                                                                                                                      |
| 提供料金       | 採用済みの製品範囲を無料で提供する。有料プラン、試用期限、課金のためのrepo/team数・利用量制限は設けない。Codex・元サービス側の料金や権限は各サービスの条件に従う。                                                            |
| ソース公開     | 現時点ではソース非公開。開発repoを非公開で管理し、pluginの配布成果物を無料提供する。利用許諾と依存物のlicense noticeは別途整える。                                                                                            |
| 認証           | GitHub/Linearを本人の権限で操作するsource認可を行う。Arco独自アカウント、Sign in with ChatGPT、利用権確認は要件から外す。                                                                                                     |
| データ最小化   | UIとlocal MCPを端末で動かし、元サービスへ直接接続する。Arco独自backend・アカウントDBを持たない構成とする。source認可・公開配布の成立は別途実証する。                                                                          |
| 技術スタック   | React/TypeScript/Vite、Tailwind/Apps SDK UI、TanStack Query、Node.js/TypeScript、公式MCP SDK/MCP Apps/OpenAI extensions、Zod。[採用構成](technical-stack.md)を参照。                                                          |
| 技術選択の基準 | Code Reviewと同じ基本構成とbundle方式に寄せ、同じ方法で成立するものへ独自の仕組みを足さない。公開SDKの基準versionは[互換性検証](dependency-compatibility.md)に従う。専用backendやfirst-party bridgeの利用可否は別に確認する。 |
| 対応環境       | Codexアプリが動く環境で使えることを目指す。macOS・Windows・Linuxを想定し、実際のhost対応OS/archで検証する。headless/CLI向け機能を自動追加しない。                                                                             |
| 対応サービス   | 完成形ではGitHub・Linearの両方を閲覧・編集・進捗変更・会話連携まで扱う。個人利用でGitHubへ管理を統一する当初の意向と、製品の対応範囲は分ける。                                                                                |
| 進捗の保存先   | GitHubではProjectsのStatus、Linearでは元のworkflow stateを使う。各サービスの値を正とする。                                                                                                                                    |
| 操作体験       | Codex内で普通のアプリとして快適に操作でき、選んだIssueをそのまま会話へ渡せる。                                                                                                                                                |
| 初版の会話連携 | Issue全体の共有、Arco内の選択テキストの共有、`@Arco`でのIssue選択、Codexによる更新のUI反映を含める。添付表示と相談入力はCodexが担う。                                                                                         |
| 使用感の参考   | Code ReviewとLinearに近づける。一覧と詳細の行き来、情報密度、検索、すばやい属性変更、キーボード操作を具体化する。                                                                                                             |
| 表示形式       | 広い管理画面と会話横表示を軸とし、inline・fullscreenを用意する。PiPは2026-10-23に採用を取り消した。サイドバーと会話横の入口も対象とする。                                                                                     |
| 学習目的       | 単なるツール連携にとどまらず、本格的なCodex pluginを実装する練習も兼ねる。                                                                                                                                                    |
| 製品の責務     | GitHub・LinearのIssue wrapperとCodex接続を担う。独自runtimeを作らず、Issueの保存は元サービス、会話とAIの実行はCodex／hostへ委ねる。                                                                                           |
| 初版の中心     | GitHub Issuesの管理と、会話・Issue操作を往復できる連携を成立させる。個々の管理操作の範囲は下記で分ける。                                                                                                                      |
| ラベル         | 通常のIssue管理に加え、将来のSymphony連携にも使えるよう管理する。                                                                                                                                                             |
| Symphony       | 通常のラベル・属性操作まで。専用の監視・運転管理は製品に含めない。                                                                                                                                                            |

対応範囲は[Issue操作対応表](issue-operations.md)に固定する。公開APIの全操作や将来追加される機能に自動追随する要件ではない。

## 最終製品の責務と非目標

- Arcoの責務は接続先Issueの取得・表示・更新と、Codexへの文脈の受け渡しとする。
- 独自agent runtimeを作らず、元サービスのIssueデータとCodexの会話・AI実行を利用する。
- GitHub・Linearの通常の編集対応と、サービス間のmirror・同期・共通workflowの所有は別の製品機能として区別する。
- MCPサーバー、認証処理、API adapter、表示用cache・再取得は、この責務を満たすための実装である。
- 保存フィルターや複数repo対応はUI設計の選択肢であり、最終版の恒久的な非目標へ自動昇格させない。
- 採用済みの会話連携4項目と採用表示形式への対応を維持する。
- 課金、契約・seat管理、試用期限、署名付き利用権、Arco独自の本人確認・アカウント管理は作らない。無料化を理由に独自のチーム管理やデータ収集を足さない。

責務と非目標は[最終製品スコープ](product-scope.md)、採用操作は[Issue操作対応表](issue-operations.md)を正とする。サービス間同期、独立したPM機能、移行製品、Symphonyの運転管理は範囲外に確定した。

初期ビュー・横断範囲の比較と、独立した2 subagentの敵対的レビューは[レビュー記録](initial-view-review.md)を参照。同資料の初期実装案は、最終版のスコープ上限ではない。

## データの扱い

- Issueの本文・コメント・担当者・ラベル・状態は、元のGitHubまたはLinearの内容を正とする。
- Arcoだけが持つ独立したIssueや進捗状態を作らない。
- 元サービス側での変更は、再取得するとArcoにも反映される。
- 保存した更新は、再読み込み後も元サービスの内容と一致する。
- 一覧の選択位置・表示方法・検索条件など、表示のための設定はIssueのデータと区別する。
- sourceと元のIDを保持し、GitHubのOpen／Closed・Projects Status、Linearのworkflow state、Symphonyの実行状況を混同しない。
- source tokenは端末内の安全なcredential storageで扱い、UI・モデル向け結果・ログへ返さない。cache・下書き・設定も端末側へ置く。
- IssueデータをArcoの自前サーバーへ送らない。元サービスとのAPI通信と、会話へ渡す情報のCodex/hostへの共有は必要になる。[データ境界](local-data-boundary.md)と[セキュリティ・プライバシー](security-and-privacy.md)を参照。

## 主な利用場面

1. GitHubの対象repoやLinearの対象team等のIssueを見渡し、検索・絞り込みで次に扱う仕事を選ぶ。
2. 詳細とコメントを読み、Issueを作成・編集し、担当者・ラベル・状態を更新する。
3. ラベルの定義と付け外しを管理し、複数のIssueを整理する。
4. 日々の作業の進捗を、GitHub ProjectsのStatusまたはLinearのworkflow stateで管理する。
5. 選んだIssueを会話へ渡し、本文やコメントを見ながらCodexへ相談・依頼する。

最終製品の責務と非目標、sourceごとの操作・管理対象、基本技術スタックは確定した。続いて認証・配布、会話連携と表示の詳細を詰め、その後に実装順と初版範囲を決める。
中心となる一巡は「Issueを探す → 詳細を読む・整理する → 選んだIssueを会話へ渡す → Codexへ相談・依頼する → 必要な更新を元サービスへ保存する → 同じUIへ反映する」とする。
一覧の入口や具体的な操作UIは、以下の未決事項として選ぶ。更新操作の採否は操作対応表に従う。

## 製品の機能範囲と初版必須項目

### 使用感を具体化する案

Code Review・Linearに近い使用感は採用済み。一覧と詳細を行き来しやすく、情報密度を保ち、主要な操作をすばやく行えることを目指す。初期ビューはD02の方針を採用し、厳密な配置・キー割り当て・一括操作の範囲は引き続き詰める。U06の会話連携は初版必須。

| ID  | 操作                  | 期待する振る舞い                                                                                                                                                                                                                                                        |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U01 | 一覧から読む          | コンパクトな行を選ぶと同じ画面の詳細が切り替わる。詳細を閉じたり別Issueを読んだりしても一覧の位置・選択・検索条件が保たれる。                                                                                                                                           |
| U02 | 一覧で整理する        | Status・担当者・ラベルを一覧や詳細の小さなメニューから変更できる。対応する一括操作は複数選択から同じ操作系で行う。                                                                                                                                                      |
| U03 | 検索・キーボード操作  | タイトル検索とIssue URLの貼り付けで対象を開ける。検索、新規作成、一覧移動、詳細の開閉、主要な属性変更にキーボードから到達できる。キーはhostとの競合を確認して決める。                                                                                                   |
| U04 | 見る対象を絞る | GitHubのglobal入口はMy issues、thread入口はProject issuesを開く。現行Codex pluginではrepoを選択し、チャットごとに記憶する。個人ビューは初回Assigned to meで、作成・メンション・All account repositoriesへ明示切替する。個人とrepoの条件を別々に保存し、空でも範囲を自動拡大しない。 |
| U05 | 情報を見渡す          | 高さを抑えた行と小さなツールバーを使い、本文の読みやすさを保つ。狭い領域では情報の優先順位を保って再配置する。                                                                                                                                                          |
| U06 | 会話とIssueを往復する | Issue全体やArco内の選択テキストをAdd to chatでCodexへ渡し、Codexの通常入力欄から相談する。添付のタイトル・グループ表示はCodexが担う。CodexによるIssue更新は同じ詳細画面へ再取得して反映する。閲覧・選択だけでは共有せず、Arcoから依頼送信しない。                       |

U04は2026-10-23に更新したD02に従う。global入口の初回はrepo入力なしでAssigned to meのOpen Issueを更新順に取得する。thread入口は確定したrepoだけを取得し、repo不明時に個人一覧へ切り替えない。Created by me・Mentioned me・All account repositoriesへの切替と、repoの手動選択は明示操作で行う。接続権限を超える公開repo全体の検索や、repoごとの全件走査は行わない。Open／ClosedとProjects Statusは別の値として扱い、Project未追加のIssueを消したり、独自のStatusで補ったりしない。
複数対象の表示と採用済み一括操作も無料で提供する。保存したビュー等の具体的なUIは引き続き採否・詳細を詰め、採用する場合も無料とする。以前の料金案にあった「単一対象まで無料」という境界は採用しない。
初期ビューの範囲はD02で確定し、具体的なレイアウトと実Codex上の受入確認は分けて扱う。

### 初版必須の会話連携

2026-10-23のユーザー希望を反映し、次の4項目を初版に含める。採用済みの要件と、Codex上での実装・実機確認の進捗は分けて管理する。

- Issue全体をAdd to chatでコンテキストとして共有し、Codexの通常入力欄から相談を続けられる。
- Arco内のテキストを選択すると小さなAdd to chatが現れ、その明示操作で選択範囲を共有する。Arcoは複数の選択を青く保持し、追加順の番号と各項目の任意コメント欄を表示する。添付のtitle/groupを渡し、タイトル・グループ付きの添付表示はCodexが担う。
- 会話入力欄の`@Arco`からIssueを検索・選択できる。
- CodexもMCP toolで同じsourceのIssueを読み書きでき、Arcoがその結果を再取得して詳細やカードに反映する。UIの更新通知が自動で全画面へ配信される前提にはしない。

本文または単一コメントの内側に収まる選択ではnativeのoriginを保持し、コメントにはnative comment IDを添える。タイトル・属性・一覧などのテキストはoriginをuiとし、単一Issueに安全に対応する場合だけ最小限のnative識別情報を添える。異なるIssue領域にまたがる範囲は一般のArcoコンテキストとして共有し、任意のIssueを対象に選ばない。選択共有にIssue本文全体を補わない。

追加した選択と任意コメントを注釈集合として保持し、各番号から他の項目を変えずに再編集できる。閲覧先の変更で注釈を失わない。集合全体を公開modelContext一件として更新し、複数時は`source: arco`の`annotations`配列に各選択とnative Issue識別情報を保持する。任意の単一Issueへまとめず、一件時は従来のsourceとselectionも保持する。通常の会話入力・送信はCodexが担う。注釈の保存・取消と表示の詳細は[画面構成](screen-structure.md#会話とissueを往復する操作)に従う。

各選択を番号・短文title付きの個別content blockとし、共通の`N annotations`groupをCodexへ渡す。全注釈のデータは一件のassistant向けJSONとstructuredContentに保持し、添付の項目表示はCodexが担う。

公開仕様では`ui/update-model-context`とcomposer mentionsが根拠になる。旧UIでは実GitHub・LinearのIssue全体・本文／コメント範囲のモデル受信と、同じ詳細へのtool更新反映を確認した。全域の選択共有、添付表示、実composerのmention、inlineからの復帰等の確認は[実装・受入確認](implementation-status.md#codex実画面の受入確認)に記録する。fixtureやhost成功通知だけで実Codexの受入確認を完了したとは扱わない。
参考: [コンテキスト拡張](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#uiupdate-model-context-extensions)、[Composer mentions](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md#composer-at-mentions)。

参考: [Code Reviewの調査](code-review-reference.md)、[Linear My issues](https://linear.app/docs/my-issues)、[Linear Display options](https://linear.app/docs/display-options)、[Linear Custom Views](https://linear.app/docs/custom-views)。

### 機能の一覧

F12の会話連携は初版必須。その他の操作も完成形の採用範囲は[Issue操作対応表](issue-operations.md)で確定した。提供順と初版の範囲は別に決める。Linearの全操作を初版で提供するまで自動的に確定したとは扱わない。

| ID  | 領域                   | 操作・表示                                                                                                                                   |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 | Codex内の表示          | 会話と併用できる画面を開く。Codex内の実際の表示と操作を確認する。                                                                            |
| F02 | 対象の選択             | sourceと権限のあるrepo・team等を選択・切り替え、対象範囲を明示する。                                                                         |
| F03 | 一覧                   | テキスト検索、元サービスの状態・担当者・ラベルでの絞り込み、並べ替え。GitHubのPRはIssue一覧に混在させない。                                  |
| F04 | 詳細                   | タイトル、Markdown本文、担当者、ラベル、状態、コメントを表示する。                                                                           |
| F05 | Issue操作              | 作成、タイトル・本文の編集、元サービスの状態変更。GitHubではClose／Reopenを扱う。                                                            |
| F06 | 担当者・ラベル         | Issueへの追加・取り外し。                                                                                                                    |
| F07 | コメント               | 閲覧・投稿と、権限に応じた編集・削除。                                                                                                       |
| F08 | ラベル定義             | 元のrepo・workspace・teamの範囲で一覧・作成・名前/色/説明の変更・削除。group再編やscope移動は公式へ渡す。                                    |
| F09 | 一括操作               | 同じsourceで適用先と値が明確な選択に対する状態・担当者・ラベル・対応属性値の変更。本文・コメント・関係・定義管理・移管のbulkは含めない。     |
| F10 | キーボード操作         | 検索、一覧の移動、詳細の開閉、主要な編集操作。具体的な割り当ては画面設計時に決める。                                                         |
| F11 | 進捗管理               | GitHub ProjectsのStatusとLinearのworkflow stateを表示・変更する。元サービスの定義を保持し、所属先の選択・追加方法は別に具体化する。          |
| F12 | 会話との連携・初版必須 | Issue全体とArco内の選択テキストをAdd to chatで共有、`@Arco`からのIssue選択、Codexのtool更新のUI反映。添付表示・相談入力・送信はCodexが担う。 |

F12の4項目は初版の必須要件として採用済み。Issue全体と選択テキストを共有でき、閲覧対象とは別に保持する。2026-10-23のユーザー希望により、Arco内のAsk Codex・Send request・依頼欄を削除し、相談はCodexの通常入力欄へ集約する。Arcoからmessage送信・composerへの下書き準備・新規会話作成は行わない。Issue作成・編集・コメントの端末内下書き保存は保持する。具体的な表示は[画面構成](screen-structure.md)、実機での確認状況は[実装・受入確認](implementation-status.md)に従う。
表示形式はinlineとfullscreenを採用する。2026-10-23の変更でPiPは対象外とした。

複数対象の一覧は採用済み。GitHub／Linearを切り替え、GitHubはD02の個人一覧またはrepo、Linearは本人認可済みworkspace/teamを選ぶ。sourceを混在させた共通workflowは作らない。一括操作の採用範囲は操作対応表に従う。
GitHub ProjectsのStatusと既存属性値の編集は含め、Projects自体の管理は含めない。

## 正しく操作できることの条件

- sourceと元のIDで対象を特定し、repo・team等と人間向け識別子を表示して操作する。
- ラベルを追加・取り外しするとき、指定していない既存ラベルを保持する。
- 同名ラベルでもリポジトリが異なれば別の定義として扱う。
- ラベル定義の削除は、Issueから一つ取り外す操作と区別し、適用先への影響が分かるようにする。
- 権限不足・通信失敗・API制限を保存成功として扱わない。
- 保存に失敗した場合は入力内容を保持し、再試行できるようにする。
- 一括操作が一部失敗した場合は、成功と失敗をIssueごとに確認できる。
- 更新では意図しない項目を変更しない。競合が判明した場合は、最新の内容を確認して操作を選び直せるようにする。
- 狭いCodexパネルでも主要操作へ到達できる。

## 受入シナリオ案

1. Codex内でArcoを開き、実際のGitHubデータを読み、Issueの更新まで行える。ブラウザ単体で動くことだけでは完了としない。
2. Issueを作成し、本文・担当者・ラベルを変更して再取得しても内容が一致する。
3. コメントを投稿し、Close／Reopenした結果をGitHub側でも確認できる。
4. ラベル定義の作成・編集とIssueへの付け外しを行い、別リポジトリの定義に影響しない。
5. 複数Issueへのラベル操作で、無関係な既存ラベルが残り、一部失敗も判別できる。
6. GitHub側でIssueを変更し、Arcoで再取得すると変更が見える。
7. 検索・詳細閲覧・編集を繰り返しても、一覧の位置や検索条件が不必要に失われない。
8. ProjectsのStatusを変更し、GitHubとArcoの双方で一致することを確認する。
9. 選択Issueを会話へ渡し、意図したリポジトリとIssueの情報がCodexに届く。
10. 本文または単一コメントの一部を選択し、小さなAdd to chatで共有すると、選択範囲とnativeのoriginがCodexへ届く。コメントにはnative comment IDを添える。複数箇所の青いハイライトと連番を保持し、各注釈を元の選択文や他の項目と別に更新できる。
11. 会話入力欄の`@Arco`からIssueを検索・選択し、意図したIssueが添付される。
12. タイトル・属性・一覧などArco内のテキストにも選択時のAdd to chatが現れ、originがuiのコンテキストを共有できる。異なるIssue領域にまたがる選択を特定Issueへ誤対応させない。添付のタイトル・グループ表示と相談入力はCodexが担い、Arcoから依頼送信・下書き準備・会話作成をしない。
13. CodexがMCP toolでIssueを更新し、同じIssueの詳細やカードがGitHubの保存結果を再取得して反映する。失敗を保存成功として表示しない。
14. 完成形ではLinearでも採用した編集・workflow state変更・会話連携を行い、元のLinearとArcoの再取得結果が一致する。Arcoは指定した対象へ書き込み、source側の既存automationによる変化も再取得する。GitHubへのサービス間同期は行わない。
15. Arco独自アカウント登録・支払い・利用権確認なしで導入し、source認可後に採用操作を利用できる。横断表示や一括操作にも料金由来の制限が出ない。

最終版ではinline・fullscreenとglobal・threadの入口をCodexで確認する。PiPの実装・受入確認は対象外。表示形式ごとに役割と操作を定め、同じアプリを開き直すだけの形式的な対応にしない。

2026-10-22、最小probeの標準経路でCodexの会話内カード表示とMCP Apps bridgeの初期化を実画面で確認した。[検証記録](inline-probe-validation.md)。Arco本体の操作・会話への受け渡し・他の表示形式は引き続き実装後の確認対象。

9〜13は既に初版必須として採用した会話連携を検証するシナリオ。確定した操作対応表と、今後詰める表示仕様を基に、各シナリオの提供段階を割り当てる。

## 設計の決定状況

| ID  | 項目                       | 決定・残る設計                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D02 | 初期ビューと横断範囲 | 2026-10-23、入口ごとに役割を分離。globalはMy issues、threadはProject issuesを開く。現行Codex pluginから作業場所を取得できないため、ユーザーの選択によりrepo選択式で提供し、選択はチャットごとに保存する。個人の初回はAssigned to meで、作成・メンション・All account repositoriesへ明示切替する。個人・repoの表示条件を分け、空でも範囲を自動拡大しない。 |
| D04 | 最終版の操作対応表         | 確定。[Issue操作対応表](issue-operations.md)の操作・対応型・公式への受け渡し・非目標を採用。提供順は別途決める。                                                                                                                                                                                                                      |
| D03 | 採用済み会話連携の詳細     | Issue全体とArco内の選択テキストをAdd to chatで共有し、閲覧対象とは分離する。添付のtitle/groupをCodexへ渡し、相談入力はCodexに任せる。tool通知と定期再取得を用い、実composerと全表示の受入確認は[実装・受入確認](implementation-status.md)に従う。Arcoから依頼送信・下書き準備・会話作成や既存chat/worktreeへの振り分けは行わない。    |
| D01 | 表示ごとの画面構成         | 一覧と詳細を併置し、狭いパネルでは切り替える。inlineは共有対象の要約と詳細への入口を持つ。対応modeはinline／fullscreenとし、PiPは2026-10-23のユーザー希望で対象外。実Codexでの全遷移の確認を残す。                                                                                                                                    |
| D05 | Linear対応の具体化         | 本人のOAuth接続とnative workspace/team選択、GitHubとのsource切替を実装した。共通workflowとsource間同期は行わない。実接続と採用操作は[Linear検証](linear-validation.md)、会話連携の残りは受入記録に従う。                                                                                                                              |
| D06 | 管理対象オブジェクトの境界 | 確定。Issueと既存の所属先・属性値を操作し、Project・cycle・milestone等そのものの管理は含めない。ラベル定義管理は明示的な例外。                                                                                                                                                                                                        |
| D07 | 移行・Symphony等の境界     | 確定。移行製品、サービス間同期、Symphonyの監視・運転管理は含めない。                                                                                                                                                                                                                                                                  |
| D08 | 技術スタック               | Code Reviewへ基本構成を揃え、[技術スタック](technical-stack.md)と[公開SDKの互換性基準](dependency-compatibility.md)で実装を開始する。依存導入時にexact versionとlockfileを記録する。                                                                                                                                                  |
| D09 | source認証・配布           | [端末内のデータ境界](local-data-boundary.md)を維持する。このMacのNode起動、公開`gh`での採用操作・Projects認可、Linearの直接OAuth・OS保存・token更新を実証した。公開資格・配布経路は未確定。独自account APIやremote MCPは作らない。                                                                                                    |
| D10 | 提供料金                   | 確定。採用済み機能を無料提供し、Free/Pro分岐・trial・seat課金は作らない。[課金事例調査](monetization-research.md)は過去の背景資料としてのみ残す。                                                                                                                                                                                     |
| D11 | ソース公開・利用許諾       | ソース非公開での無料配布に確定。具体的な利用条件、依存物のlicense notice、公開する導入資料・設計解説の範囲を決める。                                                                                                                                                                                                                  |
| D12 | 対応OS・導入条件           | Codexアプリが動く環境を対象とする方針に確定。macOS・Windows・Linuxを想定し、実際の対応OS/archで起動・保存・更新を検証する。Nodeの手動導入要求・同梱・独自launcherは今の段階で確定せず、既存hostの起動契約を先に確認する。                                                                                                             |

ProjectsのStatusはプロジェクトの項目に属するため、採用時は対象プロジェクトとIssueの追加方法を決める。複数のProjectsに所属するIssueの進捗を一つとみなさない。

ユーザーは、プラグインの表示仕様からUXを検討したいと希望し、MagicPathを優れたサードパーティ実装例として挙げた。調査は[プラグイン表示・UX調査](plugin-ux-research.md)、具体的な画面構成案は[画面構成](screen-structure.md)を参照する。詳細な配置や遷移は提案として扱う。

画面の参考として、OpenAI公式Code Reviewプラグインも指定された。[公開docs・導入済みソース・ユーザー提供画像の調査](code-review-reference.md)を基に、情報階層と表示密度を画面構成案へ反映した。公式専用のhost連携と、第三者plugin向けの公開APIは区別する。

## 続いて整理すること

- source認証・配布方式と公開審査の条件。API・UI・host連携の責務を具体化する。
- 完成形のsource切替／混在、初期ビュー、複数アカウント・workspaceの採否。対応OSの方針に沿った実動作を確認する。
- ソース非公開の無料配布に適した利用許諾と、公開する導入資料・設計解説の範囲。
- 一度限りの既存Linearデータの移行が本人に必要なら、製品機能とは別の作業として整理する。
- 初版で使うリポジトリ・Projectsと、必要なGitHub権限。
- 個人版の認証・導入方法と、後の公開に必要な配布方法。

## 採用操作と範囲外の扱い

- 既存milestoneの指定、Issueタイプ、親子・依存、リアクションは含める。
- 既存Issue/Projects fieldの対応型の値編集は含め、定義・選択肢や共有Viewの管理は含めない。
- 詳細履歴、Lock・公式Pin・移管・Issue削除等は表示と公式への受け渡しまで。
- Symphonyの監視・運転管理は含めない。通常のラベル・属性操作を元サービスへ保存する。

これらは2026-10-22にユーザーが採用した完成形の境界。詳細は操作対応表を正とし、範囲外を将来実装予定として扱わない。

他の利用者への公開を目指す方針は採用済み。公開に必要な導入案内・配布先・接続方法・公開条件を別途具体化する。

Arcoでの通常のIssue管理は外部のSymphony運用にも利用できるが、その設定・対象条件・実行確認をArcoの機能や受入条件に含めない。

## 参照

- [参照チャット: Codex内のGitHub issue連携を探す](thread://01a16338-bb77-7a00-a81c-5b787b138ed0?hostId=local)
- [GitHub: Projectsについて](https://docs.github.com/en/issues/planning-and-tracking-with-projects/learning-about-projects/about-projects)
- [GitHub: ラベルの管理](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels)
- [OpenAI: MCPサーバーへのUI追加](https://developers.openai.com/plugins/build/chatgpt-ui)
- [OpenAI: Plugin Extensions](https://developers.openai.com/plugins/build/extensions)
