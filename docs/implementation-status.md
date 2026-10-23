# Arco 実装・受入確認

更新日: 2026-10-23。完成範囲は [要件定義](requirements.md) と [操作対応表](issue-operations.md) に従う。実装済み、fixtureでの確認、実サービスでの確認、Codex実画面での確認を分ける。

UIの文言・日付・エラーは英語。元サービスから取得したタイトルや本文は翻訳しない。GitHubとLinearはsource切替で扱い、各source内でrepo／teamを切り替える。元のID・workflow・属性を保持し、共通workflowやサービス間同期は作らない。

2026-10-23のユーザー希望によりPiPは対応範囲から外した。会話内カード（inline）と詳細（fullscreen／会話横）、global/threadの入口は引き続き対象とする。過去のPiP観測は履歴として残し、現在の受入条件には含めない。

同日の初回の簡素化では、Ask Codexを依頼欄とSend requestだけにし、Current chat／New chatの選択とPrepare draftを削除した。これは後述の検証を含めて変更履歴として残す。

初回の簡素化後に型・lint・format、unit/adapter **145件**、全browser **58件**、build・65 tools smoke・artifact検査が成功した。両sourceのbrowser検証では、入力だけでは送られず、Send requestの1回の操作が`target: active`・`send: true`の1件の依頼となり、閲覧中Issueのnative識別子を渡して明示共有対象を変更しないことを確認した。再installした配布HTML/serverとbuildのSHA256も一致した。UIは1,578,932 bytes、SHA256 `c930b085bd3684a86bbd9422e7a71e2b0ad8397d8926419f6cfe7771c057441b`。新しく開いた実ArcoのGitHub #1とLinear YU-48で、依頼欄とSend requestだけの表示を確認した。[GitHub実画面](design/references/2026-10-23-conversation/03-github-simple-request-native.jpg)／[Linear実画面](design/references/2026-10-23-conversation/04-linear-simple-request-native.jpg)。GitHubの入力中の依頼文も保持されていた。この実画面確認では依頼送信や元Issueの変更はしていない。これらは依頼送信機能の削除前の履歴であり、現在の受入確認には含めない。

続く2026-10-23のユーザー希望により、Ask Codex・Send request・依頼欄も削除し、相談はCodexの通常入力欄へ集約した。Issue全体のAdd to chatを残し、Arco全域のテキスト選択に小さなAdd to chatを表示する。Arcoはコンテキストと添付のtitle/groupを渡し、タイトル・グループ付きの添付表示はCodexが担う。Arcoからmessage送信・composerへの下書き準備・新規会話作成・別の会話画面は提供しない。Issue作成・編集・コメントの端末内下書き保存は保持する。

本文または単一コメントの内側の選択はnativeのoriginを保持し、コメントにはcomment IDを添える。タイトル・属性・一覧などはoriginをuiとし、単一Issue領域内の場合だけ最小限のnative識別情報を添える。異なるIssue領域にまたがる範囲は一般のArcoコンテキストとし、任意のIssueを選ばない。選択共有に本文全体を補わず、範囲内の空白も保持する。

全域共有版の最終ソースで型・lint・format、unit/adapter **153件・19ファイル**、全browser **65件**、build・65 tools smoke・artifact検査が成功した。選択メニューの位置計算でChromiumがclosed details内の文字までSelection文字列に含める条件をfixtureで再現し、同じrangeとDOM文字列なら最初の可視テキストを保持するよう修正した。選択範囲または元の文字が変われば再取得する。本文からコメントへまたがる再現確認は修正後に成功した。sourceを切り替えて共有し直した後はhostの最新contextから共有refを復元し、古いLinearの共有表示を戻さない。閲覧Issueと一覧位置は独立して保持する。[選択メニューの検証画面](design/references/2026-10-23-conversation/05-selection-popup-fixture.png)。最終配布UIは1,581,218 bytes、SHA256 `f3ac2049c5d95b458b5a52226c99414a5ecf8723ba6e195ac0c0808016c3eab8`。再install後のHTML/serverとbuildのhash一致を確認した。

このMacで全域共有版を開き、実GitHub #1と実Linear YU-48の両方でAsk Codex・依頼欄がなく、Issue全体のAdd to chatだけのtoolbarを確認した。[GitHub実画面](design/references/2026-10-23-conversation/06-github-share-only-native.jpg)／[Linear実画面](design/references/2026-10-23-conversation/07-linear-share-only-native.jpg)。GitHub #1のタイトルを選択して小さいAdd to chatを押す確認では、ユーザーから「添付が表示され、未送信で残った」と回答を受けた。Codex側の添付表示はユーザーの目視確認であり、agentによるcomposerの直接観測ではない。この時点では、添付の正確なtitle/group表示、新UIからの通常返信に伴うモデル受信、Linearでの選択添付は実機で未確認だった。この実画面確認後にclosed detailsの混入対策とsource切替時の古い共有表示の復元防止を加えたため、最終修正版はArcoを開き直すと読み込まれる。元Issueの書込みは行っていない。

続く同日のユーザー入力に伴い、このチャットへArco由来model_contextが届いた。実GitHub `my-name-is-yu/Arco #1`のコメントの部分選択で、originはcomment、commentIdは`IC_kwDOVTZAxs8AAAABehqhtQ`。選択文は「co MCP検証: コメント投稿と同じrequestIdでの重複呼出しを確認。」から始まり、text内JSONとstructuredContentで一致した。Issue全体のbody fieldは含まれない。新UIのGitHubコメント部分選択についてモデル受信を確認した記録であり、タイトルの受信、Linearの新UI、Codex本体のnative annotation形式を確認したことにはしない。

