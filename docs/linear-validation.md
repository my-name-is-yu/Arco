# Linearの実装と検証

確認日: 2026-10-23。

## 実装

`src/server/linear/`は、元のworkspace/team/Issue IDを保った独立したLinear adapterである。GitHubのOpen/ClosedやProjects StatusをLinearのworkflowへ合成しない。

- `service.ts`: 公式`@linear/sdk@99.0.0`の型付きquery/mutation。一覧・検索・ページ取得、詳細、作成・本文・状態・担当者・既存属性、incremental label、定義管理、コメントと返信、リアクション、親子・関連、添付、単純template、一括操作。
- `auth.ts`: PKCE S256とstate照合、`actor=user` / `read,write`、loopback callback、token交換・更新・解除。client secretを配布物へ入れない。
- `fixture.ts`: 架空のLinear workspace/team/Issue。実サービスを呼ばず、接続表示もfixtureと区別する。
- `src/shared/linear.ts`: source固有の入力schemaとDTO。workspace/team/接続ID、本文/コメントの親子、ラベルscope、既存Project/cycle/milestone等を保持する。

2026-10-24の一覧軽量化では、`linear/issue-list.ts`の専用GraphQLで一覧用の識別子・タイトル・URL・更新日時・状態を100件ずつ取得する。workspace/team確認も同じクエリ内で行い、一覧から本文と全編集metadataの取得を外した。検索は従来の`searchIssues`と`includeComments:true`、各filter・order・cursorを維持する。詳細・編集・コメント・画像の契約は従来どおり。検証の範囲と数値は[一覧の検証記録](linear-list-validation-2026-10-24.md)を参照。

採用操作の保存後には元サービスを再取得する。ラベルは`addedLabelIds` / `removedLabelIds`だけを送り、無関係なラベルを全置換しない。single-select groupで明示されていない兄弟ラベルを暗黙に外さない。属性は明示したteam/workspaceの既存値を検証する。

会話・UIのtool呼出しは同じadapterを使用する。Arcoの独自backend、Issue mirror、agent queueは追加していない。

## 安全なcredential保存と更新

`@napi-rs/keyring@2.1.2`を追加した。macOS/Windows/Linuxのnative packageが配布されている。macOS arm64でrandomなテストsecretのwrite/read/deleteが成功し、secret値は出力していない。

Linear token pairはOS credential store内の一項目へ保存する。設定・下書きJSONやUI/tool結果には含めない。Linuxはupstreamの自動keyutils fallbackを使わず、`secret-service`を明示する。利用不能・ロック・拒否時は接続エラーとし、平文へfallbackしない。他OSでの実保存は未観測である。

refreshは接続ID単位の`proper-lockfile` process lock内でcredentialを読み直す。必要時だけrefreshし、新しいaccess/refresh token pairを一度に保存する。ファイルに置くのはlock metadataだけである。失敗時は既存pairを保持する。

callbackは127.0.0.1だけにbindし、登録したpath/Host/stateを照合する。code交換を二重実行せず、完了・取消・時間切れでlistenerを外し、PKCE/codeを含むactive closureを破棄する。完了statusはsecretを持たないplain objectだけを保持する。

