# Mission Architecture（将来構想・Phase2 Beacon向け）

> **この文書を読むAI・開発者へ（最重要）**
>
> **MissionアーキテクチャはPhase2（Beacon）の構想です。現時点では実装対象ではありません。**
>
> この文書の目的は**設計を保存すること**であり、現在のMarker・検索・同期などの実装を
> Mission構造へリファクタリングすることではありません。
>
> Phase1では **Golden Tests / Spec Tests / Resolverの概念 / Traceの考え方** のみを
> 開発文化として採用します（詳細は`CLAUDE.md` 2-7）。Mission関連（Kernel / Mission /
> Mission Builder / Knowledge Lookup / Constitution(Runtime) / Mission Executor）は、
> 将来のKernel設計資料として保持してください。
>
> Beacon開発に着手する時点で、この文書を改めて読み直して再評価すること。
> それまでは現在のコードへ持ち込まないこと。

作成：2026-07-28。別セッションで整理された概念を、実装せずに記録したもの。

---

## 1. 中心的な考え方

**Missionは「実行そのもの」ではなく「実行の契約」である。**

Kernelは、人間の意図を、過去の経験（Golden Tests）と原則（Constitution）に照らし、
将来の実行担当が迷わず動けるMissionへ変換する中核エンジン、という位置づけになる。

---

## 2. 用語集（Draft v0.1）

### Kernel

Lumoraの中核変換エンジン。人間の自然言語による意図を、ConstitutionとGolden Testsに
照らして実行可能なMissionへ変換する。**Kernel自身は実行しない。**

責務：Intent解析／Mission生成／Constitution適用／Golden Testsとの整合確認／
実行担当への引き渡し。

### Intent

ユーザーが本当に達成したい目的。Kernelが最初に抽出する。

```
「Markerの色を変更したい」
  ↓
type:   MODIFY
target: MarkerColor
goal:   色を変更したい
```

### Intent Resolver

自然言語からIntentを抽出するコンポーネント。

### Mission

Intentを実行するための計画。「何をどういう順番で行うか」だけを書く。**まだ実行しない。**

### Mission Instance

Kernelが生成した具体的なMission。JSONなどの構造化データ。

### Mission Template

Missionを生成するための雛形（`modify.yml` / `search.yml` / `select.yml` など）。
Intentに応じて選ばれる。

### Constitution

Lumoraが絶対に守る原則。Missionは必ずConstitutionを通る。

> **Lumoraでの実体**：`docs/PRINCIPLES.md`（5原則）が既にこの役割を担っている。
> 新規にConstitutionを作ると二重管理になるため、育てるなら既存の方。

### Constitution Check

MissionがConstitution違反をしていないか検査する工程。

```
Markerだけ変更するはずが → UI全体を変更 → ✕ Article 1違反
```

### Golden Tests

実際に起きた出来事から作られた判例。Kernelが壊れていないかを保証する。

特徴：**実際の事件だけ／仮説は禁止／履歴を積み重ねる（書き換えない）。**

> 「不変」ではなく「歴史を書き換えない」。誤字修正・証拠への参照追加・スキーマ更新に伴う
> 機械的な移行は許容する。禁止するのは期待結果の書き換えと解釈の変更。期待する振る舞いが
> 変わったら、既存の判例を直すのではなく新しい判例を立てるか、元に`status: overruled`を
> 付けて覆す判例を並べる。運用ルールの詳細は`CLAUDE.md` 2-7。

### Guarantee

Golden Testが保証する外部仕様。実装ではなく「何を守るか」を定義する。

### Knowledge

判例から生まれた知識。後から成長していく（Occurrence Resolver、Tier探索、
Context Matching など）。

### Trace

判例と実装を結ぶ索引。`GT-0001 → commit → test → source file`。

### Reference Resolver

曖昧な参照を一意の対象へ解決する仕組み。「後ろ」「最後」「左」「3番目」「引用内」
「これ」などを唯一の対象へ変換する。

### Occurrence Resolver

