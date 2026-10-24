# 会話内を標準にする起動・表示方針の確認

確認日: 2026-10-24 JST

## 採用した仕様と実装

「Issueを見せて」は会話内カードを標準とし、詳細画面・一覧を明示的に開く場合だけ広い表示へ移る。[表示方針](../screen-structure.md#会話内とサイドパネルの使い分け)に従い、表示先を毎回選ばせない。本文の長さや、AIへの要約・更新依頼だけではパネルを開かない。

| 入口                | 用途                                      | UI resource / 表示の希望        |
| ------------------- | ----------------------------------------- | ------------------------------- |
| `arco_show_issue`   | 1件を会話内に表示。通常の「見せて」の入口 | `ui://arco/issue-card` / inline |
| `arco_open_issue`   | 明示的な詳細画面の要求                    | `ui://arco/issues` / fullscreen |
| `arco_open`         | 明示的な個人一覧・管理画面                | global入口 / fullscreen         |
| `arco_open_project` | 明示的な会話用repo一覧・管理画面          | thread入口 / fullscreen         |

show／open issueは厳密なsource別native refを必須とし、返されたIssueのsource・識別子・所属を照合する。対象不明時に保存済み一覧の先頭へ置き換えず、読取りエラーや異なる対象は失敗として返す。両者はread-onlyで、共有やIssueの変更は行わない。

会話内用と一覧・詳細用は、同じHTMLを別のUI resourceとして公開する。両resourceでinline／fullscreenを宣言し、カードのOpen detailsから同じIssueへ移れる。toolにも対応する表示希望を設定する。会話内用ツールにはglobal／thread入口を登録しない。

UIは最初の有効なlaunchをその表示インスタンスの起動情報として保持する。明示的な表示対象を共有対象より優先し、source・repo／team・選択Issueをローカル状態で初期化する。初期表示で保存済みのsource・対象範囲や、Codexの共有contextを書き換えない。targetを持つinlineでは関係のない一覧・探索・共有Issueの読取りも起動しない。Linearはtargetのconnectionを使用し、workspace不一致時はエラーにする。

Open detailsは対象のnative refを選び直し、ローカルrepo／teamを合わせてから表示変更を要求する。パネルで別Issueを閲覧してinlineへ戻ると元のカード対象へ戻る。別の表示ツール結果が届いても、すでに開いているインスタンスの起動情報を勝手に置き換えない。初回tool失敗時はloadingを続けずエラーを表示し、その後の有効な起動情報で回復する。

## ローカル検証

- 型・lint・format、unit／adapter 399件・33 filesが成功した。
- 実MCPクライアントを使う新規29件で、tool／resourceの表示希望、入口の有無、両sourceの厳密な対象、異なる識別子・所属、不正・混在入力、providerエラーを検証した。
- host単体テスト29件で、source別targetの初期化、共有内容の保持、後続結果による既存パネルの対象変更の拒否、初回エラーと回復、起動時の表示要求・共有書込みなしを確認した。
- launch＋inlineのbrowser 31件が成功した。fixture hostは本物のMCP tools/listとresources/readのmetadataから初期modeを決め、inlineを固定値で成功させていない。新規6件は、共有対象と異なるtarget、指定Issueの直接詳細表示、別Issue閲覧後のカード復帰、既存パネルの下書き・絞込み・保存設定の保持、Linear workspace不一致時の拒否を含む。
- 最終buildのstdio smokeは73 tools、2 UI resources、両sourceのshow／open、mention resource、fixture保存・dedupが成功した。artifactはself-contained HTML 1,661,409 bytesで、fixture混入はない。既存の`::highlight`に関するCSS optimizer警告は継続する。
- 最終buildで全browser 159件が一括実行で成功した（5.0分）。失敗・再試行・assertion変更はなく、新規経路に加えて既存の下書き・共有・検索・pagination・接続・操作・選択control・表示通知の回帰を確認した。最終の型・lint・format・unit検査も成功した。

内蔵ブラウザの独立したfixtureでは、表示切替ボタンを押さずに[GitHub #42が会話内で起動](references/2026-10-24-inline/presentation-default-inline.png)した。Open detailsで[同じ#42の詳細](references/2026-10-24-inline/presentation-open-details.png)を開き、#43を閲覧してからinlineへ戻しても[#42のカードを保持](references/2026-10-24-inline/presentation-returned-card.png)した。共有contextの`yu/Other#42`は置き換わっていない。別の明示的な詳細入口では、一覧先頭のYU-42ではなく[指定したYU-43の詳細](references/2026-10-24-inline/presentation-explicit-linear-detail.png)が最初から表示された。両fixtureのブラウザerrorログは0件。実サービスのIssueは変更していない。

## 配布と実Codexでの確認範囲

既存のローカルpluginを更新し、`dist/plugin`と導入済みcacheのhashが一致した。

| 配布物     | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| arco.html  | `a0a5c98e396514f66f97f23a0cc5a64b8a05f3c516a2906b2bc8b96e59d3a85a` |
| server.mjs | `86ed942873333928455060a99cd8d89159563d7f25dd1760d7d1c62700fc92df` |

これはローカル実装・MCP契約・fixture動作と配布物の確認である。新しいツールとresourceの実Codex反映は再起動後に確認する。自然言語からのツール選択、実ホストがinlineの表示希望を採用すること、既存パネルの再利用時に明示的な詳細起動が新しい表示インスタンスになることは、fixtureの成功だけでは確認済みにしない。

Arcoの起動時に表示変更を要求する処理は追加していない。Codexが再起動時に以前のパネルを復元するかはホスト側の挙動であり、本変更で制御・解消したとは扱わない。commit／pushは行っていない。

## 追補: Linearと共通の一覧起動

単一Issueの表示・詳細起動・カード操作は両sourceの共通入口と部品を使用する。一覧についても`arco_open`へ任意の`source: github | linear`を追加し、「Linearの一覧」を明示した場合は共有中や保存済みのGitHub選択より優先する。source未指定時の従来の起動情報は保持する。Linear指定時はLinearの接続だけを確認し、GitHub接続を前提にしない。

hostは入口名だけで起動情報を確定せず、サーバーから最初に届いた有効なlaunchを使う。target、明示source、共有・保存済み選択の順で初期sourceを決め、起動時に設定や共有contextを書き込まない。明示sourceは初期値であり、その後の通常のsource切替を妨げない。共通部品とprovider固有の責務は[技術スタック](../technical-stack.md#github--linearの共通基盤)に記録した。

- 最終ソースの型・lint・format、unit／adapter **411件・33 files**が成功した。MCP表示契約37件、host単体33件を含む。
- 最終buildのlaunch＋inline browser **33件**が成功した。両sourceで、保存済み・共有中の反対sourceより明示指定を優先すること、初期化時の設定・context書込みなし、その後の手動source切替を確認した。前節の全browser159件は追補前の記録であり、今回の全161件の一括実行ではない。
- build、73 tools smoke、artifact検査が成功した。HTMLは1,661,392 bytes。実サービスのIssueは変更していない。
- ローカルpluginを再更新し、buildとinstalled cacheのHTML／serverのhash一致を確認した。HTMLのSHA-256は`b1a490e38bbdba245ab53e028c89bee0cfd0d5122db238fef95ea2d47830a6cd`、serverは`2cff70a03b67882f9ca4d885b74b9a5d732e6e825861454bfbeae0e05020a269`。前節のhashは追補前の配布物である。

この追補も実Codexでの新しいツールの読込み・自然言語による入口選択を確認したものではない。次回再起動後の確認として残す。
