# プラグイン表示仕様とArcoのUX候補

調査日: 2026-10-22
状態: 仕様調査と議論用の提案。最小probeの標準経路でCodexのinline表示とbridge初期化を確認。Arco本体は未実装。

2026-10-23追記: 以下は当初の調査記録。ユーザー希望によりPiP案は採用を取り消し、現在のArcoはinline／fullscreenを対象とする。SDKで利用可能なmodeと、Arcoが採用するmodeは区別する。

## 調査の目的

ユーザーは、プラグインでどう表示できるかを調べた上で、使いやすいArcoの形を議論したいと希望している。
MagicPathを、Codexと一体感のあるサードパーティ実装の参考にする。
GitHub ProjectsのStatusを進捗の保存先とする方針は決定済み。

## 起動場所と表示方法

起動場所を指定するentrypointと、UIの表示モードは別の概念。

| 仕組み            | 公式資料で確認できた内容                                                                  | Arcoで考えられる用途                                                 |
| ----------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| global entrypoint | サイドバーに入口を設け、アプリをホスト内のfullscreenで開く。                              | Issue一覧、横断検索、一括操作、ラベル管理。                          |
| thread entrypoint | 会話のside panelにアプリを開く入口を設ける。                                              | Issueの本文・コメント・進捗を見ながらCodexと相談。                   |
| inline            | 会話中の構造化された結果や少数の操作を表示する。                                          | Issue要約、作成・変更結果、詳細への入口。                            |
| fullscreen        | 詳細閲覧・編集など、広さが必要な操作向け。ChatGPTの説明ではシステムのcomposerも利用する。 | 一覧と詳細、複数Issueの整理。                                        |
| pip               | 会話と並行する継続的な活動の表示向け。                                                    | 当初の候補。2026-10-23に採用を取り消し、Arcoの提供対象には含めない。 |

サイドバーはアプリへの起動入口として説明されている。アプリの管理画面そのものは、開いたUI領域の中で構成する。
UIの実体は、ホスト内のiframeで表示するWeb UI。ホストのテーマや利用可能な表示情報に合わせて構成する。

