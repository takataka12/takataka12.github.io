# Pulse JP

iOSアプリ Pulse JP 用のニュースダイジェスト配信データです。

- 公開JSON: https://takataka12.github.io/pulsejp/digest.json
- 自動更新: 07:00 JST / 20:00 JST
- 情報源: Google News RSS の見出し・媒体名・リンク
- 要約: OpenAI Responses API

## Required repository secret

GitHub repository settings で Actions secret `OPENAI_API_KEY` を設定してください。

設定後、Actions の **Update Pulse JP digest** を手動実行すれば初回ダイジェストを生成できます。
