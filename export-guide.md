# エクスポート手順ガイド

Lumoraに取り込むための、各AIチャットサービスからの会話データの取り出し方をまとめています。

このガイドは**使う人向けの手順書**です。ファイル形式の技術仕様（パーサーがどう読むか）は
`docs/import-spec.md` を参照してください。

---

## どれを選べばいい？

| 使っているサービス | 取り出せるもの | かかる時間 |
|---|---|---|
| ChatGPT | 全会話をまとめて | 数分〜最大7日 |
| Gemini | 全会話をまとめて（Google Takeout経由） | 数分〜数時間 |
| Claude | 全会話をまとめて | 数時間 |
| Perplexity | **1スレッドずつ**（一括はできません） | すぐ |

いずれも、できあがったファイルをLumoraのアップロード画面へ渡せば取り込めます。

---

## ChatGPT

### Android / iPhone・iPad（アプリの場合）

1. サイドバー（**☰**）を開く
2. **プロフィールアイコン**をタップ
3. **データ管理**（Data Controls）
4. **データをエクスポート**（Export Data）
5. 確認画面で実行

<!-- 画像：docs/images/export-guide/chatgpt-app-01-sidebar.png -->
<!-- 画像：docs/images/export-guide/chatgpt-app-02-data-controls.png -->
<!-- 画像：docs/images/export-guide/chatgpt-app-03-export.png -->

### Windows / Mac（ブラウザの場合）

1. **プロフィールアイコン**をクリック
2. **Settings**
3. **Data Controls**
4. **Export Data**
5. 確認画面で実行

<!-- 画像：docs/images/export-guide/chatgpt-web-01-settings.png -->
<!-- 画像：docs/images/export-guide/chatgpt-web-02-data-controls.png -->

### スマホのブラウザからでもできます

Chrome等でChatGPTのWeb版にログインすれば、**上のPC版と同じ手順**で進められます。
入口が違うのはアプリ版だけで、Web版はどの端末でも共通です。

### 実行したあと

1. 確認メールが届く
2. メール内の **Download data export** を開く
3. ZIPファイルがダウンロードされる
4. **このZIPをそのままLumoraへアップロード**（解凍しなくて構いません）

> **準備に最大7日かかることがあります。** ダウンロードリンクには有効期限があるので、
> メールが届いたら早めに受け取ってください。

> **たくさん使っている方へ。** 会話量によっては、ZIPの中の `conversations.json` が
> 番号付きで複数のファイルに分かれていることがあります。Lumoraは複数ファイルに
> 対応しているので、そのままアップロードして大丈夫です。

---

## Gemini（Google Takeout経由）

Geminiの会話は、Google Takeoutという別のサービスから取り出します。
**途中に2つ間違えやすい箇所があります。**どちらもこのページで印を付けています。