Reference Resolverの一機能。同じ対象が複数ある場合に「最初」「後ろ」「2番目」「最後」
などを解決する。

### Mission Executor

Missionを実際に実行する担当。Kernelとは分離される。

> **命名についての注意**：元の用語集では「Butler」だったが、Lumoraでは
> `VISION.md` 9章の**執事**が別の意味で使われている（Beaconの人格・声。ユーザーが
> Familiar / Custos / Warden などから自分で名前をつけるもの）。同じ語が
> 「ユーザー向けの人格」と「内部の実行エンジン」を同時に指すと、DESIGN.md原則7
> （One New Word Per Unlock）・原則8（名詞は世界観、動詞は日常語）が崩れる。
> 内部コンポーネントは地味な語（Mission Executor / Runner 等）を使い、
> 世界観の語彙は外向き、アーキテクチャの語彙は内向き、と分ける。

### Spec Tests

まだ起きていない未来の仕様。Proposalの置き場所。**Golden Testにはならない。**

---

## 3. 5層アーキテクチャ

```
Constitution   （原則）
      ↓
Golden Tests   （判例・契約）
      ↓
Knowledge      （学説・知見）
      ↓
Trace          （歴史と実装の索引）
      ↓
Kernel         （Mission生成）
```

## 4. Missionパイプライン

```
ユーザー入力
   ↓
Intent Resolver
   ↓
Intent
   ↓
Mission Template
   ↓
Mission Instance
   ↓
Constitution Check
   ↓
Golden Testsとの整合
   ↓
Mission完成
   ↓
Mission Executor
   ↓
実行
```

---

## 5. Lumoraの現状との対応（2026-07-28時点）

| 用語集 | Lumoraでの実体 | 状態 |
|---|---|---|
| Constitution | `docs/PRINCIPLES.md`（5原則） | **実在**。役割が完全に一致 |
| Golden Tests | `src/lib/__tests__/markerLayout.test.ts` の回帰テスト群 | **実在**。実際の事件（`358 → 369 → 363`、「3つ目のGemini」）から作った判例 |
| Trace | `CHANGELOG.md` | **実在**。事件→コミット→ファイルを結ぶ索引 |
| Occurrence Resolver | `resolveMarkerPosition()`（`src/lib/markerLayout.ts`） | **実在**。offset → 文脈 → 最初の一致の3段階 |
| Knowledge | `rejected-decisions.md`＋CHANGELOGの「教訓」節 | 部分的に実在 |
| Kernel / Mission / Intent Resolver / Mission Template / Constitution Check | — | **未実装。Phase2で再評価** |

注目すべき点：**Occurrence Resolverは、この用語集が書かれる前にLumoraが実装を終えていた。**
概念が先にあって実装したのではなく、実装が先にあって概念が後から名前をつけた形になっている。
この順序は健全であり、他の用語についても同じ順序（必要になってから名前をつける）を維持する。

---

## 6. 採用の線引き（2026-07-28決定）

### いま採用する（開発文化として。`CLAUDE.md` 2-7 に記載）

- Golden Tests（実際の事件だけ・仮説は禁止・不変）
- Spec Tests（未来の仕様。Golden Testとは混ぜない）
- Reference Resolver / Occurrence Resolver（概念名として）
- Trace（事件と実装を結ぶ索引）

### 将来まで寝かせる（この文書に保持）

- Kernel
- Mission / Mission Builder / Mission Template / Mission Instance
- Intent / Intent Resolver
- Knowledge Lookup
- Constitution（Runtime。原則そのものは`PRINCIPLES.md`として既に存在する）
- Mission Executor（名称はButler以外）

---

## 7. Beacon着手時に再評価すること

- Reference Resolverの探索対象：確定済みArca限定か、生の会話全文まで広げるか
  （`VISION.md` 9章で「未決定事項」として保留中。2026-07-11の「生データを直接AIに
  読ませるとノイズが増える」という教訓と緊張関係にある）
- Constitution Checkを自動化する必要が本当にあるか（人間のレビューで足りないか）
- Mission TemplateをYAMLで持つ必要があるか（コードで足りないか）
