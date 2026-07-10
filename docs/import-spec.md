# インポート仕様書（Phase 1）

Knowledge OS — AIチャット統合ナレッジアプリ
対象：ChatGPT / Gemini / Claude / Perplexity

---

## 0. この文書の目的

4社の会話データをKnowledge OSの共通データモデルに変換するための仕様。
各社ともフォーマットが非公式・非保証で変更されうるため、**パーサーは「壊れても落ちない」設計を最優先**とする。

---

## 1. 共通データモデル（インポート後の正規化形）

```
Conversation {
  id: string              // 内部生成UUID
  source: "chatgpt" | "gemini" | "claude" | "perplexity"
  source_conversation_id: string | null  // 元サービスのID（取れれば保持）
  title: string
  created_at: datetime | null
  updated_at: datetime | null
  model: string | null     // わかる範囲で（GPT-5.4, Claude Sonnet等）
  messages: Message[]
  raw_ref: string          // 元ファイルへの参照（デバッグ用、原本は保持しない設計も検討）
}

Message {
  id: string
  role: "user" | "assistant"
  content: string           // プレーンテキストに正規化
  content_format_lost: boolean  // 表・コードブロック等が復元できなかった場合true
  created_at: datetime | null
  citations: string[] | null  // Perplexity等、引用元URLがある場合
}
```

**方針**：各社の生データ構造の違いはインポート層で吸収し、アプリ本体は上記の共通モデルしか見ない。これにより将来5社目が増えても、パーサーを1つ追加するだけで済む。

---

## 2. ChatGPT

### 取得方法
- 公式：Settings → Data Controls → Export Data → メールでZIPリンク（数分〜最大7日）
- ZIP中身：`conversations.json`（全履歴一括）+ `chat.html`（閲覧用）

### フォーマットの特徴
- **ツリー構造**：`mapping`というdictに全メッセージノードが入り、各ノードが`id` / `parent` / `children`を持つ（編集・再生成に対応するため）
- 単純な配列ではなく、親子関係をたどって1本の会話スレッドに復元する必要がある
- メッセージ本体は `message.content.parts`（配列）
- `message.author.role` が `user` / `assistant` / `system` / `tool`
- `model` 情報がメッセージ単位で入っていることがある（会話中でモデルが変わるケースに対応するため）

### パース時の注意点
- ルートノードから`children`をたどり、**分岐（regenerate等）がある場合は採用する枝を1つ選ぶ**必要がある（最も新しい/最後に採用された枝を選ぶのが妥当）
- `role: system`や`role: tool`のノードはUIに出さない設計を検討（ただしDeep Research citationやCanvas等の特殊コンテンツは別途フラグを立てて保持）
- カスタムインストラクション、メモリー情報は別セクションとして入っている場合があるが、Phase1では**Conversationとして扱わず除外**

### オープンな論点
- ツリーの分岐を人間が選び直せるUIを将来用意するか（Phase1では自動選択でよいと思われる）

---

## 3. Gemini（Google Takeout経由）

### 取得方法
- Google Takeoutで **「My Activity」→「Gemini Apps」** を選択（単独の「Gemini」はGemsの設定ファイルであり会話ではないため注意）
- 出力形式はJSONまたはHTMLを選択可能（**JSON指定を必須にする**運用ルールをKnowledge OS側で案内すべき）
- Gemini Apps Activityがオフの場合、そもそも履歴が存在せず復元不可

### フォーマットの特徴
- **非公式・非保証**：Googleが予告なく形式を変更する
- ZIP内の階層が案件によって異なる（2パターン確認済み）：
  ```
  Takeout/My Activity/Gemini Apps/MyActivity.json   （まとめて1ファイル）
  ```
  または
  ```
  Takeout/Gemini Apps/conversation_001.json, conversation_002.json ...  （会話ごとに分割）
  ```
- HTML形式を選んでしまった場合、構造化された`<div>`要素にクラス名で区別されているのみで、正式なスキーマはない

### パース時の注意点
- **ZIPのトップレベルパスを2パターンとも試す**（`Takeout/`直下 or ネストあり）
- 会話が1ファイルにまとまっているか複数ファイルに分かれているか、両方に対応
- JSONのフィールドは**すべて存在しない可能性がある前提**でパースする（try-catchかoptional chainingを徹底、未知フィールドは無視してログのみ残す）
- HTML形式が来た場合は正規表現ベースの簡易抽出に留め、失敗したら「JSON形式で再エクスポートしてください」と案内するフォールバックUIを用意