同日のネイティブ注釈API調査では、実ArcoのMCP bridge接続後も`document.oai`が未提供で、Codex内蔵ブラウザの通常ページでのみ注釈APIの関数を確認した。MCP App内から録画のコメントエディタを開く公開経路は確認できなかったため、選択UIをArcoで実装し、会話への受け渡しに公開bridgeを使う構成を採用した。診断用HTML・比較ページ・JSON・画像はプロジェクトから撤去し、インストール先のHTMLも通常版へ復元済み。既存のinline検証実験と受入履歴は保持する。旧`share(issue, selection)`経路も削除し、Issue全体は`share(issue)`、選択範囲は`shareSelection`へ分けた。この調査・整理時点は、任意コメント・番号付きハイライトの追加前である。

この整理後も型・lint・format、unit/adapter **153件**、共有に関わるbrowser **5件**、build・65 tools smoke・artifact検査が成功した。再installしたHTML/serverとbuildのhash一致も確認した。整理後の配布UIは1,581,139 bytes、SHA256 `632c57e698c5fdca8654f5975ddeb747d04f8b7e7a4694c20555b4cad1b124db`。

続いて、選択注釈UIの初回版をArcoに実装した。Add to chatで直ちに添付を作り、青いハイライト・番号「1」と任意コメント欄を表示した。この版は一件の選択だけを保持していたが、続くユーザー指定により複数の箇所へ別々のコメントを付ける仕様へ改めた。上記の検証数・配布hash・実機観測を、複数注釈版の確認には読み替えない。

現行の採用仕様では、Add to chatするたびに前の注釈を保持して選択を追加し、青いハイライトと番号「1」「2」…を付ける。各番号から再編集し、✓でその項目の`selection.comment`だけを更新する。元の`selection.text`と他の注釈は変えず、空白だけならcommentを付けない。Escapeまたは外側クリックでは編集中の未保存コメントだけを破棄する。閲覧先を変えても注釈を保持し、Codex側の添付削除・別contextへの置換に同期して解除する。注釈集合を公開modelContext一件として渡し、複数時は`source: arco`の`annotations`配列に各選択とnative Issue識別情報を保持する。集合を任意の単一Issueへ対応させず、一件時は従来のsourceとselectionも保持する。通常の会話入力・送信はCodexが担い、複数注釈版の検証・実機結果は初回版と分けて記録する。

2026-10-23 16:06:40のユーザー写真で、実Arcoの4つの番号を確認した。同時にこのチャットへ届いたArco由来model_contextは`source: arco`で、`annotations`に4範囲を保持していた。1はoriginがuiで選択文が`rco valid`、2はbodyで`rcoの動作検証専用です`、3と4はcommentで同じnative comment IDを保持した別の選択だった。この時点では4件すべてのモデル受信を確認したが、いずれも`selection.comment`はなく、任意コメント保存後の実機モデル受信は未確認だった。

続く添付表示の変更では、各選択を番号・短文title付きの個別text content blockへ分け、共通の`N annotations`groupを付けてCodexへ渡す。assistant向けJSONは一件とし、structuredContentにも全注釈を保持する。上の4件受信はこの表示変更前の実績であり、変更後のgroupや項目一覧の実機表示確認とは分ける。

最終の項目分割版で、型・lint・format、unit/adapter **160件・19ファイル**、全browser **69件**、build・65 tools smoke・artifact検査が成功した。Issueを往復した際の範囲復元、同じ入力欄の複数範囲での番号の非重複、各コメントの独立編集・削除、最後の削除、IME中のEnterで自動送信しないことも検証した。配布UIは1,595,944 bytes、SHA256 `bfbb7d5559f50b5293b9ee841074842a7ffdce8627319f2ca33e7af72dc7585d`。再installしたHTML/serverとbuildのhash一致を確認した。

ユーザーの16:14:01の実機写真で、Codex側の`3 annotations · 3`と3項目の一覧・各削除ボタンを確認した。同時にこのチャットへ、選択文`rco valid`／`labels / com`／`dation`にそれぞれコメント`1`／`2`／`3`が付いた3件のmodel_contextが届き、visible textとstructuredContentの対応を確認した。前2件のoriginはui、3件目はbodyで、各項目のnative GitHub Issue識別情報も保持した。これにより、実Arcoの複数選択・個別コメント・件数付き添付とモデル受信を確認した。最終版のLinearについてはbrowser検証と以前の実機実績を区別し、同じ3件の実機受信を確認したとは扱わない。

Codex本体の添付一覧に鉛筆ボタンを追加する公開APIは確認できなかった。Arco内に別の注釈一覧を追加する案は、ユーザーの指定で取りやめた。再編集は既存の青い番号から行え、Codex側では添付の削除・付け直しを使う。[見た目と操作の検証](../design-qa.md)。

コミット前に、重複するbrowser検証の補助処理、不要なstate更新・型指定・assertを整理した。テスト画像はtest outputへ保存し、受入記録の画像を上書きしない。整理後も型・lint・format、unit/adapter **160件**、全browser **69件**、build・65 tools smoke・artifact検査が成功した。配布UIは1,595,927 bytes、SHA256 `2354a1d028f83854cea9f0fa31327b31ce89278afe403d60484bbbd65eafae28`。再install後のHTML/serverとbuildの一致を確認した。実機の見た目・モデル受信の記録は上記の項目分割版に対するもの。

## 操作と実装先

