# Arco 実装・受入確認

更新日: 2026-10-23。完成範囲は [要件定義](requirements.md) と [操作対応表](issue-operations.md) に従う。実装済み、fixtureでの確認、実サービスでの確認、Codex実画面での確認を分ける。

UIの文言・日付・エラーは英語。元サービスから取得したタイトルや本文は翻訳しない。GitHubとLinearはsource切替で扱い、各source内でrepo／teamを切り替える。元のID・workflow・属性を保持し、共通workflowやサービス間同期は作らない。

2026-10-23のユーザー希望によりPiPは対応範囲から外した。会話内カード（inline）と詳細（fullscreen／会話横）、global/threadの入口は引き続き対象とする。過去のPiP観測は履歴として残し、現在の受入条件には含めない。

## 操作と実装先

| ID  | 提供する操作                                                                                        | 主な実装                                                             |
| --- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| O01 | repo、workspace/team、既存Projectの明示選択                                                         | `App.tsx`、`LinearWorkspace.tsx`、各source adapter                   |
| O02 | 元APIの検索・filter・sort・ページ取得、sourceごとの条件保存                                         | `github.ts`、`linear/service.ts`、`useGitHubSettings.ts`、`state.ts` |
| O03 | Markdown、本文・コメント、native属性、source画像と公式リンク                                        | `MarkdownContent.tsx`、`images.ts`、各Detail                         |
| O04 | sourceへIssue作成、端末内の作成下書き                                                               | 各Workspace、`local-drafts.ts`、source create tool                   |
| O05 | タイトル・Markdown編集、元の記法を保つtask checkbox、競合表示                                       | 各Detail、`content-drafts.ts`、`markdown-tasks.ts`                   |
| O06 | GitHub Open/Closed・終了理由とProjects Statusを別操作、Linear native state                          | `App.tsx`、`GitHubProperties.tsx`、`LinearDetail.tsx`                |
| O07 | sourceが認める担当者の指定・解除                                                                    | 各Detailとsource update tool                                         |
| O08 | 指定したラベルの差分更新、指定外ラベルの保持                                                        | source label tool、Linear label group検証                            |
| O09 | ラベル定義の作成・変更・削除。scope/group変更は公式へ                                               | `LabelManager.tsx`、`LinearDetail.tsx`、各adapter                    |
| O10 | コメントの閲覧・投稿・編集・削除、Linearの返信parent保持                                            | `GitHubDiscussion.tsx`、`LinearDetail.tsx`、各adapter                |
| O11 | Issue／コメントのsourceリアクション追加・取消                                                       | 同上                                                                 |
| O12 | GitHub Issue type、org Issue fieldsの5型、Projects fieldsの5型。Linear priority・estimate・due date | `github-operations.ts`、`GitHubProperties.tsx`、`linear/service.ts`  |
| O13 | 既存Project／milestone／cycleへの所属・変更・解除                                                   | source properties toolと属性UI                                       |
| O14 | 子Issue作成、既存親子の設定・付替え・解除                                                           | source relation toolと属性UI                                         |
| O15 | GitHub blocks/blocked-by、Linear blocks/blocked-by/related                                          | source relation tool、逆方向を保持した表示                           |
| O16 | 既存添付・URL、Linear公式APIによるupload                                                            | `images.ts`、`linear/service.ts`、`LinearDetail.tsx`                 |
| O17 | 単純な既存templateと対応属性の既定値、未対応templateの公式導線                                      | source template tool、作成dialog                                     |
| O18 | 互換な選択への状態・担当・ラベル・対応属性値のbulk、Issue別の結果                                   | `BulkActions.tsx`、`LinearBulkActions.tsx`、各adapter                |
| O19 | 明示的context共有、native Issueのmention resource、現在/新規chatのdraft/send、再取得                | `host.ts`、`mentions.ts`、`index.ts`、各Workspace/Detail             |
| O20 | source URL・識別子のcopy、公式Issue・コメントへ移動                                                 | 各Detail、`GitHubDiscussion.tsx`、`CopyValue`                        |

serverは `src/server/`、UIは `src/ui/`、入力schema/DTOは `src/shared/`。各sourceのIDは入出力で保持する。設定と下書きはrevision付きの端末内JSON、Linear token pairはOS credential store、GitHubは既存公開`gh`接続を使う。tokenをUI・モデル結果・ログへ返さない。

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
- 共有では同じsource contextをtextとstructuredContentへ渡す。選択時は本文全体を含めず選択範囲だけにする。これはtext経路で内容が欠ける問題への対処であり、実Codexの受信が確認できたという意味ではない。Prepare/Sendは現在のチャットの明示共有先を変更せず、Add to chat／Share selectionだけが保持対象を変更する。
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

実Linear YU-48からNew chatへPrepare draftするとhostの成功通知を確認した。実composer上の未送信状態は未観測。その後の明示的SendはComputer Useがtimeoutし、公開chat一覧にも新規chatを確認できていないため、結果不明のまま再送していない。この試行でsourceデータは変更していない。実画面の画像と観測内容は[画面比較](design/ui-audit-2026-10-23.md)と`dist/dev/codex-host-validation.json`に分けて記録する。

PiP削除版を再install後、このチャットでArcoを新しく開いた。実GitHub #1と実Linear YU-49でPiPボタンがない詳細を確認し、画像14／15に記録した。詳細UIの反映は確認済みだが、既存server processのmetadata再読込まで確認したことにはしない。sourceデータの追加書込みは行っていない。

- [ ] Arco本体がglobal/threadの入口から開き、実GitHubと実Linearの一覧・詳細を表示する。
- [x] 再起動後の実Codexで、repo未指定のGitHub個人一覧、明示的な作成一覧への切替、任意のIssue URLから正しい詳細への移動を確認する。
- [ ] inline/fullscreenで表示し、共有中のIssueを保って詳細へ戻る。PiPは対象外。
- [x] 実GitHub #1の本文選択が、本文全体を含めずArco由来model_contextで会話へ届く。
- [x] 実GitHub #1のIssue全体が、本文・ラベル・状態とnative識別子を保持してArco由来model_contextで会話へ届く。
- [x] 実GitHub #1のコメント選択が、commentのoriginとnative commentIdを保持し、Issue本文を含めずArco由来model_contextで会話へ届く。
- [x] 実Linear YU-48のIssue全体が、本文・状態とnative workspace/team/Issue IDを保持してArco由来model_contextで会話へ届く。
- [x] 実Linear YU-48の本文選択が、Issue本文全体を含めずArco由来model_contextで会話に届く。
- [x] 実Linear YU-48のコメント選択が、commentのoriginとnative commentIdを保持し、Issue本文を含めずArco由来model_contextで会話に届く。
- [ ] 両sourceで別Issueを閲覧するだけでは共有対象や送信を変えないことを実Codexで確認する。
- [ ] composerの`@Arco`でGitHubとLinearのnative Issueを検索・選択する。
- [ ] 現在/新しい会話へのPrepare draftが未送信になり、Send requestだけが依頼を開始する。
- [x] Codexのsource toolで専用Issueのタイトルを変更すると、開いている同じ詳細へ再取得結果が反映される。元のタイトルへ復元済み。
- [ ] 修正版の共有対象保持と、compactカードへの更新反映を実Codexで確認する。

一般公開は行っていない。利用許諾・directory提出・他workspaceへの公開認可は、完成したローカル実装と区別する。
