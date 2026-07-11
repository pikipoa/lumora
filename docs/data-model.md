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
  user_id: uuid             // 所有者（auth.usersへの外部キー）
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
  user_id: uuid              // 所有者（Inbox状態でもproject_id経由せず判定できるよう直接保持）
  source: "chatgpt" | "gemini" | "claude" | "perplexity"
  source_conversation_id: string | null
  title: string
  project_id: uuid | null    // null = 未分類（Inbox）
  theme_id: uuid | null      // null = プロジェクトには属すがテーマ未割当
  created_at: datetime | null   // 元サービス側の作成日時
  updated_at: datetime | null
  model: string | null
  imported_at: datetime      // Knowledge OSへの取り込み日時
  import_source_filename: string | null   // 例："conversations.json"（デバッグ・サマリー表示用、内容は保持しない）
  import_batch_id: uuid      // 同一インポート操作をグルーピングするID
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
  user_id: uuid             // 所有者（auth.usersへの外部キー）
  tag_type: "topic" | "concept"   // Topic(何について)/Concept(何の概念か)。Roleは別枠(Marker.role_tag参照)
  name: string              // 例："UI"（"#"は表示側で付与、DB上は付けない）
  created_at: datetime
}
```
**スコープ判断（訂正）**：タグは「そのユーザーの全プロジェクトを横断するグローバル」であり、**他ユーザーとは共有しない**。
理由：「#AI」「#ClaudeCode」のような複数プロジェクトで共通利用したいタグがある一方、プロジェクト固有のタグ（例：「#闘着場」）も同じ仕組みで扱える方がシンプル。プロジェクトスコープに縛ると、プロジェクトをまたいだ横断検索（当初の課題認識の核）ができなくなる。
※以前の版では「グローバル」とだけ記載していたが、マルチユーザー対応の検討により「ユーザー単位でグローバル」と明確化した。他ユーザーのタグ候補が既存タグマッチングに混ざることはない。

**タグの3分類（決定）**：
- **Topic**（何について）：例 `#ゲーム` `#AI` `#教育`。素直な話題分類
- **Concept**（何の概念か）：例 `#社会変化` `#パラダイムシフト`。BAS的な抽象化ラベル。AIの強みが最も出る分類軸
- **Role**（自分の知識内での役割）：例 `idea/hypothesis/decision/strategy/learning`。この3つ目は語彙が自由に増えるTopic/Conceptとは性質が異なり（固定の小さな選択肢）、Tagテーブルではなく`Marker.role_tag`という専用enumフィールドとして実装する（下記Marker参照）

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

### MarkerTag（発見物とタグの中間テーブル）
```
MarkerTag {
  id: uuid
  marker_id: uuid
  tag_id: uuid              // tag_type: topic/conceptのみ（roleはMarker.role_tagで扱う）
  status: "proposed" | "confirmed" | "rejected"
  proposed_by: "ai" | "human"
  confirmed_at: datetime | null
  created_at: datetime
}
```
**ConversationTagとの役割分担（決定）**：両方残す。
- `ConversationTag`：会話（Chronicle）全体への大まかなTopic/Conceptタグ。「この会話は何についてか」を横断検索できるようにする
- `MarkerTag`：個々の発見物（Marker）単位への正確なTopic/Conceptタグ。1つの会話の中でトピックが混ざっていても、発見物ごとに正確なタグが付けられる（論点Aで「Themeの1:1固定を、タグで吸収する」と決めた話が、会話単位よりさらに正確に実現される）
- 状態遷移の考え方（proposed→confirmed/rejected）はConversationTagと共通

### Marker（マーカー／重要箇所）
```
Marker {
  id: uuid
  conversation_id: uuid
  message_id: uuid          // どのメッセージ内か
  quoted_text: string       // マーカーを引いた原文の抜粋
  color: "pink" | "green" | "yellow" | "blue" | "red" | null
                             // confirmed時は必須。proposed（AI提案・未確定）時はnull許容
  role_tag: "idea" | "hypothesis" | "decision" | "strategy" | "learning" | null
                             // Roleタグ（自分の知識内での役割）。固定enumのためTagテーブルとは別枠
  status: "proposed" | "confirmed" | "rejected"   // AI抽出の重要箇所も「提案」として扱う
  proposed_by: "ai" | "human"
  created_at: datetime
}
```
Phase1機能「重要箇所抽出」はAIがMarkerを`proposed`状態で自動生成する機能（この時点では`color: null`, `role_tag`はAIが推定して提案可）。
**色の選択＝確定操作そのもの**：人間が5色（蛍光ピンク/グリーン/イエロー/ブルー/レッド）のいずれかを選ぶ行為が、そのままマーカーを`confirmed`にする操作を兼ねる（詳細はux-flow-and-screens.md）。

