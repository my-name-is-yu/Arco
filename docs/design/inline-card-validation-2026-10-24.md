# 会話内カードの更新確認

確認日: 2026-10-24 JST

ユーザーが選択した「属性を上に」の配置を、GitHubとLinearの既存inlineカードへ実装した。元サービスへの書き込みは行わず、操作確認にはローカルfixtureを使った。

## 表示と操作

- 上段はIssue識別子とOpen details。タイトルの直下に状態・担当者・ラベルを置く。
- 本文は既存の安全なMarkdown描画を使用。プレビューは最大3ブロック、約600文字を目安に、コードフェンスやリストの途中でMarkdownの文字列を切らない。末尾の見出しだけを残さず、参照リンクの定義を保持する。
- 長い単一ブロックはスクロールを持たない領域で省略し、Expand descriptionで全文を表示する。省略部分へキーボードでフォーカスした場合も展開し、ページをスクロールしてフォーカスを表示する。
- 複数選択の表示は先頭の値と残件数にまとめる。メニュー内では全選択を確認・変更できる。
- カードに保持するIssueと閲覧中のIssueが異なる場合、候補のrepo／teamと書き込み先のnative refはカードのIssueに合わせる。既存のrequest ID、更新時刻による競合検知、保存後のcache更新・再取得を維持する。

## 確認結果

| 確認               | 結果                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------- |
| 型・lint・format   | PASS                                                                                                                  |
| unit / adapter     | 32 files、365 tests PASS                                                                                              |
| 新規inline browser | 5 tests PASS。両sourceのMarkdown・リンク・展開・375px幅、共有対象への担当者／ラベル保存、長文中のキーボードフォーカス |
| 既存の関連browser  | GitHub / Linearの共有対象保持、詳細復帰、fullscreen拒否と再試行、両sourceのhover確認がPASS                            |
| build              | PASS。既存の`::highlight`に関するCSS optimizer警告は残る                                                              |
| stdio smoke        | 71 tools、resource、fixture保存とdedup PASS                                                                           |
| artifact           | self-contained HTML、1,650,542 bytes。development fixture混入なし                                                     |
| 手動の描画確認     | 内蔵ブラウザ、1280×720 CSS px、dark、同一の日本語タイトル／本文で選択案と実装を比較。ブラウザerrorログ0件             |

新規テストの初回には、テスト用の別scope変換が画像のレスポンスをIssueとして扱う不備があった。変換対象をIssue／一覧／metadataへ限定して修正した。長文のフォーカス確認では、展開後にリンクが画面外へ残る不備を検出し、展開後のscrollIntoViewを追加して再確認した。最終の新規5件とhover2件は7件すべて成功した。

[選択案](references/2026-10-24-inline/selected-reference.png)と[実装](references/2026-10-24-inline/implemented-collapsed.png)を同じ比較入力で開いて確認した。詳細な比較と意図した差は[design-qa.md](../../design-qa.md)に記録する。

## ローカルpluginへの反映

`codex plugin add arco@arco-local --json`で既存の導入済みArcoを更新した。以下は`dist/plugin`と導入先`/Users/yuyoshimuta/.codex/plugins/cache/arco-local/arco/0.1.0`で一致した。

| 配布物     | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| arco.html  | `587771518525d07f5a610b98d1df308969ec8e20c12a317c36346e64bfc497da` |
| server.mjs | `976fe639641b270d56c80268f23f3f15737f7fc11b841b549e096652553131e9` |

ユーザーの再起動報告後、nativeの`arco_open_project`で実Arcoを開き、GitHub `my-name-is-yu/Arco#2`の取得・詳細表示を確認した。実パネルのDOM内に新規の`.inline-issue-card`と`.inline-description-preview`のスタイルがあり、更新したUIの読み込みを確認した。[再起動後の実画面](references/2026-10-24-inline/native-after-restart-details.png)を保存した。確認中に元サービスへの書き込みは行っていない。

この起動はthread entrypointによる横パネル表示である。操作APIは横パネルだけを公開するため、会話本文内の表示はユーザーに確認した。再起動後、タイトル直下に担当者・ラベルが並ぶ新しい会話内カードが見えると回答を受けた。これはユーザーによる実表示の確認であり、操作APIからカード本体を観測した結果ではない。

実Codex内での本文の展開・折りたたみ、担当者・ラベルの実サービスへのカード内保存は未確認。これらはfixtureの成功とは分けて扱う。commit／pushは行っていない。

