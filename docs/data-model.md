# データモデル仕様書（Phase 1）

Knowledge OS — AIチャット統合ナレッジアプリ

前提：`import-spec.md` で定義したConversation/Messageモデルを内包し、アプリ全体の構造に拡張する。

---

## 0. 設計思想

### 5つの知識オブジェクト（v2.1・決定・2026-07-12）

Lumoraのデータモデルは、UIや画面より先に、次の5つの知識オブジェクトの定義を正とする（v2.2提案「UIより先にデータ構造を定義する」の採用）。実装・画面設計・AIプロンプトのすべてがこの定義に従う：

| オブジェクト | 定義 | DB上の実体 |
|---|---|---|
| **Chronicle** | **文脈**。マーカーを含む会話。知識が生まれた背景を保持し、人間が過去を読み返すための層 | `conversations`（confirmedマーカーを1件以上持つもの） |
| **Arca** | **知識の最小単位**。＝マーカーそのもの。**ユーザーがマーカーを引いた瞬間にArcaが生成される**。AI分析はArcaを作る工程ではなく、Arcaへ意味（Wing/Tag）を付与する工程。UIの主役ではなく内部概念であり、画面に「Arca」という名を積極的に出さない | `markers`（status=confirmed） |
| **Realm** | **知識世界**。プロジェクトであり、知識編集の中心となる場所 | `projects` |
| **Wing** | **人間の理解構造**。知識を理解するための章立て。人間用の分類 | `themes`＋`marker_wings` |
| **Tag** | **AIの理解構造**。検索精度・推論・関連知識発見のためにAIが使う。常時表示はしないが、「AI分析結果を見る」でレビュー可能（ユーザーがやっているのはタグ編集ではなく「AIがこの知識を正しく理解できているかの確認」） | `tags`＋`marker_tags` |

知識フロー（人間の認知順序と一致させる）：

```
Import → Search → マーカー（＝Arca生成）→ Realm選択 → Realmへ収納
→ AI分析 → Wing候補（確度付き）→ ユーザー承認 → 収納 → Tag（内部）
```

### Arcaのライフサイクル（明文化・2026-07-23）

Arca（＝confirmedなMarker）は、生成から却下まで一貫して**追記専用・非破壊**で扱う（`PRINCIPLES.md`の柱）：

1. **生成**：横断検索で会話本文を選択し、5色から1つを選ぶ（色選択＝確定操作）。この瞬間`markers`にstatus='confirmed'で作成される。常に`proposed_by: human`（AIが自動生成することはない）。原文（`quoted_text`）はこの時点で固定され、以後不変
2. **編集**：`edited_text`でRealm内の表示用本文を自由編集できる。原文（`quoted_text`）は変わらず保持され、表示は`edited_text ?? quoted_text`。AIは常に元の一次情報を参照できる
3. **収納**：`project_id`でRealmへ任意に割り当てる（生成とは別の任意ステップ）
4. **意味付け**：`organize-markers`/`organize-wings`がTag/Wingをproposed状態で提案し、人間が確定/却下する（Arca自体の状態とは別レイヤー）
5. **変化の記録**：色・範囲・状態が変わるたびに`MarkerHistory`へ追記専用で記録する（無変化時は記録しない）
6. **却下**：人間が不要と判断した場合`status: 'rejected'`になる。**物理削除ではない**。一覧表示からは除外されるが、`MarkerHistory`とともにデータは残り続ける

いずれの段階でも、Chronicle（元の会話）・Message（元のメッセージ）への参照（`conversation_id`/`message_id`）は失われない＝常に根拠へ戻れる。

### Realm（知識の器）とView（出力）の責務分離（原則・2026-07-23）

**Realmはデータの置き場所であり、特定の画面・出力形式の都合でデータモデルを歪めない。** Realm/Arca/Wingという構造そのものと、それをどう見せるか（Realm詳細画面、横断検索結果、Chronicle一覧、将来のBeacon生成物等＝**View**）は別のレイヤーとして扱う。新しい画面や出力形式を追加する際は、まずViewの追加（既存データの新しい見せ方）で対応できないかを検討し、Realm側のデータモデルを変更するのは最後の手段とする。

（既存の実装にもこの分離は既に表れている：「RealmはTagを一切見せない」（CLAUDE.md）は、同じデータに対してRealmというViewがTagという要素を意図的に隠している例）