**範囲選択の実装方式（実装確定・2026-07-10、Step6技術スパイクの結論）**：ブラウザ標準のSelection/Range APIを使う。Web版は本文Textを`selectable`にして直接使用、ネイティブ版（iOS/Android）は同じロジックをWebView内JSとして動かしpostMessageで連携する設計（Web/ネイティブでロジックを共有できるのが採用理由。詳細はCLAUDE.md「実装前の必須スパイク」）。
`quoted_text`から本文中の位置（開始/終了オフセット）を求める際は`message.content.indexOf(quoted_text)`による最初の一致を採用する（同一文字列が複数回出現する場合の区別はPhase1では行わない、既知の制約）。
本文中のハイライトはproposed/confirmedの各マーカーを「区間マージ」でセグメント化して描画する設計にしており、将来Beacon等の追加ハイライトレイヤーが増えても同じ仕組み（`src/lib/markerLayout.ts`）で複数レイヤーを共存表示できる。

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
- **再実行時の挙動（実装確定・2026-07-10）**：既存のSummaryがある会話で再度AI分析を実行した場合、既存行のbodyを上書きし`status`を`proposed`に戻す（履歴は残さない。論点Cの「上書きのみ」方針通り）

### AiJob（AI分析ジョブ）
```
AiJob {
  id: uuid
  user_id: uuid
  conversation_id: uuid
  status: "queued" | "running" | "done" | "error"
  error: string | null
  result_summary: jsonb | null   // 生成件数・破棄件数・トークン使用量などの実行結果
  created_at: datetime
  started_at: datetime | null
  finished_at: datetime | null
}
```
**実行方式（実装確定・2026-07-10）**：インポート時の自動実行はせず、会話一覧（Inbox）画面から会話ごとに人間が手動でボタンを押して実行する。
理由：初回インポートは数百件規模になりうり、自動実行だと想定外のAPIコスト急増を招くため。まず手動選択式で開始し、コスト実測後にPhase2で自動化の要否を判断する。

**マーカー抽出時の検証（実装確定）**：AIが提案する`quoted_text`は元メッセージ本文からの完全一致部分文字列でなければならない。一致しない提案は幻覚（hallucination）とみなし、DBに保存せず破棄する（件数のみ`AiJob.result_summary`に記録）。

---

## 2. リレーション図（テキスト表現）

```
Project 1 ── N Theme
Theme   1 ── N Conversation
Conversation 1 ── N Message
Conversation N ── N Tag  (via ConversationTag、status付き。tag_type: topic/conceptのみ)
Marker  N ── N Tag  (via MarkerTag、status付き。tag_type: topic/conceptのみ)
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

### 論点F：タグの3分類とMarkerTagの新設（決定）
「Lumoraのタグ体系」検討により、以下が確定：
- タグはTopic（何について）/Concept（何の概念か）の2種類に分かれる（`Tag.tag_type`）
- Role（idea/hypothesis/decision/strategy/learning）は自由語彙ではなく固定小選択肢のため、Tagとは別に`Marker.role_tag`として実装
- タグの主戦場は会話単位ではなく発見物（Marker）単位。理由：会話のタイトルと内容が途中で変容するケースが多く、会話全体への一括タグ付けでは不正確になるため。`MarkerTag`を新設し、`ConversationTag`（会話全体への大まかなタグ）と併存させる

---

## 4. 認証とマルチユーザー対応（決定：最初から入れる）

**結論：user_idとRLS（行レベルセキュリティ）は、Phase1の実装当初から組み込む。** Phase1の実利用者がピキさん1人だけであっても、後からの追加ではなく最初から設計に含める。

### 理由
- VISION.mdで「将来的にApp Store/Google Playでの販売も視野に入れる」と明記されている以上、マルチユーザー化は「起きるかもしれない話」ではなく「計画済みの話」である
- user_id列やRLSポリシーを後から追加するのは、既存データへのバックフィル・全クエリの見直しを伴う根幹的な変更であり、コストが非常に高い
- Supabaseはauth機能とRLSがネイティブに統合されているため、最初から入れておく追加コストはごく小さい（テーブルに列を1つ足し、ポリシーを数本書くだけ）

### user_idの持たせ方（実装確定：全テーブルに直接付与）

**全テーブル（`Project` / `Theme` / `Conversation` / `Message` / `Tag` / `ConversationTag` / `MarkerTag` / `Marker` / `Memo` / `Summary` / `ImportBatch`）が`user_id`列を直接持ち、RLSは全テーブル共通の「own rows only」で判定する。**

```sql
-- 全テーブル共通（実装済みマイグレーション準拠）
CREATE POLICY "own rows" ON <table>
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
```

※検討過程では「子テーブルは親をJOINで辿って判定する」案もあったが、実装時（2026-07-10のセッション）に以下の理由で全テーブル直接付与に確定した：
- RLSポリシーが全テーブルで同一形になり、テーブル追加時の判断（直接持つか親を辿るか）が不要になる
- JOINベースのRLSは行ごとにサブクエリ評価が走り、メッセージ数が多い本アプリではむしろ不利
- `user_id`は`default auth.uid()`で自動設定されるため、アプリ側の書き込みコードに負担がない

### 未分類（Inbox）会話の所有者判定について
`Conversation.project_id: null`（Inbox状態）の会話は、Projectを経由した所有者判定ができない。このため、Conversationには`user_id`を直接持たせている（上記エンティティ定義済み）。ConversationのRLSは「project_id経由」ではなく「user_id直接」で判定する（Inboxかどうかに関わらず一貫した判定になる）。