## 合意した操作範囲の追加

上記の初回表示確認後、ユーザーが承認した境界に沿って次を追加した。

- GitHubのOpen／Closed · Completed／Closed · Not plannedとreopen。未知／未設定のclosed理由は元の表示を保持し、暗黙にCompletedへ変換しない。Projects Statusは独立したまま。
- Linearの対象team固有workflowとnative優先度0–4。duplicateはLinearでの管理へ案内する。優先度3のラベルは詳細画面もMediumに揃えた。
- 担当者候補内の自分を先頭に配置し、(you)を付記。候補にない自分を新しく追加しない。
- Markdownチェック項目。プレビューと展開の両方から、保持Issueの元本文の対象行だけを変更する。更新時刻による競合検知を使い、タイトル・本文の下書き、下書き読取エラーや競合がある場合は詳細表示での解決へ案内する。
- 「…」のCopy link／Copy issue ID／Open on GitHub・Open in Linear。コピー成功後は閉じてfocusを戻し、clipboard失敗時は既存の手動コピー欄を保持する。
- closeや担当変更で一覧の条件から外れても、対象カードを保持する。

自由なタイトル・本文編集、コメント・返信・履歴、関係、Project／cycle／milestone、期限・見積もり・custom field、一覧・一括操作は詳細表示に置く。実装範囲は[画面構成](../screen-structure.md#inlineカード)へ記録した。

追加版の型・lint・format、unit／adapter 365件・32 files、build、71 tools smoke、artifact検査が成功した。HTMLは1,653,495 bytesで、fixture混入はない。既存のCSS optimizerの`::highlight`警告は継続する。

拡張したinline browser 11件が成功。GitHubのclose理由／reopenとProjects不変、Linear workflow／priority、両sourceのプレビュー／展開中のチェック保存とCRLF／参照定義の行整合性、実fixtureのstale更新競合と再試行、コピー／元サービスURL、dirty draftによるチェック保存阻止と下書き保持を確認した。

全browserは149件中148件が一括実行で成功した。残る1件は旧カードの`.issue-kicker`を参照するlaunchテストで、同じIssue識別子の検証先を`.inline-card-top`へ更新し、個別再実行で成功した。これにより149ケースを確認済みとする。全体の一括成功と、この148件＋修正後1件の結果は区別する。最終のlint／formatも成功した。

独立したfixture sessionを内蔵ブラウザで操作し、GitHubのclose後のカード保持・チェック保存・コピー、Linear Done／Urgent／チェック保存を確認した。375px幅では両sourceのscrollWidthが375px、GitHubの補助メニューもviewport内に収まった。表示設定を元へ戻した。ブラウザerrorログ0件。画像は[GitHub](references/2026-10-24-inline/operations-github.png)、[Linear](references/2026-10-24-inline/operations-linear.png)、[狭幅GitHub](references/2026-10-24-inline/operations-github-narrow.png)、[狭幅Linear](references/2026-10-24-inline/operations-linear-narrow.png)を保存した。操作確認はfixture限定で、元サービスのIssueは変更していない。

追加版を既存ローカルpluginへ再installし、次のhashがbuild／installedで一致した。

| 配布物     | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| arco.html  | `9ed130841f436e9b2f115126db58c4e9f0e4579816b426fc6f2602a9915a0e93` |
| server.mjs | `976fe639641b270d56c80268f23f3f15737f7fc11b841b549e096652553131e9` |

追加版の再起動報告後、nativeの`arco_open_project`で実Arcoを開いた。現在の実パネルのstyle要素に、追加版固有の`.inline-card-actions`と`.inline-card-utilities .detail-utility-menu`、既存の`.inline-description-preview`を確認した。GitHub `my-name-is-yu/Arco#2`の詳細取得も成功し、[再起動後の実パネル](references/2026-10-24-inline/native-operations-after-restart.png)を保存した。導入済みHTML／serverとbuildのhash一致も再確認した。この確認で元サービスへの書き込みは行っていない。

これは追加版のコード読み込みと横パネル内の詳細表示の確認である。続いてユーザーがStateプルダウンと「…」の両方が見えると回答し、会話内カードのスクリーンショットを提供した。[ユーザーの実会話内カード](references/2026-10-24-inline/native-operations-inline-user.png)には、my-name-is-yu/Arco #2、Closed · CompletedのState、担当者・ラベル、右上の「…」とOpen detailsが表示されている。画像を加工せず保存し、追加版のinline表示を確認済みとした。実Codex inlineからの保存と展開操作は引き続き未確認。commit／pushは行っていない。

## 補助メニューの外側操作で閉じる修正

ユーザーから、会話内カードの「…」が同じトリガーを再度押すまで閉じないとの報告を受けた。native detailsの開閉に加え、メニュー外のpointerdown／focusinで閉じ、Arcoのiframeから会話側へfocusが移った場合もwindow blurで閉じるようにした。外側の操作先にはfocusを戻さず、押した先の動作を続ける。Escapeとコピー成功時のトリガーへのfocus復帰、コピー失敗時の手動入力欄は保持する。コピー完了が遅れても、外側操作ですでに閉じた後はトリガーへfocusを戻さない。

両sourceの新しい回帰テストは、カード内の外側クリック、iframe外のhost入力欄への実tap、Tabで外の操作への移動、Escape、clipboard拒否時の手動コピー欄を確認した。inline browser 12件、unit／adapter 365件、型・lint・format・build・71 tools smoke・artifact検査が成功した。

コピー完了後のfocus保護を加えた最終buildでは、閉じ方の回帰テストと既存のコピー／元サービス導線の2件を再実行して成功した。遅延したclipboard Promiseの解決後も、メニューが閉じたままで外側の操作先のfocusが保持されることを両sourceで確認した。全149件の再実行は行っていない。

ローカルpluginを更新し、HTML 1,653,951 bytes、SHA-256 `6240a9f07e180494a8229691b12f73ed8b6c3b1240038526d9659fb8040be812`がbuildとinstalledで一致した。serverのhashは上記から変わらない。この閉じ方の修正は次の再起動後の実会話内操作確認として残し、直前の表示確認画像とは区別する。実サービスへの書き込みは行っていない。

## 状態・ラベルの色と担当者・優先度のアイコン

ユーザーが承認した方針に沿って、会話内カードの属性ボタンとメニューへ同じ視覚表示を追加した。GitHub状態はOpen＝緑の輪、Completed＝紫のチェック、Not planned＝中立色の斜線。未知のclosed理由は元の名前を保持し、中立色の形で表示する。Linear状態は元の設定色とworkflow種別の形を使う。ラベルは元の色の点、担当者は中立色のイニシャル／未割当の人型、Linear優先度は棒の段階と名前を表示し、Urgentだけを控えめな暖色にした。

既存の丸いボタン、本文配置、背景色、先頭の選択値＋残件数を保持する。アイコンは装飾として扱い、SDKの検索用labelと読み上げ名へイニシャル等を混ぜない。色は6桁hexだけを受け入れ、欠落・不正値は中立色にする。担当者画像の取得や新しいAPI契約は追加せず、sourceのID／値・保存先・複数選択の制約は維持した。共通controlは任意のleading表示を受け入れる拡張とし、会話内以外の呼出しへアイコンを追加していない。

検証結果は、型・lint・format、365件・32 filesのunit／adapter、build、71 tools smoke、artifact検査が成功。新規3件を含むinline browser 15件が成功した。両sourceの色の一致、先頭ラベルを外した後の表示更新、native値での保存、未割当・Urgent、明暗テーマと375px幅、不正な色の中立表示、メニューの幅と読み上げ名を確認した。関連の8件は7件が初回に成功し、残る本文比較テストは画像のLoading表示を比較してしまう不安定な待機を修正し、画像が見えるまで待つ形で個別再実行して成功した。全149件の再実行は行っていない。

内蔵ブラウザの独立したfixtureでも、GitHubの状態保存後の色・ラベル色・担当者、Linearの状態色・優先度保存を確認した。errorログ0件。[GitHub](references/2026-10-24-inline/colors-github.png)、[GitHub状態メニュー](references/2026-10-24-inline/colors-github-menu.png)、[Linear](references/2026-10-24-inline/colors-linear.png)、[Linear優先度メニュー](references/2026-10-24-inline/colors-linear-priority-menu.png)、[light・375px幅](references/2026-10-24-inline/colors-light-narrow.png)を保存した。これらはfixtureの描画・操作確認であり、実サービスへは書き込んでいない。

導入済みローカルpluginも更新した。HTML 1,659,580 bytes、SHA-256 `b56c71f5021ee368443df297d9512519840542bf5478229b77720e4658146ae5`がbuild／installedで一致し、serverのhashは変わらない。この色・アイコン版の実Codex反映は次の再起動後の確認として残す。commit／pushは行っていない。