### オープンな論点
- Gemini Gems（カスタム設定）とApps Activity（会話履歴）を間違えて選択するユーザーが多い → **インポートUI側で「Gemini Apps」以外が来た場合に警告を出す仕組み**が必要そう

---

## 4. Claude

### 取得方法
- 設定 → プライバシー → データをエクスポート（Web/Desktopのみ、iOS/Androidアプリ非対応）
- メールでダウンロードリンク（有効期限24時間）

### フォーマットの特徴
- ZIP内に`conversations.json`（配列形式、比較的シンプル）
- 各会話オブジェクト：`uuid`、`name`（未リネームなら"Untitled"）、`created_at`、`updated_at`、`model`、`chat_messages`配列
- `chat_messages`内の各メッセージ：`sender`（human/assistant）、`text`、作成時刻（UTC）
- 3社の中では最もフラットで扱いやすい構造

### パース時の注意点
- メモリー機能のデータは含まれない（会話メッセージのみ）
- 削除済み会話は含まれない
- コードブロック等はプレーンテキストとして入っているのみ（見た目の整形情報は失われる → `content_format_lost: true`を立てる運用でよい）

### オープンな論点
- 特になし。4社中最も安定・単純な形式。

---

## 5. Perplexity

### 取得方法
Perplexityには**公式の一括エクスポート機能が存在しない**（ChatGPT/Claudeのような「設定→エクスポート」がない）。選べる手段：

1. 個別スレッドごとに共有アイコン→PDF/Markdown等でエクスポート（1件ずつ）
2. 公式データリクエストフォーム（`perplexity.typeform.com/datarequest`）経由で全データ請求（**返答まで最大30日**）
3. サードパーティ拡張機能で個別/一括エクスポート

### フォーマットの特徴
- 個別エクスポートの場合、PDF/Markdown/DOCX形式で**引用元URL（citations）がフッターノートとして付く**のが特徴（他社にはない要素）
- 一括データリクエストで返ってくる形式は非公開（要検証）

### パース時の注意点
- **Phase1では「個別スレッドのMarkdown/JSONエクスポートを手動アップロード」を基本フローとする**のが現実的（一括自動連携は現状不可能）
- citations配列は共通データモデルの`Message.citations`にマッピングする数少ない社
- 一括データリクエストの実物フォーマットは未確認のため、**Phase1のスコープからは一旦外し、個別スレッドインポートのみ対応**という判断が妥当かもしれない

### スコープ判断（確定）
**Phase1では個別スレッドの手動アップロードのみ対応。一括自動インポートは対象外。**

理由：Perplexityは他の3社（ChatGPT/Gemini/Claude＝壁打ち・実装・調査の相棒）とは役割が異なり、「ハルシネーション防波堤としての一次情報収集専用」という位置づけ。会話量・重要度の面でも他3社ほど一括インポートの必要性が高くない。

将来的な拡張余地：自分以外のユーザーが使う段階になり、一括対応の要望が出た場合に改めて検討する（＝Phase1の設計判断としてクローズしてよいが、恒久的な却下ではなく「保留」として記録する）。

---

## 6. 共通のインポートUXフロー（案）

```
1. ユーザーがZIP/JSONファイルをアップロード
2. Knowledge OS側でファイル形式を自動判定（4社のどれか？）
   - 判定できない/壊れている場合 → エラーメッセージ＋対処法を提示
3. 各社専用パーサーで共通データモデルに変換
4. 変換件数・失敗件数をサマリー表示（例：「128件中126件を正常にインポートしました。2件は形式エラーのためスキップされました」）
5. プロジェクトへの割り当て（インポート時 or 後から手動）
```

---

## 7. Phase1スコープに関する提案（要判断）

| 項目 | 提案 |
|---|---|
| ChatGPT | 公式`conversations.json`（ツリー構造）に対応 |
| Gemini | Google Takeout JSON形式のみ対応（HTML形式は「再エクスポートしてください」で弾く） |
| Claude | 公式`conversations.json`に対応（最も単純） |
| Perplexity | 個別スレッドの手動アップロードのみ（確定）。役割が他3社と異なる（一次情報検証用）ため一括対応の優先度は低い。将来ユーザー要望次第で再検討 |

Perplexityの扱いは確定。ChatGPT/Gemini/Claudeの一括自動インポート方針で進める。