### 旧・設計思想（Phase1初期。階層とタグの分離）

**「階層構造（置き場所）」と「タグ（切り口）」を分離する**

- 階層構造：プロジェクト → テーマ → 会話。会話が「物理的にどこに属するか」を1本に決める
- タグ：`#UI` `#世界観` `#闘着場` など。会話が「どんな意味を持つか」を複数付けられる
- 横断検索は主にタグで実現し、階層はナビゲーション（ブラウジング）用途に使う

この分離の思想自体は5オブジェクト定義に引き継がれている（Wing=置き場所に相当する人間用の章、Tag=切り口に相当するAI用のラベル）。

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

### Theme（DB名。UI表示名は「Wing」）
```
Theme {
  id: uuid
  project_id: uuid          // 親Project/Realm（必須。単独では存在しない）
  name: string              // 例："技術スタック"
  icon: string | null       // Wingを象徴する絵文字1文字（2026-07-11追加）
  created_at: datetime
}
```

**Tag/Wingの役割分離（決定・2026-07-11）**：`VISION.md`の元々のブランド対応「Theme→Wing」に戻す形で、`themes`テーブルの意味を「会話が属するテーマ」から「Marker/Realmの人間向け章立て」へ転換した（Pivot-4時代の「WingはMarkerTagで代替」という節約実装は廃止）。
- **Tag**＝AIが検索・分類のために使う内部メタデータ。ユーザーが意識しなくてよい（Googleフォトの「犬」「猫」タグと同じ位置づけ）
- **Wing**＝人間が読むための「本の目次・章立て」。TagをAIがクラスタリングした結果として生成される、より粗い単位
- **RealmはTagを一切見せない**（生のTag名を出すのはArca側のみ）。Realm詳細ではWingのname/icon/件数だけを見せる
- Marker↔Wingは多対多（下記MarkerWing参照）。1つのMarkerが複数のWingに所属できる（「勉強ノートの『詳しくは第7章』」と同じ、参照であって複製ではない。Wingが増えてもMarker本文（`quoted_text`）は複製しない）

### Conversation（会話） ※import-specから継承・拡張
```
Conversation {
  id: uuid
  user_id: uuid              // 所有者（Inbox状態でもproject_id経由せず判定できるよう直接保持）
  source: "chatgpt" | "gemini" | "claude" | "perplexity" | "document" | "claude_code"
  source_conversation_id: string | null
  title: string
  project_id: uuid | null    // null = 未分類（Inbox）
  created_at: datetime | null   // 元サービス側の作成日時
  updated_at: datetime | null
  model: string | null
  imported_at: datetime      // Knowledge OSへの取り込み日時
  import_source_filename: string | null   // 例："conversations.json"（デバッグ・サマリー表示用、内容は保持しない）
  import_batch_id: uuid      // 同一インポート操作をグルーピングするID
  held_at: datetime | null   // 非null = 保留中（一覧から除外）。実装確定：下記参照
}
```

**`source: "document"`の追加（決定・2026-07-14）**：`.md`/`.txt`ファイルはPerplexityパーサー（`src/import/parsers/perplexity.ts`）へ渡すが、実際にPerplexityのシグネチャ（ロゴ画像URLまたは脚注形式の引用マーカー`[^N_M]`）が見つかった場合のみ`source: "perplexity"`とし、見つからなければ汎用のMarkdown/テキスト文書（メモ・ドキュメント等）として`source: "document"`で取り込む。検索（`search-spec.md`「2章 一次情報」原則）は`conversations.title`/`messages.content`を見るだけなので、この変更だけで既存の横断検索がそのまま対象に含める。（判定方法は当初`## 見出し`の有無としていたが、2026-07-22の実データ検証により`##`はAIの回答内の小見出しであり判定材料にならないことが判明したため訂正した。詳細：`import-spec.md`§5「実データ検証で確定した実際のスキーマ」）

**`source: "claude_code"`の追加（決定・2026-07-21）**：ユーザー自身のClaude Code CLIセッション記録（`.jsonl`、1行1イベント）を取り込めるようにした。実データ検証により、`type:"user"`（content文字列のみ、tool_result等の配列は除外）と`type:"assistant"`の`text`ブロック（thinking/tool_useは除外）だけを会話として復元し、`type:"ai-title"`の値をタイトルに採用する（パーサー：`src/import/parsers/claudeCode.ts`）。他のエージェントAIツール（Codex CLI等）についても同じJSONL構造を持つか調査したが、この環境ではCodex CLIのローカルファイルはアプリ状態のみでセッション記録ではなく、Cursor/Cline/Aider等はこの環境に存在しないため検証できておらず、Phase1では対応していない。

