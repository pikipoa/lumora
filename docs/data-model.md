# データモデル仕様書（Phase 1）

Knowledge OS — AIチャット統合ナレッジアプリ

前提：`import-spec.md` で定義したConversation/Messageモデルを内包し、アプリ全体の構造に拡張する。

---

## 0. 設計思想

**「階層構造（置き場所）」と「タグ（切り口）」を分離する**

- 階層構造：プロジェクト → テーマ → 会話。会話が「物理的にどこに属するか」を1本に決める
- タグ：`#UI` `#世界観` `#闘着場` など。会話が「どんな意味を持つか」を複数付けられる
- 横断検索は主にタグで実現し、階層はナビゲーション（ブラウジング）用途に使う

この分離により、「闘着場というテーマ配下だが、UIタグも世界観タグも両方付いている」という状態を自然に表現できる。

---

## 1. エンティティ一覧

### Project（プロジェクト）
```
Project {
  id: uuid
  name: string            // 例："古着ダンジョン"
  description: string | null
  created_at: datetime
  updated_at: datetime
}
```

### Theme（テーマ）
```
Theme {
  id: uuid
  project_id: uuid          // 親Project（必須。Themeは単独では存在しない）
  name: string              // 例："闘着場"
  created_at: datetime
}
```

### Conversation（会話） ※import-specから継承・拡張
```
Conversation {
  id: uuid
  source: "chatgpt" | "gemini" | "claude" | "perplexity"
  source_conversation_id: string | null
  title: string
  project_id: uuid | null    // null = 未分類（Inbox）
  theme_id: uuid | null      // null = プロジェクトには属すがテーマ未割当
  created_at: datetime | null   // 元サービス側の作成日時
  updated_at: datetime | null
  model: string | null
  imported_at: datetime      // Knowledge OSへの取り込み日時
  raw_ref: string
}
```

### Message（メッセージ） ※import-specと同一
```
Message {
  id: uuid
  conversation_id: uuid
  role: "user" | "assistant"
  content: string
  content_format_lost: boolean
  created_at: datetime | null
  citations: string[] | null
}
```

### Tag（タグ）
```
Tag {
  id: uuid
  name: string              // 例："UI"（"#"は表示側で付与、DB上は付けない）
  created_at: datetime
}
```
**スコープ判断（デフォルト案）**：タグはプロジェクトを横断するグローバル存在とする。
理由：「#AI」「#ClaudeCode」のような複数プロジェクトで共通利用したいタグがある一方、プロジェクト固有のタグ（例：「#闘着場」）も同じ仕組みで扱える方がシンプル。プロジェクトスコープに縛ると、プロジェクトをまたいだ横断検索（当初の課題認識の核）ができなくなる。

### ConversationTag（会話とタグの中間テーブル）
**このプロダクトの思想的な核**：AI提案と人間確定を1レコード内で区別する
```
ConversationTag {
  id: uuid
  conversation_id: uuid
  tag_id: uuid
  status: "proposed" | "confirmed" | "rejected"
  proposed_by: "ai" | "human"
  confirmed_at: datetime | null
  created_at: datetime
}
```
- AIが提案した時点：`status: proposed, proposed_by: ai`
- 人間が承認：`status: confirmed`に更新、`confirmed_at`記録
- 人間が却下：`status: rejected`（削除ではなく記録を残す＝「なぜ却下したか」の履歴的価値。BASの「判断の反転履歴」思想と同じ）
- 人間が最初から追加：`proposed_by: human, status: confirmed`（提案フローを経ない）

### Marker（マーカー／重要箇所）
```
Marker {
  id: uuid
  conversation_id: uuid
  message_id: uuid          // どのメッセージ内か
  quoted_text: string       // マーカーを引いた原文の抜粋
  color: "pink" | "green" | "yellow" | "blue" | "red" | null
                             // confirmed時は必須。proposed（AI提案・未確定）時はnull許容
  status: "proposed" | "confirmed" | "rejected"   // AI抽出の重要箇所も「提案」として扱う
  proposed_by: "ai" | "human"
  created_at: datetime
}
```
Phase1機能「重要箇所抽出」はAIがMarkerを`proposed`状態で自動生成する機能（この時点では`color: null`）。
**色の選択＝確定操作そのもの**：人間が5色（蛍光ピンク/グリーン/イエロー/ブルー/レッド）のいずれかを選ぶ行為が、そのままマーカーを`confirmed`にする操作を兼ねる（詳細はux-flow-and-screens.md）。

### Memo（メモ）
```
Memo {
  id: uuid
  target_type: "conversation" | "marker"
  target_id: uuid           // conversation_id または marker_id
  body: string
  created_at: datetime
  updated_at: datetime
}
```
会話全体に対するメモと、マーカー箇所に対するメモの両方を1つのテーブルで表現（target_typeで分岐）。

### Summary（AI生成要約）
```
Summary {
  id: uuid
  conversation_id: uuid
  body: string
  status: "proposed" | "confirmed" | "edited"
  created_at: datetime
  updated_at: datetime
}
```
- `edited`：人間がAI生成文をベースに書き換えた状態（タグと同様、提案→確定の思想を要約にも適用）

---

## 2. リレーション図（テキスト表現）

```
Project 1 ── N Theme
Theme   1 ── N Conversation
Conversation 1 ── N Message
Conversation N ── N Tag  (via ConversationTag、status付き)
Conversation 1 ── N Marker
Conversation 1 ── N Summary   ※Phase1は基本1件運用を想定（再生成時は上書き or 履歴保持は要検討）
Marker  1 ── N Memo
Conversation 1 ── N Memo（target_type="conversation"の場合）
```

---

## 3. Phase1で判断が必要な点

### 論点A：Conversation ⇄ Theme は1:1か、N:Nか（決定）

**Themeは1:1のまま維持する。ただし「複数トピックが混ざる」問題と「別会話が後から繋がる」問題は、Themeではなく別の仕組みで吸収する。**

判断理由：ピキさんの実態は「半々くらい＋別チャットのトピックが巡り巡って繋がることがある」とのことだった。これは実は2つの異なる現象。

1. **1会話内で複数トピックが混ざる** → Theme自体をN:Nにすると「結局この会話はどこの棚にあるのか」が曖昧になり、ナビゲーションの価値が下がる。この揺れは**Tag（N:N、既に用意済み）で吸収する**。Themeは「主な置き場所」、Tagは「副次的にどんな話題も含んでいたか」の記録係にする。

2. **別々の会話が後から意味的に繋がる** → これはTheme/Tagのどちらの問題でもなく、そもそも今のモデルに存在しない**「会話と会話の関連性」という概念が必要**。これはPhase1のスコープでは実装せず、以下のように扱う：
   - Phase1：同じTagが付いた会話同士は自動的に横断検索で並ぶため、ある程度は自然に発見できる
   - Phase2以降のバックログ：`ConversationLink`（会話間の明示的なリンク、例：「この会話はあの会話の続き/派生」）を検討。今は速度優先で見送り、実際に横断検索だけでは足りないという実感が出たら着手する（ピキさんの「思弁は観測バックログに退避する」という方針と一致）

### 論点B：未分類（Inbox）の扱い（決定・現状維持）
`project_id: null` の会話＝インポートしたがまだ整理していない状態、として「受信箱」ビューを持たせる。

### 論点C：Summaryの再生成時の履歴（Phase1デフォルト）
Phase1は上書きのみとし、履歴テーブル化はしない。VISION.mdの「知識の変化追跡」機能は別途Phase2で本格設計する際にまとめて対応する（Summary単体で先走って履歴化しない）。