1. [takeout.google.com](https://takeout.google.com) を開く
2. **「選択をすべて解除」**を押す
3. 一覧から**「マイ アクティビティ」**だけにチェックを入れる

   <!-- 画像：docs/images/export-guide/gemini-01-deselect-all.png -->
   <!-- 画像：docs/images/export-guide/gemini-02-my-activity-checked.png -->

4. 「マイ アクティビティ」の中にある**「HTML形式」ボタン**を押し、**JSON**に変更してOK

   > ⚠️ **ここが最重要です。** HTML形式のままだとLumoraは読み込めません。

   <!-- 画像：docs/images/export-guide/gemini-03-format-json.png -->

5. 同じく「マイ アクティビティ」の中の
   **「すべてのアクティビティデータが含まれます」ボタン**を押す
   → **「選択をすべて解除」** → **「Gemini アプリ」**だけにチェックしてOK

   > ⚠️ **間違えやすい箇所です。** 一覧の上のほうにある単独の**「Gemini」**という項目には、
   > Gemsの設定データしか入っておらず、**チャット履歴は含まれません。**
   > かならず「マイ アクティビティ」の中から「**Gemini アプリ**」を選んでください。

   <!-- 画像：docs/images/export-guide/gemini-04-gemini-apps-only.png -->

6. 一番下の**「次のステップ」**へ進み、配信方法とファイル形式（**.zip**）を選んで
   **「エクスポートを作成」**

   <!-- 画像：docs/images/export-guide/gemini-05-create-export.png -->

7. メールで通知が届いたらZIPをダウンロードし、**解凍**します
8. `Takeout / マイアクティビティ / Gemini アプリ / MyActivity.json` が入っています。
   **この `MyActivity.json` をLumoraへアップロード**してください

---

## Claude

**Web版、またはClaude Desktopから**行います。

1. **設定**
2. **プライバシー**
3. **データをエクスポート**
4. 数時間後、メールでダウンロードリンクが届く
5. ZIPをダウンロードして、そのままLumoraへアップロード

<!-- 画像：docs/images/export-guide/claude-01-settings-privacy.png -->
<!-- 画像：docs/images/export-guide/claude-02-export-data.png -->

> ⚠️ **ダウンロードリンクの有効期限は24時間です。** メールが届いたらその日のうちに
> 受け取ってください。

> ⚠️ **iOS / Androidアプリからはエクスポートできません。** Web版かDesktop版を使ってください。

---

## Perplexity

Perplexityには**全件をまとめて取り出す機能がありません。**
残しておきたいスレッドを、1つずつ保存します。

1. Perplexityにログインし、**Library** などから対象のスレッドを開く
2. 回答エリアの右上あたりにある**共有アイコン**、またはその隣の**「…」**を開く
3. **Export as Markdown / PDF / DOCX** から選ぶ
   → **Markdown を選んでください**（Lumoraが読み込める形式です）

<!-- 画像：docs/images/export-guide/perplexity-01-share-menu.png -->
<!-- 画像：docs/images/export-guide/perplexity-02-export-markdown.png -->

### メニューが見つからないとき

1. ページを再読み込みする
2. 回答を**最後まで表示**させる（途中だとメニューが出ないことがあります）
3. 個別の回答の上部にある共有アイコンを確認する
4. それでも無ければ、本文を全選択（`Cmd/Ctrl + A` → `C`）して、
   テキストエディタに貼り付けて保存する（最終手段）

> **「Copy link」は保存になりません。** あれは参照用のURLを作る機能で、
> リンク先が消えれば内容も見られなくなります。ファイルとして手元に残してください。

---

## 撮影が必要なスクリーンショット一覧

このガイドには画像の差し込み位置だけが入っています。以下を撮って
`docs/images/export-guide/` に同名で置くと表示されます。

| ファイル名 | 撮る画面 |
|---|---|
| `chatgpt-app-01-sidebar.png` | ChatGPTアプリのサイドバー（☰を開いた状態） |
| `chatgpt-app-02-data-controls.png` | データ管理（Data Controls）の一覧 |
| `chatgpt-app-03-export.png` | データをエクスポートの確認画面 |
| `chatgpt-web-01-settings.png` | ブラウザ版のSettings入口 |
| `chatgpt-web-02-data-controls.png` | ブラウザ版のData Controls |
| `gemini-01-deselect-all.png` | Takeoutで「選択をすべて解除」を押す直前 |
| `gemini-02-my-activity-checked.png` | 「マイ アクティビティ」だけにチェックが付いた状態 |
| `gemini-03-format-json.png` | 形式をJSONに変更するダイアログ |
| `gemini-04-gemini-apps-only.png` | 「Gemini アプリ」だけにチェックが付いた状態 |
| `gemini-05-create-export.png` | 「エクスポートを作成」の直前 |
| `claude-01-settings-privacy.png` | 設定 → プライバシー |
| `claude-02-export-data.png` | データをエクスポートのボタン |
| `perplexity-01-share-menu.png` | 回答上部の共有アイコン／「…」を開いた状態 |
| `perplexity-02-export-markdown.png` | Export as Markdown の選択肢 |

画像を置いたら、対応する `<!-- 画像：… -->` の行を
`![説明](docs/images/export-guide/ファイル名)` に置き換えてください。

---

## 困ったとき

- **ファイルを選んでもエラーになる**
  → Geminiの場合、形式がHTMLのままの可能性があります。JSONで取り直してください。
- **Geminiの会話が1件も入っていない**
  → 単独の「Gemini」項目を選んでいる可能性があります。
  「マイ アクティビティ」→「Gemini アプリ」で取り直してください。
- **ダウンロードリンクが切れた**
  → もう一度エクスポートを申請してください。

---

*各サービスの画面は更新されることがあります。手順が合わない場合はお知らせください。*
