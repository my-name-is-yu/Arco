# 構造整理後の実Codex確認

確認日: 2026-10-24 JST

今回のローカル配布物を導入済みArcoへ更新し、ユーザーによるCodex再起動後に、実CodexのMCPアプリパネルと接続済みGitHub / Linearで確認した。[fixtureでの検証記録](refactor-validation-2026-10-24.md)とは別の結果である。

## 反映した配布物

- 更新: `codex plugin add arco@arco-local --json`。
- 導入先: `/Users/yuyoshimuta/.codex/plugins/cache/arco-local/arco/0.1.0`。
- 導入先と`dist/plugin`のHTML / serverのSHA-256一致を確認した。
- 更新前から動いていたserverは旧下書き形式を返していた。Codex再起動後、新しいserverが旧ファイルを保持して拒否するメッセージへ変わった。導入先をcwdとする本体Nodeの起動時刻も、配布物更新後の10:05:36–10:05:50 JSTだった。
- 別processでの公開app-server検査も71 tools、personal / project起動、両サービスの接続確認に成功した。これはパネル表示の確認とは分けて扱う。

| 配布物     | SHA-256                                                            |
| ---------- | ------------------------------------------------------------------ |
| arco.html  | `52e63ff27143db5f9bbf13086077d191e5dc4ba735e5794396c4de19e0024650` |
| server.mjs | `8147611afd881dbd6765f9d374d3487bd1cd7a66b99a2b9da3cd376710de9b3e` |

## 実画面で確認したこと

対象は既存の検証用GitHub `my-name-is-yu/Arco#2`とLinear `YU-49`。今回、新しいIssueの作成、本文・属性の更新、元サービスへのコメント投稿は行っていない。

| 操作                                               | 観測結果                                                                     |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| GitHub → Linear → GitHub、Linear → GitHub → Linear | 両方の実データを表示。サービス別のフィルターと未送信入力を保持               |
| GitHubの未送信コメント                             | 切替後に同じ文面と`Draft saved on this device`を表示                         |
| Linearの未送信コメント                             | 切替後に同じ文面と`Draft saved on this device`を表示                         |
| `arco_open`で別のパネルを開く                      | 両サービスで、保存済みの同じコメントを新しい表示から再読込                   |
| 端末内の下書き                                     | 両方とも現行schemaに適合、revision 1、入力した検証文と完全一致。廃止項目なし |
| Linear本文の範囲注釈                               | ユーザーが本文を範囲選択して追加し、番号1と共有対象YU-49を表示               |
| 注釈コメントの保存・開き直し                       | Arco側で保存して再表示し、同じ文面を保持                                     |
| 注釈を残してGitHubを閲覧                           | Linearの番号をGitHub上へ誤表示せず、Linearへ戻ると番号と同じコメントを復元   |
| Arco側から注釈を削除                               | 番号・編集画面・共有対象の表示が消え、未送信の下書きは保持                   |

範囲選択はMCPアプリ操作APIにドラッグ機能がないため、ユーザーが行った。以降の注釈コメント編集・開き直し・サービス切替・削除はアプリパネルを操作して確認した。

公開Arco読取で、両Issueのコメントは0件・続きなしだった。更新日時はGitHubが`2026-10-22T15:04:22Z`、Linearが`2026-10-22T15:37:09.497Z`で、今回の検証日に更新されていない。

## 旧形式と片付け

GitHub `#1`とLinear `YU-48`の既存下書きは、廃止した`promptText` / `promptTarget`を含む旧形式だった。新serverは設計どおり読み込みエラーにし、自動移行・初期化・上書きは行わなかった。新しい下書きの確認には、旧ファイルのない`#2`と`YU-49`を使った。

保持を確認した旧ファイル:

- GitHub #1: revision 15、SHA-256 `e730960ac4f36998aa3b9b8f327508df92c00ed162eba0570c71ffd20d430cb9`。
- Linear YU-48: revision 5、SHA-256 `37e82f1bc9e2575509eb99209111a7ec6ed902b3b9cdda88b78a2a95bb7f479a`。

検証用の注釈を削除し、追加した未送信コメントは両方とも空欄へ戻した。端末内でも両方のrevision 2・コメント空欄を確認した。旧2ファイルは検証前後でSHA-256が一致した。旧ファイル、既存の作成下書き、認証は変更していない。この実確認の終了時点では、commit / pushは未実施だった。

## 証跡と確認範囲

端末内の画面証跡は`dist/dev/real-codex-refactor-2026-10-24/`に保存した。

- `github-draft.jpg` / `linear-draft.jpg`: サービス切替後の保存状態。
- `reopened-github-draft.jpg` / `reopened-linear-draft.jpg`: 別パネルからの再読込。
- `annotation-comment.jpg`: 保存した注釈コメントの再表示。
- `annotation-removed.jpg`: 注釈削除後。

実画面の対象はこのMacのCodex、現在のパネル幅、暗色テーマである。今回の実確認に、Codexの添付カード自体を手で削除する経路、注釈を保持したままのCodex再起動、意図的な遅延・ACK競合の注入は含めていない。広幅 / 390px、明暗、inline / fullscreen、reduced motion、遅延・競合は[全121件のfixture browser検証](refactor-validation-2026-10-24.md)の結果と区別する。