出典: [Plugin Extensions](https://developers.openai.com/plugins/build/extensions#sidebar-apps)、[MCP UIの概要](https://developers.openai.com/plugins/build/chatgpt-ui#overview)、[表示方法](https://developers.openai.com/plugins/build/chatgpt-ui#choose-a-presentation)。

表示モードは`inline`・`fullscreen`・`pip`を宣言し、ホストへ切り替えを要求できる。
具体的なAPI参照では、fullscreenのみの宣言によりinlineの読み込み表示を挟まず起動する方法も記載されている。
UIガイドに残る「最初は必ずinline」という一般説明を、全起動経路の制約とは扱わない。

2026-10-22、最小probeの実画面で会話本文内へのinline表示を確認した。[検証記録](inline-probe-validation.md)を根拠とし、fullscreen・PiPやArco本体の操作まで確認済みとは扱わない。

出典: [表示モードの事前宣言](https://developers.openai.com/plugins/reference#declare-display-modes-before-the-ui-loads)、[表示変更の要求](https://developers.openai.com/plugins/reference#request-another-presentation-mode)。

## 操作と会話の連携

- UIからMCPツールを直接呼べる。Status変更やラベル操作のたびにAIへ文章で依頼する必要はない。
- 選択中の情報を`ui/update-model-context`でモデルへ渡せる。選択変更とチャットへの投稿を分けられる。
- 拡張の一覧には、現会話・新会話へのメッセージ送信、特定項目へのdeep link、composerからのコンテンツ選択が記載されている。
- ツールとUIは共通のGitHubデータを参照し、選択位置や検索条件は表示の状態として扱う。
- widget stateは単一UIの状態保持用。会話をまたぐ表示設定や、Issueそのものの保存先とは区別する。

出典: [共有UI API](https://developers.openai.com/plugins/build/chatgpt-ui#prefer-shared-fields-and-methods)、[状態管理](https://developers.openai.com/plugins/build/chatgpt-ui#manage-state)、[拡張の一覧](https://developers.openai.com/plugins/build/extensions#extension-reference)。

## MagicPathから参考にすること

導入済みMagicPath 2.0.0の組込説明で、次を確認した。実画面の操作やリモートアカウントの参照は行っていない。

- 同じcanvas appをsidebarとtask trayから利用する。
- 選択した内容の限定されたコンテキストをCodexへ渡す。
- 「Add to chat」はコンテキストの添付、「Send to Codex」はターン開始として分ける。
- openを繰り返すと別タブを作る場合があるため、同じ作業では既存canvasを再利用する。

出典: [導入済みMagicPathの説明](/Users/yuyoshimuta/.codex/plugins/cache/openai-curated-remote/app-6a883213fb288191aa91f89a5db31f60/2.0.0/skills/magicpath/SKILL.md:19)。

Arcoへ置き換えるなら、canvasはIssueを扱うワークスペース、選択対象はIssueやコメントになる。
「Issueを選ぶ」「会話へ添付する」「Codexへ依頼を送る」をそれぞれの操作として設計する候補がある。
Issue選択のたびに別タブや会話を作る必要はない。

MagicPathの実例はUXの参考になるが、ローカルのplugin manifestだけではリモートのentrypoint登録内容は分からない。
MagicPathで説明されている機能と、Arcoで公開仕様から実装・利用できる機能は、実装時に照合する。

## 画面構成の候補

| 案                       | 主な使い方                                        | 利点                         | 課題                                                   |
| ------------------------ | ------------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| 会話横を中心にする       | 実装中にIssueを読み、Statusやコメントを更新する。 | 会話との行き来が少ない。     | 横断一覧や一括操作は幅が足りにくい。                   |
| 広い管理画面を中心にする | 仕事を選び、Issueを整理してから会話へ渡す。       | 一覧と詳細を見比べやすい。   | 会話へ移る導線が必要。                                 |
| 同じアプリを両方で使う   | 整理は広い表示、実装中は会話横で扱う。            | 作業に合わせて広さを選べる。 | 表示切り替えと作業状態の引き継ぎを確認する必要がある。 |

同じArcoを広い管理画面と会話横の両方で利用し、選択Issueを会話へ渡せる方向はユーザーが採用した。
会話連携では、選択内容のコンテキスト共有、composerからのIssue選択、現在／新しい会話への依頼、Codexの更新のUI反映の4項目を初版必須として採用した。具体的な操作と実機確認は[要件定義](requirements.md)で管理する。
当初は全表示形式を提供する方針だったが、2026-10-23の変更でinline／fullscreenに絞った。
具体的なレイアウトや遷移と、形式ごとの実装順は未決。[画面構成案](screen-structure.md)で詰める。

### 広い管理画面の案

- 選択中ProjectのIssueを複数repoにまたがって一覧表示する。
- repoは列と絞り込み条件として扱う。同じ一覧の中で、横断表示とrepo単位の表示を切り替える。
- 広さがあるときは一覧とIssue詳細を併置する。
- 一括操作・ラベル定義の管理はこの表示を中心にする。
- 「このProjectに未追加」のIssueも、対象repoを選んで拾えるようにする案を検討する。

### 会話横の案

- 現在扱うIssueの本文・コメント・Statusを中心にする。
- 狭い幅では一覧と詳細を切り替え、複数の細い列に分割しない。
- 選択Issueを会話へ添付できる導線を設ける。
- GitHubへのコメント投稿と、Codexへの相談を明確に区別する。AI相談にはホストの会話入力欄を使う。
- 広い表示へ戻ったとき、検索条件や一覧の位置を保てるようにする。

上記の細かな配置や動線は、仕様から導いたUXの提案として扱う。

## Codex上で確認が必要な点

公式のUI詳細資料はChatGPTとしての説明が中心。
[Plugins](https://learn.chatgpt.com/docs/plugins)はCodex desktopでのplugin利用とcustom UIへの導線を説明するが、全表示機能の同等動作を個別には保証していない。

実装の最初の検証対象は、次に絞る案とする。

1. globalとthreadの入口を登録し、このCodexで開けるか。
2. 利用可能な表示モードと実際の画面領域、会話・他パネルとの併用。
3. Issueの選択コンテキストを、意図した会話へ渡せるか。
4. コンテキストの添付と、メッセージ送信・ターン開始をどう分けられるか。
5. 特定Issueへのdeep linkと、既存UIの再利用・状態復帰。

任意の既存Codexチャット、作業フォルダ、worktreeを指定して実装を開始できるかは未確認。
固定のパネル幅、複数UIの同時表示数、全画面とパネル間での状態引き継ぎも、現時点では保証しない。