| ID  | 提供する操作                                                                                                                        | 主な実装                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| O01 | repo、workspace/team、既存Projectの明示選択                                                                                         | `App.tsx`、`LinearWorkspace.tsx`、各source adapter                                                                     |
| O02 | 元APIの検索・filter・sort・ページ取得、sourceごとの条件保存                                                                         | `github.ts`、`linear/service.ts`、`useGitHubSettings.ts`、`state.ts`                                                   |
| O03 | Markdown、本文・コメント、native属性、source画像と公式リンク                                                                        | `MarkdownContent.tsx`、`images.ts`、各Detail                                                                           |
| O04 | sourceへIssue作成、端末内の作成下書き                                                                                               | 各Workspace、`local-drafts.ts`、source create tool                                                                     |
| O05 | タイトル・Markdown編集、元の記法を保つtask checkbox、競合表示                                                                       | 各Detail、`content-drafts.ts`、`markdown-tasks.ts`                                                                     |
| O06 | GitHub Open/Closed・終了理由とProjects Statusを別操作、Linear native state                                                          | `App.tsx`、`GitHubProperties.tsx`、`LinearDetail.tsx`                                                                  |
| O07 | sourceが認める担当者の指定・解除                                                                                                    | 各Detailとsource update tool                                                                                           |
| O08 | 指定したラベルの差分更新、指定外ラベルの保持                                                                                        | source label tool、Linear label group検証                                                                              |
| O09 | ラベル定義の作成・変更・削除。scope/group変更は公式へ                                                                               | `LabelManager.tsx`、`LinearDetail.tsx`、各adapter                                                                      |
| O10 | コメントの閲覧・投稿・編集・削除、Linearの返信parent保持                                                                            | `GitHubDiscussion.tsx`、`LinearDetail.tsx`、各adapter                                                                  |
| O11 | Issue／コメントのsourceリアクション追加・取消                                                                                       | 同上                                                                                                                   |
| O12 | GitHub Issue type、org Issue fieldsの5型、Projects fieldsの5型。Linear priority・estimate・due date                                 | `github-operations.ts`、`GitHubProperties.tsx`、`linear/service.ts`                                                    |
| O13 | 既存Project／milestone／cycleへの所属・変更・解除                                                                                   | source properties toolと属性UI                                                                                         |
| O14 | 子Issue作成、既存親子の設定・付替え・解除                                                                                           | source relation toolと属性UI                                                                                           |
| O15 | GitHub blocks/blocked-by、Linear blocks/blocked-by/related                                                                          | source relation tool、逆方向を保持した表示                                                                             |
| O16 | 既存添付・URL、Linear公式APIによるupload                                                                                            | `images.ts`、`linear/service.ts`、`LinearDetail.tsx`                                                                   |
| O17 | 単純な既存templateと対応属性の既定値、未対応templateの公式導線                                                                      | source template tool、作成dialog                                                                                       |
| O18 | 互換な選択への状態・担当・ラベル・対応属性値のbulk、Issue別の結果                                                                   | `BulkActions.tsx`、`LinearBulkActions.tsx`、各adapter                                                                  |
| O19 | Issue全体・Arco全域の選択テキストをAdd to chatで共有、選択保持と任意注釈、添付のtitle/group、native Issueのmention resource、再取得 | `SelectionShare.tsx`、`SelectionAnnotation.tsx`、`context-attachment.ts`、`host.ts`、`mentions.ts`、各Workspace/Detail |
| O20 | source URL・識別子のcopy、公式Issue・コメントへ移動                                                                                 | 各Detail、`GitHubDiscussion.tsx`、`CopyValue`                                                                          |

serverは `src/server/`、UIは `src/ui/`、入力schema/DTOは `src/shared/`。各sourceのIDは入出力で保持する。設定と下書きはrevision付きの端末内JSON、Linear token pairはOS credential store、GitHubは既存公開`gh`接続を使う。tokenをUI・モデル結果・ログへ返さない。

過去に保存した依頼文・送信先は、現在のコンテキスト共有や会話への送信に使用しない。Issue作成・編集・コメントの下書きとは区別する。

F02〜F09・F11は上表のsource操作、F10は `/` で検索、`j/k` で一覧移動、Enterで詳細、Escapeで戻る操作とdialogのfocus制御に対応する。F12はO19の4連携に対応する。F01と全表示のCodex実画面確認は下記の別項目として残す。

## 確認したこと

