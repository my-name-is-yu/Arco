# 過去の背景調査: Issueクライアントの課金事例

調査日: 2026-10-22
状態: 無料提供の決定前に行った背景調査。Arcoはソース非公開の無料pluginとして採用済みの製品範囲を提供し、Free／Proの区分、試用期限、課金・利用権管理は採用しない。現時点ではOSS化しない。

以下の外部事例とユーザー提供資料は、当時の検討経緯として残す。掲載価格は調査時点のUSDで、現在の料金を保証しない。購入・決済・有料機能の実動作や、各社の収益・転換率・継続率は検証していない。Arcoの現在の範囲は[最終製品スコープ](product-scope.md)、データ保護の設計は[セキュリティとデータ保護](security-and-privacy.md)を参照する。

## 比較対象

GitHub Issues/Projectsを直接扱うクライアントに、近隣のPRクライアント・通知整理・GitHub連携PM製品を加えた。同じ製品範囲として価格を平均しない。

| 製品 | Arcoとの距離 | 無料の入口 | 掲載されている有料モデル |
| --- | --- | --- | --- |
| [Gitsu](https://gitsu.app/pricing) | GitHub Issues/Projectsのクライアントで最も近い | Web版は継続無料。project数無制限、通常編集、複数view、キーボード操作 | Proは1seat $4.99/月。macOS版、AI、MCPアクセスをまとめて提供 |
| [PR Flow](https://prflow.app/pricing) | ローカルPRレビュークライアント。Issue管理専用ではない | アカウント・カード不要の全機能体験版 | 個人$69の買切。対象versionの永続利用と12か月の更新を含む。更新権は任意で再購入でき、自動更新しない |
| [Zube](https://zube.io/pricing) | GitHub連携のアジャイルPM。Arcoより広い | 4users・4projectsまで無料 | Businessは$10/user/月、5users以上。project数無制限、premium support。カード不要の30日trial |
| [Zenhub](https://www.zenhub.com/pricing) | GitHub拡張から発展したPM製品。Arcoより広い | 1workspace・2repos・250issues・最大50users | Teamsは年払い換算$4.99/user/月。10workspaces・50repos・5,000issuesなどへ上限拡大。AI等の機能差もある |
| [Octobox](https://octobox.io/) | Issue/PR通知整理。通常のIssue編集クライアントとは異なる | OSS向け無料。private repoの基本通知も無料 | private repoの詳細な通知・live情報を有料化。GitHub Marketplace掲載は個人$10/月、organization $100/月 |

GitsuはWeb/desktopという利用面とMCPアクセスで課金している。無料版も有料版もproject数無制限で、有料版にも現時点ではcross-project viewがない。「競合は横断管理で課金している」と読み替えない。Arcoのために別の無料Web製品を追加する根拠にもならない。[Gitsu公式](https://gitsu.app/pricing)

PR Flowは、sourceの内容を自前サーバーへ送らず、ローカルで認証済みCLIなどを通じて読むと説明している。買切＋更新権は、ローカル製品を維持する対価として参考になる。ただし、source APIやCodex hostの変更への追従が必要なArcoで、旧版の永続利用をどこまで保証できるかは別に考える。[PR Flow公式](https://prflow.app/pricing)

OctoboxにはGitHub Marketplace購入とOpen Collective支援という支払い方法がある。料金ページの「from $10/user/month」とMarketplaceのorganization定額表記は一致しないため、上表は[Marketplaceの掲載価格](https://github.com/marketplace/octobox)と明示している。[料金説明](https://octobox.io/pricing)

## 補足と確認限界

- [Hush for GitHub](https://hush-gh.com/pricing)は、単一プラン$3/月または$30/年を掲載しているが、beta中は全機能無料で、paid planはまだ開始していない。販売済みの成功事例として数えない。通知監視・データ保持のサーバー費用を料金の理由に挙げており、端末優先のArcoとは費用構造も異なる。
- [Gitify](https://gitify.io/)のような無料・OSSの通知クライアントもある。有料製品の存在だけで、wrapper全般への支払意思が実証されたとはいえない。
- [Codetree](https://codetree.com/)は終了告知が出ているため、検索に残る旧料金を現在の選択肢に含めない。
- PR Flowは公式検索に料金本文が掲載されているが、調査中にページの直接取得が503になる場合があった。試用期間も公式ページ間に7日/14日の差があったため、上表では日数を確定していない。

## Pluginの推薦と継続利用

ユーザー提供のDevDay登壇写真には、「ランキングの指標」として「コンバージョン率」「アクティブ利用」「継続率」が明記されている。これは提供写真で確認した情報として採用する。公開ドキュメントに詳細がないことを理由に否定しない。

公開公式資料にも、実際の有用性と高い利用者満足度を示したpluginが、directory掲載や能動的推薦の対象になり得るとある。[Discovery](https://developers.openai.com/plugins/deploy/app-review#discovery)、[Guidelines](https://developers.openai.com/plugins/plugin-guidelines#overview)

ただし、写真だけではconversionが導入・接続・初回利用・購入のどれを指すか、active/retentionの期間や分母、重み・閾値は分からない。「有料転換率が高ければ順位が上がる」「無料ユーザー数を増やせば推薦される」とは断定しない。

## 現在の方針との関係

この調査を踏まえた継続無料＋Proや、全機能試用後に有料化する案は撤回した。ユーザーはArcoの無料提供を決定している。

- 採用済みのGitHub／Linearの操作、4会話連携、全表示形式を無料で提供する。個々の実装順は別途決める。
- 料金案に由来する単一repo／team制限は設けない。source混在表示や横断範囲、保存filterやbulkの詳細は、料金と切り離して詰める。
- Arco独自のアカウント・ログイン、Stripe、課金API、利用権サーバー、サーバー側DBを構成へ追加しない。GitHub／Linearへのローカル認可は必要である。
- 無料提供は、推薦・継続利用・普及を保証する判断ではない。既存scopeの操作を磨き、実際に導入・利用された事例や改善を実績として残す。
- 利用指標の話は残すが、そのための独自分析サーバーや追跡を採用したわけではない。

この調査は、Arcoのplugin公開資格や審査通過を確認したものではない。ソース非公開の無料提供と公開経路の確認は別であり、配布と元サービスへの認可は[認証・配布](auth-distribution.md)で扱う。