**`theme_id`列の削除（決定・2026-07-11）**：旧Theme（会話が属するテーマ）を指していた列だったが、Pivot-3/4以降どのコードからも書き込まれなくなっていた（会話単位のテーマ割当UIは廃止済み）。`themes`テーブルの意味をWing（Marker/Realmの章立て）へ転換したため、意味が矛盾する古いFKとして削除した。

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

### MarkerWing（発見物とWingの中間テーブル、2026-07-11新設）
```
MarkerWing {
  id: uuid
  marker_id: uuid
  wing_id: uuid              // themes.id（UI表示名はWing）
  status: "proposed" | "confirmed" | "rejected"
  proposed_by: "ai" | "human"
  confidence: number | null  // v2.1追加：AI候補の確度（0〜100）。UI表示は◎（90以上）/○。
                             // 将来の学習型自動収納（95%以上のみ自動、「元に戻す」付き）の土台
  confirmed_at: datetime | null
  created_at: datetime
}
```
**Wing候補の承認フロー（v2.1・2026-07-12）**：AI分析はWing候補を確度付きで提示するだけで、収納の決定は常にユーザー。「採用（＝confirmed）／既存Wingを選択／新しいWingを作成」の3択。学習型の自動収納は将来の最終形としてVISION.mdバックログへ。
`marker_tags`と全く同じ状態機械（proposed→confirmed/rejected、CLAUDE.md 2-1）を踏襲する。1つのMarkerが複数のWingに`confirmed`で所属できる（`unique(marker_id, wing_id)`のみ制約、上限は無いがEdge Function `organize-wings`のプロンプトで1〜2個・多くとも3個程度に留めるよう指示している）。人間がArcaから手動で追加する場合は`proposed_by: human, status: confirmed`（提案フローを経ない、MarkerTagの手動追加と同じパターン）。

### Marker（マーカー／重要箇所）※知識の最小単位（2026-07-11の情報フロー転換により中心的存在に）
```
Marker {
  id: uuid
  conversation_id: uuid
  message_id: uuid          // どのメッセージ内か
  project_id: uuid | null   // 実装確定・2026-07-11：マーカーを直接Realmへ割り当てる手段
  quoted_text: string       // マーカーを引いた原文の抜粋。Chronicle原文として不変（v2.1）
  edited_text: string | null // v2.1追加：Realm内で自由編集できる表示用本文（文章修正・要約・補足）。
                             // 表示はedited_text ?? quoted_text。原文が不変なのでAIは元知識を参照し続けられる
  color: "pink" | "green" | "yellow" | "blue" | "red" | null
                             // confirmed時は必須。proposed（AI提案・未確定）時はnull許容
  role_tag: "idea" | "hypothesis" | "decision" | "strategy" | "learning" | null
                             // Roleタグ（自分の知識内での役割）。固定enumのためTagテーブルとは別枠
  status: "proposed" | "confirmed" | "rejected"
  proposed_by: "ai" | "human"
  created_at: datetime
}
```
**Arcaとの関係（v2.1・2026-07-12）**：confirmedのMarker＝Arca（知識の最小単位）。**マーカーを引いた瞬間にArcaが生成される**のであって、AI分析がArcaを作るのではない（AI分析はWing/Tagという意味を付与する後工程）。Realm選択はマーカー作成直後にスキップ可能で、未割当（project_id null）のArcaはChronicle一覧の先頭「整理待ち」セクションに現れ、最後の1件が割当された瞬間にセクションごと消える。
**情報フローの転換（決定・2026-07-11）**：AIによる「会話全体からのマーカー自動発見」は廃止した。マーカーは常に人間が横断検索→本文選択で手動作成する（`proposed_by: human`のみ。旧仕様の「AIがproposedで自動生成」は行わない）。詳細経緯：`VISION.md` 3-3、`C:\Users\user\.claude\plans\parsed-enchanting-dream.md`。
**色の選択＝確定操作そのもの**：人間が5色（蛍光ピンク/グリーン/イエロー/ブルー/レッド）のいずれかを選ぶ行為が、そのままマーカーを`confirmed`にする操作を兼ねる（詳細はux-flow-and-screens.md）。**マーカーがconfirmedになった時点＝Arcaに追加された状態**であり、Realm（`project_id`）への割り当ては別の任意操作。