公開根拠: [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication)、[keyring binding](https://github.com/Brooooooklyn/keyring-node)。

## 通った検証

型チェックとLinear対象のlintを確認した。VitestのLinear/auth/upload 23件は成功した。

- 本文の競合検出、requestId重複・別payload拒否、無関係ラベル保持、返信parent、native workflow、Project/milestone ID、bulk部分失敗。
- PKCE S256、state不一致拒否、その後の正常callback、secretなし交換・refresh、取消・保存失敗、local解除とprovider revokeの区別。
- 独立した2つのNode processで、OS credential store内の架空token pairを同時refreshした。実process lockによってrefresh実行は1回となり、両processは更新済みpairを利用した。テストcredentialとlock用tempは削除済み。実Linear tokenやAPIは使っていない。
- 公式SDKを実際のloopback HTTP GraphQL endpointへ接続し、source検索filter/cursor、incremental label mutationと保存後detail再取得、duplicate stateへの直接変更拒否、HTTP 200内のGraphQL error拒否、一つのIssueで属性保存後のlabel失敗を検証した。部分失敗は保存済み属性と再取得した現状を返す。
- 依存関係のincoming/outgoingを元のIDを保って区別する。templateの本文未入力は元の既定値を保持し、明示的な空文字とは区別する。コメント競合、認可callback処理中の切断、providerの一般的な400応答で失効成功と誤認しないことを検証した。
- create/commentの保存ACK後に再取得だけが失敗した場合は、作成済みのsource IDを持つ`LinearSavedReceipt`を返す。通常の作成成功DTOと区別し、未保存や再投稿可能と誤認させない。同一requestIdの再試行でmutationを再実行しないことも確認した。
- 有効な10 MiBのbase64 uploadを実際にdecodeし、正しいbyte数を確認した。10 MiB+1は拒否し、padding/文字種/長さが不正な入力も拒否する。繰り返しgroupによる大容量正規表現のstack overflowを避ける。

`tests/linear-native-rotation.test.ts`は安全なOS保存先が利用できない実行環境ではskipする。今回のmacOS arm64ではskipせず成功した。

## 実認可・実データ

既存Codex connectorのユーザー情報を公開toolで読み、独立認可が必要なアカウントの識別だけを確認した。connectorのcredential/cacheは読んでいない。

ユーザー指定のnative Linear appで、本人の既存Yu workspaceを確認した。ユーザーの具体的なaction-time承認後、privateのArco OAuth appを登録した。登録済みcallbackは`http://127.0.0.1:53187/oauth/linear/callback`である。Public、client credentials、webhooksはすべて無効のまま。client secretはコピー・出力していない。

実認可用のproduction MCP callbackを起動し、既存のChrome仕事用profileから本人のYu accountで通常loginした。Arco / Yu workspace / read,writeのみのconsentを確認し、承認後にlocal callbackの接続完了表示を観測した。production MCPの接続・workspace/team一覧・metadata取得が成功した。新しいworkspaceは作成せず、native appや既存connectorの認証cacheを転用していない。

実providerへのrefreshを同じprocess lock helperから1回実行し、新しいtoken pairをOS credential storeへ保存した。tokenは出力せず、その後のproduction MCP接続取得が成功した。接続は検証後も利用可能な状態を保持する。実provider revokeは未実行であり、local解除とprovider revokeの条件分岐はunit testで確認した。

登録したprivate appはYu workspace内の検証用であり、他のworkspaceへの配布認可は別途必要となる。tool policyに基づく具体的なArco登録・Yu workspaceの`actor=user` / `read,write` grantのaction-time承認はユーザーから取得済みである。

uploadは公式のserver-side `fileUpload` → signed PUT → 元Issue本文へのURL保存を実装した。[公式upload仕様](https://linear.app/developers/how-to-upload-a-file-to-linear)。現在のupload form/toolはdecoded 10 MiBまでに制限し、base64長とdecoded byte数の両方を検証する。これはLinear公式の最大ファイルサイズではなく、Arcoの現transfer経路の上限である。sourceの最大値と誤表記せず、大きいファイルは公式への導線を残す。

source保存の実証に使ったIssueは、ユーザーが許可した専用dummyの[YU-48](https://linear.app/yuarenotyu/issue/YU-48)（`0e29b2d4-5fca-435d-b695-088b61256ac0`）と[YU-49](https://linear.app/yuarenotyu/issue/YU-49)（`312fc012-f062-4441-a192-7987a33dd3ea`）だけである。既存の無関係なIssueは編集していない。Symphony等のautomation opt-in labelは適用していない。

production stdio MCPで、作成・タイトル/本文・priority/due date/本人への割当・stale本文拒否、team label定義の作成/更新/削除、incremental label保持、コメント/返信/編集/削除、Issue/コメントreaction追加/取消、親子の作成/解除/再設定、blocksの両方向表示・解除、related追加/解除が成功した。試験後は両IssueをDoneにし、割当・期日を解除し、一時label定義を削除した。cleanup errorはなかった。

小さなPNGを元サービスへuploadし、保存後の本文にsource URLが残った。Linearはリンクを`[name](<https://uploads.linear.app/...>)`、完了taskを`[X]`へ正規化するため、その元のMarkdownをそのまま扱う。認証付き画像GETは元Issue/コメント内のimage URL照合と公式host制限を通し、server内だけでBearerを用いた。UIへ返すのは検証済みraster dataで、app-only toolの`_meta.image`だけに載せる。access tokenをUIやモデルへ渡さず、CSPも緩めない。[認証付きfile storage](https://linear.app/developers/file-storage-authentication)。

実APIはSDKに残る旧`issueSearch`をdeprecatedとして拒否したため、非空検索を現行`searchIssues`、通常一覧を`issues`へ修正した。filter/order/cursorは元APIへ渡し、独自indexは作らない。[SDKのfetch](https://linear.app/developers/sdk-fetching-and-modifying-data)、[filter](https://linear.app/developers/filtering)。

修正後のproduction MCPで、空検索の通常一覧30件と`hasMore:true`、専用Issue identifierによる検索、専用2件と不存在UUIDを混ぜたbulkの結果`[true,true,false]`、既存template一覧の取得が成功した。template/cycle/Project milestone/estimate値はこのteamに0件であり、実在値の設定保存を実証したとはしない。それらのID・型・既定値の扱いはfixtureと公式SDK transport testで検証した。既存のProjectやworkflow等の定義は作成・変更していない。

実行手順は`scripts/validate-linear-live.mjs WORKSPACE_ID TEAM_ID [DEDICATED_ARCO_DUMMY_ID] [DEDICATED_ARCO_CHILD_ID_TO_RESUME_UPLOAD]`。引数で対象scopeを明示し、既存IDを渡す場合は専用dummyのtitleと親子を確認する。今回の最終実行はfailureなし、cleanup errorなしで終了した。別途、既存OS保存pairのrefresh後に新しいproduction processから接続できたことも確認した。

実Codexのcomposer/表示/送信と、mock host・stdio・型チェックの成功は別の受入確認として残る。
