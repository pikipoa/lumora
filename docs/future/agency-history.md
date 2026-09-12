# Agency History — Checkpoint（2026-09-12）

> **この文書は `docs/future/` の隔離下にある。** Phase2以降の構想であり、現時点の実装対象ではない。
> **この文書を根拠に現行コードをリファクタリングしないこと。** 語彙（Agency History / Agency Marker /
> Agency Event）はこの文書の外へ出さない——コード・スキーマ・UI・文言に持ち込まない
> （`EVIDENCE-OS.md` 付録B「まだ作っていないものには名前を付けない」）。
>
> 先例：`docs/future/mission-architecture.md`（Phase2 Beacon構想）と同じ扱い。

Phase1の設計監査（2026-09-12）を経て、人間側が確定させたCheckpoint。
Phase2着手時は、ここから **「Agency Historyを保存する最小イベントモデルは何か」** を最初の問いにする。

---

## FROZEN（確定。Phase2着手まで再検討しない）

1. **Phase1のscopeは変更しない。** Agency Historyのためのproduction変更も行わない。
   `markers.role_tag` はPhase1では運用を開始しない（現在NULL固定）。

2. **記録の対象はAI内部の `thinking` ではなく、人間とAIの認知分業の境界である。**
   AI内部推論の保存はAgency Historyの成立条件ではない。

3. **`proposed_by` はAgencyの証拠ではない。「操作した人」と「考えた人」を区別する。**

4. **`marker_history` はAgency Historyそのものではない。** 将来利用できる入力源の一つとして扱う。

5. **人間自身の明示的行為を最も強いAgency evidenceとする。**
   AIによるAgency推定を利用するとしても、Canonicalな事実とは区別する。

---

## PROPOSED（方向性のみ。仕様は未確定）

- Phase2で独立した **Agency Event** 概念を検討する
- Knowledge Marker と Agency Marker の関係を設計する
- 各階層のネイティブチャットから Agency Event を直接生成できる構造を検討する
- Beacon は Agency History を観測し、人間自身では見えにくい長期変化を返す

---

## OPEN（未決。Phase2の設計対象）

- Agency Marker の具体的語彙
- 既存5色との関係
- Agency Event のスキーマ
- Markerを伴わないAgency記録の方法
- Beaconの指標
- legacy import からどこまでAgencyを復元するか

---

## 監査メモ（実装事実。再発見のコストが高いもの）

2026-09-12の監査で実コードから確認した事実。**推測ではなく、いずれも該当箇所を読んで確かめている。**
Phase2でAgency Historyを設計する際、ここを読まずに始めると同じ調査を繰り返すことになる。

### 1. `markers.proposed_by` は現状 `'human'` 固定で、Agency指標には使えない

書き込み箇所は3つ（`conversation-marker-workspace.tsx` / `projects/[id].tsx` ×2）で、**すべて `'human'`**。
2026-07-11の「マーカー中心アーキテクチャへの転換」でAIがMarkerを提案しなくなったため、値が変動しない。
**定数の情報量はゼロ**であり、`project_id × proposed_by × marker_history` のような集計から
「人間の判断量」を出すことは原理的にできない。

`proposed_by` が実際に `'ai'` を取るのは `marker_tags` と `marker_wings` の2つだけ
（`organize-markers` / `organize-wings` が書く）。

### 2. 「操作した人」と「考えた人」は別

`proposed_by: 'human'` が意味するのは「人間がMarkerを作った」＝**操作の主体**だけで、
**引用された文字列の出自ではない**。Lumoraの用途上、引用されるのは多くの場合AIの発話であり、
人間が作ったMarkerの大半は「AIが生成した内容を人間が価値ありと判断した」記録になる。
「人間が仮説を生成した」記録ではない。

### 3. `markers.message_id → messages.role` が、現存する唯一のAgency信号

`markers.message_id` は NOT NULL で `messages` への外部キーを持つ。
`messages.role`（`'user' | 'assistant'`）を辿れば、
**人間自身の発話に引いたMarker**と**AIの発話に引いたMarker**を区別できる。
Marker層に今ある唯一のAgency信号だが、**現在どのコードもこれを読んでいない**。

### 4. `edited_text` は人間介入の強い観測信号

`markers.edited_text`（`20260712000001_v21_cognitive_os.sql`）は、引用をそのまま採らず
人間が書き換えた場合にのみ値が入る。したがって `edited_text is not null` は
**「人間が引用に介入した」という純度の高い信号**であり、`proposed_by` より遥かに情報量がある。

### 5. import後の `seq` は、破棄されたターンの欠落を示さない

`seq` は `importService.ts` で `conv.messages.map((m, seq) => …)` と、
**パーサーが残したメッセージへの連番**として振られる。
パーサーは `system` / `tool` ロール、`thinking` / `tool_use` / `tool_result` ブロック、
および「textブロックが無いターン」を取り込まない。
結果として**落としたターンは穴も痕跡も残さず**、記録は連続した human→AI の往復として読める。

境界そのものは壊れないが、**AIが担当した量は構造的に過小評価される**。
そして取り込み済みデータでは、**この欠落を検出する手段がない**。
原本ZIPは端末ローカルにのみキャッシュされ、クラウドには無い。

### 6. AI提案の「拒否」と「修正」が、現在どちらも `rejected` になり区別できない

Tag名のリネームは、旧行を `status:'rejected'` にして新行を作る実装（`projects/[id].tsx`）。
「AI提案を拒否した」と「AI提案を修正した」が同じ値で表現されるため、**後から区別できない**。
Agencyの観点では別の認知行為であり、現在は情報が失われている。

### 7. `marker_history` はAgency Historyそのものではない（FROZEN 4の根拠）

構造上、そのままでは拡張できない。

- **`marker_id` が NOT NULL** — Markerを伴わない仮説・判断・委任を置けない
- **`on delete cascade`** — Markerが物理削除されると履歴も消える。
  Agency台帳は対象物より長生きする必要がある
  （現在は `status:'rejected'` の論理削除のため実害は出ていないが、構造としては脆い）
- 列が `(color, status)` — **知識オブジェクトの状態**であって、行為ではない

実際に書かれているのは3経路（作成 / 色変更 / 却下）。
**Realmへの収納は履歴に残らない**（`markers.project_id` を直接UPDATEしている）。
既存の3イベントは、将来 Agency Event へ写せる素材になる。

### 8. 自動検出はEvidence OSと衝突する（思想上の制約）

「AIへ判断や探索を委任した」は、人間のターンの**文面**にしか手がかりがない。
構造化された記録はどこにもない。将来の選択肢は
**(a) 人間が明示的に印を付ける** か **(b) AIが本文を読んで推定する** の2つだが、
**(b)は2026-07-11の転換（「発見するAI」を捨て、人間がマーカーを引いた後にだけAIが整理する）と
正面から衝突する。** 仕様以前の思想判断であり、Phase2の最初に決める必要がある。
FROZEN 5 はこの点を先に処理したものである。
