# 公開されている実在プラグインの表示例

確認日: 2026-10-22
生成画像ではなく、公式の公開デモ・紹介画像を確認した記録。

## 会話横パネル: Bits & Bolts Remote

- OpenAIが提供する、拡張機能を試すための実在デモプラグイン。
- [公式紹介](https://developers.openai.com/plugins/build/extensions#try-it-out)にインストールリンクがある。
- [公式動画](https://developers.openai.com/videos/plugins/extensions/file-viewer.mp4)をブラウザで再生し、左の会話と右のCADファイルビューアを視覚確認した。動画内の左上にはCodex表記がある。
- [配布ページ](https://chatgpt.com/plugins/plugin_asdk_app_6abadab6e7d881919e7491d52c7846e8)。この調査ではインストールしていない。
- [動画の表示フレーム](design/references/bits-and-bolts-official-panel-frame.jpg)。公式動画をブラウザで表示した画面をキャプチャしたもので、元動画はダウンロードしていない。
- file entrypointでthread side panelへ表示する例。sidebar起動のfullscreen動画とは区別する。

## 会話内カード: Spotify

- Spotify提供の実在アプリ。OpenAI製ではない。
- [OpenAIの公式紹介記事](https://openai.com/index/introducing-apps-in-chatgpt/)に掲載された、2025-10-06公開のChatGPTモバイル画面。
- [公式掲載画像](https://images.ctfassets.net/kftzwdyauwt9/23t0A1LumvV9QCiI9PW9Bk/6bd21637a0a371b13c352f2cb839349b/Spotify_16x9__2_.png?w=3840&q=90&fm=webp)を直接表示し、会話内のプレイリストと曲一覧を視覚確認した。画像はダウンロードしていない。
- Codexで同じカードを表示できると確認した例ではない。

## 確認範囲

OpenAI製のインストール可能なプラグインで、Codex上の会話内カードを示す公開実画面は今回の調査では確認できなかった。
Bits & Boltsの公開動画は会話横表示を示すが、inlineカードの証拠として扱わない。
PizzazやUIガイドの架空店舗画像は公式開発サンプルであり、一般公開済みプラグインの画面とは区別する。

Arcoの完成画面案は構想図のままだが、最小のローカルprobeについてはCodexの会話本文内への表示をユーザー提供の実画面で確認した。

標準の`ui.resourceUri`経路で`Host mode: inline`とbridge初期化が表示されている。これはOpenAI公式pluginの例ではなく、自作probeの実動作の証拠。[会話内カード検証](inline-probe-validation.md)に確認範囲と実画面を記録した。