**Wingへの割当（決定・2026-07-11、詳細は上記Theme節参照）**：MarkerとWingは`MarkerWing`（下記）を介した多対多。ArcaでのRealm割当直後にはWingは未設定で、Realm詳細の「Knowledge Organize」を実行して初めてAIがWingを提案する（空のRealmには提案しない。データが無い状態でAIが章立てを当てずっぽうで提案しても精度が低いため）。

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

### MarkerColorMeaning（マーカー色の意味登録、構想・2026-07-13）
```
MarkerColorMeaning {
  id: uuid
  user_id: uuid
  color: "pink" | "green" | "yellow" | "blue" | "red"
  label: string              // 例："根拠"。初期プリセットあり、ユーザーが変更可能
  description: string | null // 任意の補足説明
  updated_at: datetime
}
// unique(user_id, color)：1ユーザーにつき色ごとに1件
```
**設計意図（VISION.md「1-1. Core Vision」参照。最も守るべき前提）**：この機能は**「AIのための機能」ではなく「ユーザー自身の思考ルールを言語化・表現する機能」**である（マーカーの色に「何を意味させるか」は人間が決めるもの、というVISION.md 3-4の原則をさらに一歩進め、無意識の運用ルールを本人が自覚し言葉にして残すことが第一の目的）。AIと意味を共有できることは副次的な結果に過ぎず、Phase2のBeacon提案時の手がかりになりうる、という話は「作る理由」ではなく「後から生まれる利点」として扱う。**任意**登録（未設定でも従来通り色だけで運用できる）。初期プリセット（🟨根拠／🟦仕様／🟩設定／🩷アイデア／🟥注意点）は`settings-ia.md`「4-1」参照。

**Phase1のスコープ**：登録UIとデータ保存のみ。`organize-markers`/`organize-wings`のAIプロンプトへ実際に渡すのはPhase2（Beacon設計時）に回す（今回明示的に確認済み）。このため現時点ではEdge Functionへの変更は発生しない。

**旧決定の訂正（2026-07-13）**：VISION.md 5-3では「タグ/マーカー色の凡例（レジェンド）機能」を明示的にPhase1 Non-goalとしていたが、上記の新しい理由付けによりPhase1スコープへ格上げした（訂正の経緯はVISION.md「1-1」に記録）。

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

### UnlockFlag（進化するホーム画面の解放演出・既読フラグ）
```
UnlockFlag {
  user_id: uuid   // primary key
  arca_chronicle: boolean   // Chronicle解放演出を見たか
  realm: boolean             // Realm解放演出を見たか
  updated_at: datetime
}
```
**不具合修正（決定・2026-07-13）**：元はAsyncStorage（Web版はlocalStorage、端末/オリジン単位）に保存していたが、これはアカウント単位で永続すべき状態を端末単位の一時的な保存先に置いていた設計ミスだった。ログアウト→再ログイン（別ブラウザ・別デバイス・localStorage消去等）のたびに既読フラグだけが消え、Realm等の解放演出が毎回再表示される不具合の原因になっていたため、`unlock_flags`テーブル（マイグレーション`20260713000001_unlock_flags.sql`）へ移した。

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
Project 1 ── N Theme  （UI表示名Wing。2026-07-11：ConversationではなくMarkerを束ねる用途に転換）
Conversation 1 ── N Message
Conversation N ── N Tag  (via ConversationTag、status付き。tag_type: topic/conceptのみ)
Marker  N ── N Tag  (via MarkerTag、status付き。tag_type: topic/conceptのみ)
Marker  N ── N Theme  (via MarkerWing、status付き。2026-07-11新設。Wing=人間向け章、Tag=AI内部用)
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

**全テーブル（`Project` / `Theme` / `Conversation` / `Message` / `Tag` / `ConversationTag` / `MarkerTag` / `MarkerWing` / `Marker` / `MarkerHistory` / `Memo` / `ImportBatch`）が`user_id`列を直接持ち、RLSは全テーブル共通の「own rows only」で判定する。**（`Summary`は2026-07-11のマーカー中心アーキテクチャへの転換に伴いテーブル自体を廃止した）

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
