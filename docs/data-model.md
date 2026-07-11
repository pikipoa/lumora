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
  held_at: datetime | null   // 非null = 保留中（一覧から除外）。実装確定：下記参照
}
```

**保留機能（実装確定・2026-07-11、実データ一括インポート後のフィードバックに基づく）**：数百〜千件規模の一括インポートを行うと、雑談のような無価値な会話が未分類一覧に大量に混ざり見通しが悪くなることが判明した。`held_at`に日時が入っている間は通常の一覧（Inbox/プロジェクト内/テーマ内）から除外され、「保留一覧」からのみアクセスできる。rejected同様に物理削除しないのが基本方針だが、保留一覧からは明示的な2段階操作（保留一覧を開く→「完全に削除」を選ぶ）でのみ物理削除も可能にした（雑談の一括整理という実用ニーズと、CLAUDE.md 2-1の「判断履歴を残す」思想のバランスを取った設計）。

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

### Marker（マーカー／重要箇所）※知識の最小単位（2026-07-11の情報フロー転換により中心的存在に）
```
Marker {
  id: uuid
  conversation_id: uuid
  message_id: uuid          // どのメッセージ内か
  project_id: uuid | null   // 実装確定・2026-07-11：マーカーを直接Realmへ割り当てる手段
  quoted_text: string       // マーカーを引いた原文の抜粋
  color: "pink" | "green" | "yellow" | "blue" | "red" | null
                             // confirmed時は必須。proposed（AI提案・未確定）時はnull許容
  role_tag: "idea" | "hypothesis" | "decision" | "strategy" | "learning" | null
                             // Roleタグ（自分の知識内での役割）。固定enumのためTagテーブルとは別枠
  status: "proposed" | "confirmed" | "rejected"
  proposed_by: "ai" | "human"
  created_at: datetime
}
```
**情報フローの転換（決定・2026-07-11）**：AIによる「会話全体からのマーカー自動発見」は廃止した。マーカーは常に人間が横断検索→本文選択で手動作成する（`proposed_by: human`のみ。旧仕様の「AIがproposedで自動生成」は行わない）。詳細経緯：`VISION.md` 3-3、`C:\Users\user\.claude\plans\parsed-enchanting-dream.md`。
**色の選択＝確定操作そのもの**：人間が5色（蛍光ピンク/グリーン/イエロー/ブルー/レッド）のいずれかを選ぶ行為が、そのままマーカーを`confirmed`にする操作を兼ねる（詳細はux-flow-and-screens.md）。**マーカーがconfirmedになった時点＝Arcaに追加された状態**であり、Realm（`project_id`）への割り当ては別の任意操作。

**Wing（Theme相当）の実現方法（決定・2026-07-11）**：Wingは新テーブルを追加せず、**MarkerTagによる絞り込み表示として実現する**。あるRealm内のマーカーが持つタグそのものが「見た目上のWing」になる。`themes`テーブルは残すが、この用途では使わない（会話への割り当てというレガシーな使い方のみ残る）。

**範囲選択の実装方式（実装確定・2026-07-10、Step6技術スパイクの結論）**：ブラウザ標準のSelection/Range APIを使う。Web版は本文Textを`selectable`にして直接使用、ネイティブ版（iOS/Android）は同じロジックをWebView内JSとして動かしpostMessageで連携する設計（Web/ネイティブでロジックを共有できるのが採用理由。詳細はCLAUDE.md「実装前の必須スパイク」）。
`quoted_text`から本文中の位置（開始/終了オフセット）を求める際は`message.content.indexOf(quoted_text)`による最初の一致を採用する（同一文字列が複数回出現する場合の区別はPhase1では行わない、既知の制約）。
本文中のハイライトはproposed/confirmedの各マーカーを「区間マージ」でセグメント化して描画する設計にしており、将来Beacon等の追加ハイライトレイヤーが増えても同じ仕組み（`src/lib/markerLayout.ts`）で複数レイヤーを共存表示できる。
**範囲変更（実装確定）**：確定済み/提案中マーカーをタップすると、その時点の範囲がブラウザのネイティブ選択として復元され、そのまま左右にドラッグして伸縮できる（「本にマーカーを引く」体験の再現）。調整後に色をタップすると、その範囲で`quoted_text`を上書きして再確定する。

### MarkerHistory（マーカーの変遷履歴）
```
MarkerHistory {
  id: uuid
  marker_id: uuid
  color: "pink" | "green" | "yellow" | "blue" | "red" | null   // rejected記録時はnull
  status: "proposed" | "confirmed" | "rejected"
  changed_at: datetime
}
```
**設計意図（決定・2026-07-10、ピキさんの明示的な指示）**：Lumoraは「知識の変遷」自体に価値を置くため、マーカーの色・範囲・状態が変わるたびに追記専用で履歴行を残し、「2026:黄色→2027:赤→2028:却下」のような変化を後から追えるようにする。`markers`テーブル自体は履歴化せず（UPDATEのまま）、`MarkerHistory`を副次的な追記専用ログとして別途持つ。
**無駄な追記を避ける判定**：範囲・色・状態のいずれも変化していない場合（例：ドラッグ調整せずに同じ色を再タップしただけ）は履歴を残さない。ドラッグ中の中間状態やキャンセル操作も記録対象外（確定・却下の明示操作の時だけ、かつ実際に値が変わった時だけ記録する）。

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

### ~~Summary（AI生成要約）~~ → 廃止（決定・2026-07-11）

会話ごとのAI要約機能は、情報フローの転換（VISION.md 3-3）に伴い廃止した。`summaries`テーブルは物理削除済み（マイグレーション`20260711000003_marker_centric_pivot.sql`）。Realm/Arcaがマーカー中心になったため、会話全体の要約という単位は不要と判断した。

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
**実行方式（実装確定・2026-07-10）**：インポート時の自動実行はせず、人間が手動でボタンを押して実行する。理由：初回インポートは数百件規模になりうり、自動実行だと想定外のAPIコスト急増を招くため。

**~~このテーブルは2026-07-11の情報フロー転換後は使われなくなった~~**：AI処理の対象が「会話全体」から「人間が確定させたマーカー群」に変わったため（VISION.md 3-3）、新しいAI処理（Edge Function `organize-markers`）はこのテーブルを使わず、`aiService.ts`と同じ同期呼び出しパターンで完結する（対象マーカー数が人間の選んだ範囲に留まり小さいため、非同期ジョブ管理の必要性が薄れた）。テーブル自体は過去の実行ログとして削除せず残している。

---

## 2. リレーション図（テキスト表現）

```
Project 1 ── N Theme
Theme   1 ── N Conversation
Conversation 1 ── N Message
Conversation N ── N Tag  (via ConversationTag、status付き。tag_type: topic/conceptのみ)
Marker  N ── N Tag  (via MarkerTag、status付き。tag_type: topic/conceptのみ)
Conversation 1 ── N Marker
Project      1 ── N Marker  （2026-07-11追加。マーカーを直接Realmへ割り当てる）
Marker  1 ── N MarkerHistory
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

### 論点B：未分類（Inbox）の扱い（決定・2026-07-11更新）
`project_id: null` の会話＝インポートしたがまだ整理していない状態、として「受信箱」ビューは残す。ただし情報フロー転換（VISION.md 3-3）により、Inboxは「必ず処理すべき受信箱」ではなく「横断検索で見つからない時のフォールバック閲覧」という副次的な位置づけに変わった。

### ~~論点C：Summaryの再生成時の履歴~~ → 廃止（2026-07-11、Summary機能自体を廃止したため無効）

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

**全テーブル（`Project` / `Theme` / `Conversation` / `Message` / `Tag` / `ConversationTag` / `MarkerTag` / `Marker` / `MarkerHistory` / `Memo` / `ImportBatch`）が`user_id`列を直接持ち、RLSは全テーブル共通の「own rows only」で判定する。**（`Summary`は2026-07-11のマーカー中心アーキテクチャへの転換に伴いテーブル自体を廃止した）

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