- strict型チェック、lint、unit/adapter **145テスト・18ファイル**、配布build、公式SDK stdio smoke、HTML/JS/CSS artifact検査、format検査が成功。最終server buildでは検証用Issue・画像データのliteralも配布物から除外し、artifact検査で再混入を拒否する。
- PiP削除後のbrowserはGitHub **21件**、アカウント初期表示 **5件**、URL直接オープン **3件**、Linear **15件**の計**44件が一括実行で成功**。初期一覧、PR-onlyページの継続、共有refのview再作成、全4通りのcurrent/new draft/sendで明示共有対象を保持する操作、本文／コメント選択のtextとstructured context一致、操作メニューのkeyboard/focus/copy fallback、静かなリアクション選択を含む。hostがfullscreen切替を拒否する場合の表示と再試行も両sourceで成功。その後Linearの拡大ボタンをOpen detailsと同じ復帰処理へ揃え、狭い幅で別Issue閲覧後に共有対象を開く追加のassertionが成功した。既存のpage error・CSP回帰も成功。
- 続く選択範囲の修正後、142件のunit/adapter・build・smoke・artifact検査と、影響する**9件のbrowserテスト**が成功した。GitHubではコメント本文の外側でmouseを離すと旧本文選択が残る3ケースを修正前に再現し、両sourceの置換・解除・本文とコメントをまたぐ範囲の拒否を確認した。その時点のUIは1,455,905 bytes、SHA256 `b068f0d84c8f245ee876119e40c078bd10cece2365088e1d443046e769daf907`。前記44件の一括実行と、修正後9件の確認は分けて記録する。
- ユーザー希望により、GitHubのClosed／Last updated／Descending等とLinearの同じ役割の要約行を削除した。state・検索・Filters内の実操作と保存は保持し、不要になった生成処理とCSSも削除した。型チェック・対象lint/format・build・artifact検査と、既存のscope/state/search/Linear filter確認のbrowser **3件**が成功。その時点のUIは1,454,899 bytes、SHA256 `b95a92389cfb60b0aa087de40d77091a0c13aec7d05f28657d9fe9237b2819da`。続くSDK複数選択版を新しく開いた実Codexでも、両sourceで要約行がないことを確認した。
- 複数の値を持つGitHub担当者・GitHub/Linearラベル・GitHub複数選択fieldを、導入済み `@openai/apps-sdk-ui` 0.2.2の `Select multiple` に統一した。pillのトリガーとチェック付きpopupを使い、メニューを開いたまま複数項目を変更できる。単一選択やIssue行のbulk選択は変更しない。sourceのID・差分更新・fieldの明示Saveを保持し、候補から消えた既存値を暗黙に除去しない。Escapeでのfocus復帰と、閉じたトリガー上での一覧shortcut抑制も確認した。その時点のUIは1,579,754 bytes、SHA256 `7cfd5ede914fd5ce107d0f4d152c87895ad12a16db635a85b1e904a27fef9a33`。installed cacheとのHTML/server一致を確認した。実CodexのGitHub #1とLinear YU-48でメニューを開いて表示を確認し、この確認ではsourceを書き換えていない。[GitHub実画面](design/references/arco-multi-select-github-native.png)／[Linear実画面](design/references/arco-multi-select-linear-native.png)。選択後の書込み・失敗と再試行・未知の既存値保持・keyboard/focusの検証はfixtureで行う。 修正後の全browser **50件**とCSP/page error検査、142件のunit/adapter、型・lint・format・build・65 tools smoke・artifact検査が成功した。
- 続く指定により、Source切替・Scope・Team・全filter/sort・詳細属性・関係種別・ラベル定義・Template・bulk・会話送信先の残り43箇所を、共通 `SingleSelect` の丸いトリガーとチェック付きpopupへ統一した。ネイティブのselectは残っていない。単一／複数の選択数、元のID、差分更新、明示Saveを保持する。SDK内部だけ安全な非空IDへ変換し、空の解除値や引用符・バックスラッシュを含むラベルも元の値で返す。候補グループ／検索／disabled、同値再選択のno-op、作成dialog内popupの重なり・Escape・focusを確認した。修正後の全browser **53件**とCSP/page error、142件のunit/adapter、型・lint・format・build・65 tools smoke・artifact検査が成功。その時点のUIは1,577,653 bytes、SHA256 `c9e1b1da67a431b74e0fa63beb23b47fb5f44d1d586b095a0ca361e63baacc33`。installed cacheとのHTML/server hash一致も確認した。新しく展開した実Codexのtab 4は旧Source／Scopeのままで、ユーザーも旧表示を確認したため、今回のnative反映は未確認とする。Codex再起動後の確認を残す。Open／Closed／Allのボタン列は今回のプルダウン変更に含めない。[GitHub fixture](design/references/arco-all-dropdowns-github-fixture.png)／[Linear fixture](design/references/arco-all-dropdowns-linear-fixture.png)。
- ユーザーの13:04の実画面で、Source／Scope／Issue stateの新しいpillと、全領域の `App server request queue is full` を確認した。fixtureでは26回のサイズ・テーマ通知だけでtool呼出しが11件から205件へ増えることを修正前に再現した。表示通知とデータ通知を分け、表示だけでは再取得せず、データ通知は100msでまとめて対象sourceだけを更新する。通知で再取得中のRPCを論理cancelして積み重ねる処理を避け、tool/imageの実通信を同時2件へ制限した。書込みは自動再送しない。両sourceで更新失敗時も読み込み済みの本文と未送信コメントを保持し、巨大な初回エラー画面を重ねず、明示的Retry refreshで回復する。全browser **57件**とCSP/page error、unit/adapter **145件**、型・lint・format・build・65 tools smoke・artifact検査が成功。修正後の制限付きhostでは表示通知の追加RPCが0、同時数は2以下、拒否は0で、外部更新後のIssue読取りは1件増えて反映された。現在のUIは1,579,474 bytes、SHA256 `e732842935a619e511df5ed7d611e1f5f2e137718cd635a3d04638b23c70c56d`。installed HTML/serverとのhash一致を確認した。元サービスの追加書込みはなく、修正版の実host反映はCodex再起動後の確認として残す。実hostがどの通知を何回送ったかまで観測したわけではない。[詳細記録](design/ui-audit-2026-10-23.md#request-queue-overflow)。
- 残る操作を再照合し、O20のコメントnative IDコピーを両sourceへ追加した。O17の未対応Linearテンプレートは、元のteam/template ID付きの[公式作成URL](https://linear.app/docs/creating-issues#create-a-new-issue-url)へ渡す。既存のclipboard/fallbackとhost.openLinkを使い、Issue作成・共有・送信は実行しない。Linearの共有表示もnative refと既存のshared queryを使い、Chat YU-48と閲覧対象との差を示す。最終ソースのunit/adapter **145件・18ファイル**、全browser **58件**、型・lint・format・build・65 tools smoke・artifact検査が成功した。配布UIは1,580,052 bytes、SHA256 `53534e9396ff46b0f02eb1724b758b3fa3319b6e7ba0359b92d21b806680ab95`。再install後のHTML/serverとのhash一致を確認した。追加の元サービス書込みはなく、この追加UIの実Codex反映は次の再起動後に確認する。Linear全体のモデル受信は下記の実機項目で別に確認済み。
- GitHubはこのrepoの専用Issue #1/#2で実書込みと後片付けを確認。[実接続記録](github-live-validation.md)。通常Issue、label定義、comment、reaction、親子、依存関係、bulk部分失敗を含む。
- Linearの実OAuth認可、OS保存、provider refreshと、その後の接続、専用YU-48/YU-49でのnative操作・画像upload/認証付き読取・現行API検索・bulk部分失敗が成功。一時labelを削除し、専用IssueはDone、cleanup errorなし。[Linear記録](linear-validation.md) を参照。
- Codex CLIの公開plugin導入で `arco@arco-local` をローカルinstall。最終stdio smokeは65 toolsを確認した。公開app-serverの一時sessionからの起動は `node scripts/validate-plugin-host.mjs` で別に確認し、モデルturnは開始しない。
- GitHubの初期一覧はAssigned to me。Created by me・Mentioned me・All account repositoriesを明示的に切り替え、repo候補はAPIから取得する。repo入力は初期表示の条件にしない。本人接続で各scopeと候補取得を実確認した。取得範囲・native検索の制約・ページ取得・保存の詳細は[アカウント取得仕様](github-account-discovery.md)。
- U03のIssue URL直接オープンを両sourceで実装した。GitHubはaccount scopeの検索欄や任意のrepo入力、Linearは検索欄から開く。正規のHTTPS origin・Issue経路・native IDを検証し、別repo/teamの対象へ移る。PR・別origin・workspace不一致は開かず、失敗時は入力を保持する。実GitHub #1と実Linear YU-48のnative ID一致を読取だけで確認した。記録は`dist/dev/issue-url-live.json`。この記録はdesktopのURL操作確認を意味しない。
- 共有では表示用のtextに添付のtitle/groupを付け、source contextをassistant向けJSONとstructuredContentへ渡す。選択時は本文全体を含めず選択範囲だけにする。これはtext経路で内容が欠ける問題への対処であり、変更後の全域共有が実Codexで受信できたという意味ではない。閲覧・選択だけでは共有対象を変更せず、Add to chatの明示操作で共有する。
- Code Reviewの実配布ソースを再確認し、主要操作を一つのtoolbar、utilityをメニュー、属性と追加編集を右側へ整理した。実際の詳細container幅で右列／一列を切り替え、source切替とscope/filterを両sourceで揃えた。[画面比較](design/ui-audit-2026-10-23.md)はfixture画面であり、実Codexのスクリーンショットではない。
- resource metadataはglobal/thread入口、inline/fullscreenを宣言。stdio smokeで採用した2モードとの完全一致を検査する。PiPのボタン・専用描画・スタイル・fixture操作は削除した。
- browser mockは配布HTMLをiframeへ読み、公開AppBridgeとfixture専用stdio MCPを使う。CSPは`unsafe-eval`とネットワーク接続を許可しない。画像は認証をUIへ渡さず、app-only結果の`_meta`からdata画像として表示する。
- UIはhost通知、focus/manual refreshに加え、表示中のIssueを30秒ごとに元APIから再取得する。実hostが別toolのresource通知を中継することは未証明のため、通知だけに依存しない。常時mirrorや独自のジョブ実行基盤はない。UIからのtool/image RPCだけを同時2件に制限し、書込みを自動再送しない。

PiP削除後の配布候補を `codex plugin add arco@arco-local --json` で更新し、installed cacheとbuildのserver/HTMLのSHA256一致を確認した。serverのSHA256は`4eea59880e4039ecd1594bd05542159acab85de35eb8f32f41903502d89bb6aa`。そのinstalled pluginを新しい公開app-serverから起動し、65 tools、arco_open、linear_connection、両sourceの接続済みを再確認した。公開app-server検証と、既に起動中のdesktop serverの更新は区別する。

起動用tool `arco_open` の表示名をOpen ArcoからArcoへ統一し、配布serverを再build・installした。新しいstdio接続でtitleとglobal/threadのmetadataを確認した。起動中desktopの既存タイトルが変更済みとは扱わず、hostの次回plugin再読込で反映する。続く実画面でも旧Open Arcoが残ったため公開の再読込経路を確認したが、default control socketは存在せず、Arco限定のreload手段も確認できなかった。他のMCPを含む一括reloadは実行していない。[公式の更新手順](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)に従うアプリ再起動後、新しく開いた入口名の確認を残した。その後ユーザーが再起動し、nativeのarco_openから開いたタブをComputer Useの実inventoryで確認した。2件ともArco MCP Arcoとなり、Open Arcoは残っていなかった。installed HTML/serverとbuildのhash一致も再確認した。表示名のnative反映は確認済み。その後のGitHubコメント範囲の受信確認は、下記のCodex実画面の記録に分ける。

mock画面の記録: [GitHub wide](design/references/arco-github-mock-wide.png) / [narrow](design/references/arco-github-mock-narrow.png)、[Linear wide](design/references/arco-linear-mock-wide.png) / [narrow](design/references/arco-linear-mock-narrow.png)。Codex実画面の証拠ではない。

GitHubの追加`project` scopeは、最初の本人確認待ちで期限切れになった後、2026-10-23朝にユーザーが操作可能となったため再開した。Safariの完了表示とCLI exit 0を確認し、keyring上の本人接続で`project` scopeが有効となった。個人Projectは0件で、既存候補は他組織の閉じたProjectだけだった。ユーザーは本人の非公開検証Projectを新規作成する方法を明示承認したため、`my-name-is-yu`の[Arco validation](https://github.com/users/my-name-is-yu/projects/1)を作成し、内容追加前に非公開を再取得して確認した。5種類の検証用fieldと専用Issue #1で実書込み・再取得・clear・復元が成功した。ユーザーは実CodexのArcoでDoneからIn Progressへ変更し、IssueはClosedのままと確認した。native toolからも同じ値と状態を確認した後、元のStatusとIssueタイトルを復元し、専用itemを取り外してProjectを非公開のまま閉じた。Issueの内容fingerprintは元と一致した。

- その後ユーザーがCodexを再起動し、今回は問題なしとの報告を受けた。実hostの通知列・通信数の計測とは区別する。サイズとテーマの変更だけで再取得・設定保存・共有や送信・下書き初期化を起動しないことを、GitHubの5種類とLinearの6種類の実viewportで追加確認した。全tool呼出しの増分0、Issueと未送信コメントの保持、会話への共有・送信0を確認し、制限付きhostの既存確認を含む対象browser **3件**、型・対象lint/formatが成功した。変更はテストと記録だけで、配布UIの再installは不要。

## source側の条件と表示上限

- org Issue fields、Issue type、Projects fields、Linear estimate/cycle等は、選んだsourceに既存定義と本人権限がある場合だけ操作する。本人の明示承認なしに、検証用のProject・field・cycle等の定義は作らない。fixtureの全型往復を、本人sourceに存在しない型の実書込み成功とは扱わない。
- Linear uploadは公式 `fileUpload` → signed PUT → 元Issue本文へのURL保存。現在のtool転送は10 MiBまでで、Linearの公式最大値を意味しない。
- 画像previewは元本文・指定コメントの実際のMarkdown画像targetに限定し、sourceの既知HTTPS originから取得する。5 MiB以下のPNG/JPEG/GIF/WebP/AVIFだけを扱う。未対応origin/形式、browser認証が必要なGitHub添付、埋込みHTMLは元リンクと公式導線を保つ。SVGや任意HTMLを実行しない。
- Linear OAuth登録は本人Yu workspace内のprivate app。他workspace向け公開登録・公開資格は別の配布作業である。
- 今回の実行環境はmacOS arm64。OS pathは分岐し、製品launcherはshell不要の`node`だが、Windows/Linux上のnative credential保存とCodex画面は未確認。`dist/plugin/runtime-platform.json`にbuildしたOS/archを記録する。[OS別の受入表](platform-validation.md)に未完了の条件を保持する。

## Codex実画面の受入確認

この項目はmock browser／app-serverの成功で代替しない。Computer Useはnativeの`com.openai.codex`への操作を拒否する。一方、2026-10-23には展開されたArcoを`mcpapps`の公開DOM経路で操作できた。会話内カードやcomposerなど、この経路で見えない部分はユーザーの画面操作で確認する。

以下の観測は各変更時点の履歴である。旧UIのIssue全体・本文／コメント共有の受信実績は保持するが、全域の選択共有とCodex側の添付表示の確認に読み替えない。message送信・Prepare draft・新規会話の試行は削除前の履歴であり、現在の受入対象ではない。

2026-10-23朝、このチャットで公開されたArco本体から、英語UIと専用GitHub #1の本文表示をユーザーが確認した。native toolで付けた一時的なタイトル末尾は、開き直さず同じ詳細へ反映された。Project StatusのUI更新とClosed維持も確認し、後片付けを完了した。これは旧inline probeの結果ではない。このチャットのnative Arco toolから実Linear YU-48も読めた。

初回のShare selectionでは、ユーザーの操作報告だけでモデル受信は観測できていなかった。その後2026-10-23 11:59 JST、このチャットのArco由来model_contextで、実GitHub #1の本文選択「Markdown body edit and refetch」を受信した。textとstructuredContentのselectionが一致し、originはbody、本文全体のbody fieldは含まれなかった。ユーザーの返信自体は「共有した」だけで、選択文を転記したものではない。この時点ではGitHubコメントとLinearの選択範囲は未確認だった。

続く「コメント共有した」の返信では、受信contextも実画面の選択previewも前回のBody selectionのままだった。コメント範囲の成功とは扱わない。その後「これでどう？」の返信で、GitHub #1の本文全体・ラベル・状態・native識別子がArco由来model_contextで届いた。selection fieldはなく、Issue全体の共有として別に確認した。

ローカル再現では、mouseを離した要素が本文／コメントのwrapper外にあると選択の再取得を省略し、前の本文範囲が残った。両sourceでcontent内のmouseupごとに実際のrangeを検証するよう修正し、無効な範囲では旧選択を解除する。toolbarはcontentの外に保ち、共有クリックで選択を消さない。選択解除だけを行うボタンはClear selectionへ改名した。修正版を再installし、installed HTML/serverのhash一致を確認した。これはユーザーの直前の操作が同じ原因だったと断定するものではない。

再起動後、検証を再開してGitHub #1の投稿済みコメントを選択・共有した。このチャットへ届いたArco由来model_contextのselectionはoriginがcomment、commentIdは`IC_kwDOVTZAxs8AAAABehqhtQ`、textは「Arco MCP検証: コメント投稿と同じrequestIdでの重複呼出しを確認。」から始まる実コメントだった。textとstructuredContentが一致し、Issue本文のbody fieldはない。ユーザーのチャット本文へ選択文を転記せず、コメント範囲のnative受信まで確認した。Linearの共有は別途未確認として残す。

続く実Linearの検証で、YU-48をAdd to chatし、通常の会話入力欄から「Linear全体確認」と返信した際にArco由来model_contextを受信した。sourceはlinear、workspaceは`e270ac02-27ef-402d-a2c0-3bdbae7a7804`、teamは`ef341dbf-e0ca-4b25-a214-8e2b1fde60f8`、Issueは`0e29b2d4-5fca-435d-b695-088b61256ac0`。textとstructuredContentに同じYU-48・Done・本文・native属性があり、selectionはない。元の本文・添付URLを保持したIssue全体の共有として確認した。質問の回答欄への先行返信と、成功通知だけの状態は受信成功に含めない。本文／コメント範囲、mention、依頼の下書き／送信は別途残る。

その後「選択」の通常返信と同時に、同じYU-48の本文範囲をArco由来model_contextで受信した。textとstructuredContentのselectionは`Temporary dedicated test issue.`、originはbodyで一致し、Issue全体のbody fieldもcommentIdも含まれない。ユーザーの返信に選択文を転記したものではない。本文範囲の受信は完了とし、コメント範囲の確認を別に残す。

続く通常返信「コメント共有」では、同じYU-48のコメント範囲をArco由来model_contextで受信した。textとstructuredContentのselectionは`Arco validation edited comment`、originはcomment、commentIdは`f0a36c2d-baaf-4bb8-92ff-b5a719539558`で一致し、Issue本文のbody fieldは含まれない。ユーザーは選択文を返信に転記していない。これでLinearもIssue全体・本文範囲・コメント範囲の3種類を実際のモデル受信まで確認した。

続けて実ArcoでBody selectionと31文字のpreview、Chat YU-48、Copy comment IDが表示され、追加UIの反映を確認した。YU-49を閲覧してもChat YU-48とShared issue: YU-48が保持され、閲覧対象が異なる旨が表示された。その後、コメント選択の確認用にYU-48へ戻した。この操作では共有・依頼送信・source書込みを実行していない。これは詳細画面内の対象保持の確認であり、inlineからの復帰や実composerの未送信状態の確認とは区別する。

以前、共有#1から別の#2を閲覧した後にOpen detailsすると#2のままになる症状を確認した。ソースにはview再作成時の共有ref復元漏れがあり、hostのscoped model-contextからArco自身のversion markerとschemaを検証したnative refだけを復元するよう修正した。GitHubとLinearのview再作成回帰は成功。実hostがこの原因で再作成したという断定はせず、inlineカードから戻る実Codex確認を残す。旧markerなしcontextは採用しないため、更新後に一度明示的に共有し直す。

展開した実Arcoでは、新しいScopeとtoolbar、GitHub #1/#2、実Linear Yu teamの一覧、YU-48の本文・チェック項目・コメント・認証付き画像をComputer Useで確認した。GitHub #1をAdd to chatし、#2へ移っても共有表示は#1のままだった。採用取り消し前のPiP要求では元panelにDisplay mode changedが出たが、別領域と復帰先は観測していない。現在は要求したmodeとhostが返したmodeが異なる場合、実際のmodeを保持し、成功通知ではなく英語のエラーを表示する。

更新直後のAssigned to meは`MCP error -32602: Tool arco_account_issues not found`となった。配布HTMLだけが新しく、起動中desktop serverは旧版だった。その後ユーザーがCodexを再起動し、新しいnative toolsが公開された。実画面でAssigned to meの0件表示と自動拡大なし、Created by meの23件＋次ページ、repo候補の自動取得を確認した。account scopeから任意のRepository or URL欄へGitHub #1のIssue URLを入れ、Closedの本文を正しいnative repo・番号で開けた。実Linear YU-48のURL解決も同じnative IDと一致した。追加のsource認可やsourceデータの書込みはしていない。

実Linear YU-48からNew chatへPrepare draftするとhostの成功通知を確認した。実composer上の未送信状態は未観測。その後の明示的SendはComputer Useがtimeoutし、公開chat一覧にも新規chatを確認できていないため、結果不明のまま再送していない。この試行でsourceデータは変更していない。実画面の画像と観測内容は[画面比較](design/ui-audit-2026-10-23.md)と`dist/dev/codex-host-validation.json`に分けて記録する。この新規会話・下書き準備の試行は、機能削除前の履歴であり現在の受入対象ではない。

PiP削除版を再install後、このチャットでArcoを新しく開いた。実GitHub #1と実Linear YU-49でPiPボタンがない詳細を確認し、画像14／15に記録した。詳細UIの反映は確認済みだが、既存server processのmetadata再読込まで確認したことにはしない。sourceデータの追加書込みは行っていない。

2026-10-23午後、このMacの実ArcoでGitHub #1をAdd to chatしてから#2を閲覧し、Chat #1とShared issue: my-name-is-yu/Arco #1が保持されることを確認した。LinearもYU-48を共有後にYU-49を閲覧し、Chat YU-48とShared issue: YU-48が保持された。[GitHub実画面](design/references/2026-10-23-conversation/01-github-shared-1-browsing-2.jpg)／[Linear実画面](design/references/2026-10-23-conversation/02-linear-shared-48-browsing-49.jpg)。これは詳細画面内の共有対象保持の確認であり、inlineカードへの復帰やcomposerの未送信状態までは観測していない。GitHubのOpen fullscreenはhostの成功通知まで確認した。

同日14:19 JST、このチャットへArcoのmessage経路で「issueは開いた。どうすればいい？」とGitHub `my-name-is-yu/Arco #1`のsource contextが届いた。repo・number・native Issue ID・タイトル・closed状態・Markdown本文・ラベルが含まれ、現在の会話への依頼送信を実際のモデル受信まで確認した。同時に届いたmodel_contextはLinear YU-48の全体共有のままで、依頼のIssueと明示共有の対象は別々に保持されていた。この受信をcomposerの@Arco選択、Prepare draft、新規会話への送信の証拠には含めない。依頼送信機能の削除後は履歴としてのみ扱う。

続くGitHub #1のCurrent chat → Prepare draftでは、依頼欄へ「Arco下書き確認：まだ送信しない」を入力して操作し、ユーザーから「入力欄に入り、未送信で残った」と確認回答を受けた。実composerの未送信状態はユーザーの目視確認であり、agentによるcomposerの直接観測ではない。この確認はGitHubの現在の会話への下書きに限定する。その後Prepare draftを削除したため、この確認は履歴として残し、New chatとLinearの下書き確認も現在の受入対象から外す。

今回のLinear New chat送信用には固有marker `ARCO-01A16726-LINEAR-NEW-SEND-01`を依頼欄に用意したが、クリック前に画面がGitHub #1へ切り替わり、送信ボタンが見つからず操作は実行されなかった。この試行を送信成功やproviderの不具合とは扱わない。新規会話送信の削除前の履歴として残す。Codex本体のcomposer・host chromeはComputer Useの安全制約でアクセスが拒否されるため、そこが必要な受入はユーザーの画面操作とモデル受信を組み合わせて進める。実Issueの変更はしていない。

以下の共有・更新項目は旧UIで得た実績と、新しい全域共有版での確認を区別する。最終の項目分割版の実機確認はGitHubとLinearを分けて記録する。

- [ ] Arco本体がglobal/threadの入口から開き、実GitHubと実Linearの一覧・詳細を表示する。
- [x] 再起動後の実Codexで、repo未指定のGitHub個人一覧、明示的な作成一覧への切替、任意のIssue URLから正しい詳細への移動を確認する。
- [ ] inline/fullscreenで表示し、共有中のIssueを保って詳細へ戻る。PiPは対象外。
- [x] 実GitHub #1の本文選択が、本文全体を含めずArco由来model_contextで会話へ届く。
- [x] 実GitHub #1のIssue全体が、本文・ラベル・状態とnative識別子を保持してArco由来model_contextで会話へ届く。
- [x] 実GitHub #1のコメント選択が、commentのoriginとnative commentIdを保持し、Issue本文を含めずArco由来model_contextで会話へ届く。
- [x] 実Linear YU-48のIssue全体が、本文・状態とnative workspace/team/Issue IDを保持してArco由来model_contextで会話へ届く。
- [x] 実Linear YU-48の本文選択が、Issue本文全体を含めずArco由来model_contextで会話に届く。
- [x] 実Linear YU-48のコメント選択が、commentのoriginとnative commentIdを保持し、Issue本文を含めずArco由来model_contextで会話に届く。
- [ ] 両sourceで別Issueを閲覧・テキストを選択するだけでは共有対象を変えず、messageも送信しないことを実Codexで確認する。
- [ ] composerの`@Arco`でGitHubとLinearのnative Issueを検索・選択する。
- [ ] 全域の選択UIから本文・コメントをAdd to chatし、選択範囲とnativeのorigin・comment IDが実際のモデル受信まで保たれる。
- [x] 全域共有版の実GitHub #1コメントの部分選択が、comment origin・native comment IDを保持し、Issue本文を含めずこのチャットのモデルまで届く。
- [ ] タイトル・属性・一覧などの選択に小さなAdd to chatが現れ、originがuiで、単一Issueに安全に対応する場合だけ最小限のnative識別情報が届く。
- [x] 全域共有版のGitHub #1タイトル選択から小さいAdd to chatを押すと、Codex側に添付が未送信で残ることをユーザーが目視確認した。この時点では、正確なtitle/group表示・モデル受信・Linearの選択添付は未確認だった。
- [ ] 異なるIssue領域にまたがる選択が一般のArcoコンテキストとなり、任意のIssueへ対応しない。
- [x] 最終の項目分割版の実GitHubで、Codex側の`3 annotations · 3`と3項目の一覧をユーザー写真で確認し、各選択文とコメント`1`／`2`／`3`がvisible text・structuredContentで一致してモデルへ届く。
- [ ] 最終の項目分割版のLinearで、複数選択と各コメント、Codex側の件数付きグループ表示・モデル受信を実機で確認する。
- [x] Codexのsource toolで専用Issueのタイトルを変更すると、開いている同じ詳細へ再取得結果が反映される。元のタイトルへ復元済み。
- [ ] 修正版の共有対象保持と、compactカードへの更新反映を実Codexで確認する。

一般公開は行っていない。利用許諾・directory提出・他workspaceへの公開認可は、完成したローカル実装と区別する。
