# Evidence OS

**人間の思考を、時間を越えて育てる知識基盤**

> **この文書を読むAI・開発者へ（最重要）**
>
> **これは機能仕様ではない。設計思想である。**
>
> Evidence OSはLumoraの機能ではない。Lumoraというプロダクトの**判断基準そのもの**である。
>
> この文書を根拠に、現在のコードをリファクタリングしてはならない。ここに書かれた概念の
> うち実装されているのは Marker / Realm / Wing / Chronicle（会話）だけであり、
> Compass・Evidence Map・Evidence Viewは**Phase2以降の設計対象**である。
> Phase1のスコープ（ローンチ 2026-10-01・Web版のみ）は、この文書によって変わらない。
>
> この文書が使われるのは、**新しい機能を追加するとき／新しいAIを導入するとき**に、
> それが7つの憲法に反していないかを判定する場面に限られる。

作成：2026-07-28。

---

## 0. この文書の位置

```
EVIDENCE-OS.md        なぜ作るか（思想・判断基準）
      ↓
VISION.md             何を作るか（プロダクト哲学・スコープ）
      ↓
PRINCIPLES.md         どう判断するか（設計原則5箇条）
      ↓
DESIGN.md / data-model.md / ...   どう作るか
```

Lumoraでは、新しい機能を追加するときも、新しいAIを導入するときも、
まず一つの問いを立てる。

**「これは人間の思考を守るか。それとも奪うか。」**

この問いに対する答えが、Lumoraのすべての設計を決定する。

---

## 1. 定義

Evidence OSとは、あらゆる場所で生まれた思考を「証拠（Evidence）」として蓄積し、
AIがその証拠だけをもとに整理・発見・再構築することで、
人間の思考の連続性を守るための知識基盤である。

AIは知識を作る存在ではない。

AIは、

- 記憶を探す
- 文脈を整理する
- 根拠を示す
- 矛盾を発見する
- 空白を見つける

編集者である。

意味を決めるのは最後まで人間である。

---

## 2. Evidence OSが解決する問題

現代では思考が様々な場所へ散らばる。

```
ChatGPT / Claude / Gemini / Notebook
YouTube / 論文 / ニュース
X / Threads / Web
音声メモ / 写真 / 日記
```

思考は存在している。
しかし、繋がっていない。

Evidence OSは、**情報を集めるOSではない。思考を再び一つへ繋ぐOSである。**

---

## 3. 最小単位 — Marker

Markerとは、Arca、つまり**思考の最小単位**である。

情報ではない。知識でもない。

「一つの考え」「一つの気付き」「一つの証拠」である。

入力元は問わない。AIでも、本でも、YouTubeでも、会話でも、散歩中の着想でも、
すべて同じMarkerになる。

---

## 4. Knowledge Pipeline

Evidence OSでは知識は次のように成熟する。

```
Import
   ↓
Marker
   ↓
Realm
   ↓
Wing
   ↓
Chronicle
   ↓
AI
```

**AIは最後にいる。入口ではない。出口である。**

---

## 5. AIの役割

AIは作家ではない。編集者である。

AIは 要約する／関連付ける／比較する／時系列を再構築する／根拠を示す ことはできる。
しかし**意味を決めることはできない。**

---

## 6. Evidence First

Evidence OS最大の原則。

```
質問
 ↓
Evidence検索
 ↓
Evidence整理
 ↓
回答
```

**AIは最初に答えない。最初に記憶を探す。**

---

## 7. Compass

Evidenceが足りないとき、AIは嘘をつかない。代わりに：

```
Evidence不足
 ↓
Compass
 ↓
問いを返す
```

「ここにはまだ証拠がありません。」と静かに知らせる。

**答えは作らない。新しいMarkerを生む。**

---

## 8. Beacon と Compass

**Beaconは、存在する証拠同士の新しい繋がりを発見する。**
**Compassは、存在しない証拠を見つける。**

Beaconは灯台。Compassは羅針盤。

---

## 9. Chronicle — 思考の変化そのもの

Chronicleは履歴ではない。**思考の変化そのもの**を保存する。

```
2024  AIを使いたい
 ↓
2025  AIに依存したくない
 ↓
2026  Evidence First
```

この変化が知識になる。

> **語彙についての注意**：ここで語られている「思考の変化」と、現在実装されている
> Chronicle（＝Markerを含む会話・文脈）は**別の概念**である。詳細は11章。

---

## 10. Evidence Map

Evidence Mapは知識の量ではない。**思考の地図**である。

そこには 星（Evidence）／霧（Mist）／未知（Unknown）が存在する。

**Unknownは欠陥ではない。未来の可能性である。**

---

## 11. 7つの憲法

1. **Memory Before Intelligence** — 知能より先に、記憶を守る
2. **Evidence First** — 証拠のない断定をしない
3. **Human Owns Meaning** — 意味を決めるのは人間
4. **Unknown is Sacred** — 分からないことを尊重する
5. **Every Answer Has Roots** — すべての回答は証拠へ辿れる
6. **Time Is Evidence** — 思考の変化そのものが知識になる
7. **Silence Is a Feature** — 静けさもUXである

---

## 12. Lumoraとは何か

Lumoraは AIチャットではない。ノートアプリでもない。RAGでもない。PKMでもない。

Lumoraは **Evidence OS という設計思想の上に作られた、思考を育てるOS**である。

AIを統合するのではない。**思考を統合する。**

時間を越えて。AIを越えて。

そして、昨日の自分と、今日の自分と、未来の自分が、
同じEvidenceを囲んで対話できる場所。

---

## 13. 定義（最終形）

> Evidence OSとは、あらゆる場所で生まれた思考の断片を、証拠として積み重ね、
> 時間とともに再発見・再構築・再対話できるようにする知識基盤である。
> AIはその思考を生成するためではなく、根拠を示し、つなぎ、
> 人間が自ら意味を見いだすことを支えるために存在する。

この一文で、「AIには決定権を渡さない」という思想と、
「AIを越えて思考を統合するOS」というビジョンの両方を表現している。

---

# 付録

以下は思想本文ではなく、既存ドキュメント・実装との突き合わせ結果である。

## A. 既存5原則（PRINCIPLES.md）との対応

**7つの憲法のうち、既存原則に無いものは3つだけである。**
残り4つは`PRINCIPLES.md`に別の言葉で既に存在する。この重複は矛盾ではなく、
同じ思想が2つの粒度で書かれていることを意味する。

| 憲法 | PRINCIPLES.md | 関係 |
|---|---|---|
| 3. Human Owns Meaning | Principle 1「AIは提案者であり、決定者ではない」 | **同一** |
| 5. Every Answer Has Roots | Principle 4「根拠へ戻れる」 | **同一** |
| 6. Time Is Evidence | Principle 2「人間の意思は必ず残す」＋`MarkerHistory` | **ほぼ同一** |
| 2. Evidence First | Principle 4 | **半分だけ新しい**（下記） |
| 1. Memory Before Intelligence | — | **新しい** |
| 4. Unknown is Sacred | — | **新しい** |
| 7. Silence Is a Feature | — | **新しい** |

**Evidence Firstが「半分だけ新しい」理由**：Principle 4「根拠へ戻れる」は**事後**の保証で、
答えが出た後に一次情報へ辿れることを言っている。Evidence Firstは**事前**の順序であり、
答える前にまず記憶を探せと言っている。この「先に探す」半分は既存のどの原則にも無く、
Beaconの実装方式を直接縛る（生成の前に必ず検索を通す、という制約になる）。

`PRINCIPLES.md`の5原則は引き続き**実装判断の窓口**として機能する。7つの憲法は
その上位にある宣言であり、5原則を置き換えるものではない。

## B. 語彙の確定（2026-07-28）

思想文書を書き起こす際、既存のデータモデルと衝突する語が2つ見つかった。
いずれも**「まだ作っていないものには名前を付けない」**という判断で解決した。

この判断の根拠は`docs/future/mission-architecture.md` 5章に記録された観察である —
Occurrence Resolverは「概念が先にあって実装したのではなく、実装が先にあって
概念が後から名前をつけた」。この順序を健全とし、維持すると決めている。

### B-1. Chronicle

| | 実体 | 実装 |
|---|---|---|
| **現行の意味** | Markerを含む会話。知識が生まれた背景・文脈（`data-model.md` 0章） | `src/app/chronicles.tsx`、下タブ、アイコン形状確定、DB列`unlock_flags.arca_chronicle`、`src/`内66箇所 |
| **9章の意味** | 思考の変化そのもの（2024→2025→2026） | **無し** |

**決定：Chronicleは現行の意味（会話＝文脈）で固定する。**
9章で語られている「思考の変化」には、**今は名前を付けない。**

実装が存在する側が名前を保持する。名前の無い側は、実装される時点で改めて命名する
（`DESIGN.md`原則7 One New Word Per Unlock に従い、語彙を先回りして増やさない）。
現時点で最も近い実装は`MarkerHistory`（色・範囲・状態の変遷を追記専用で記録）だが、
これは「マーカー1件の変遷」であり、9章の「思考全体の変遷」とは粒度が違う。

### B-2. Evidence

本文には2つの用法が同時に存在していた。

- 3章：「Markerとは…一つの証拠である」→ **Marker ＝ Evidence**
- 元のPipeline：`… → Chronicle → Evidence → AI` → **Marker ≠ Evidence**

**決定：Evidenceは思想レベルの語に限定する。**
Evidence OS／Evidence First／Evidence Map／Every Answer Has Roots で使う。
**データモデル上の段階・テーブルにはしない。**

- 知識の最小単位は引き続き **Marker（＝Arca）**
- 元Pipelineの6段目「Evidence」は**削除**した（4章の記載が確定版）
- 「AIに渡す直前の集約」が必要になった場合、それはテーブルではなく**View**として
  設計する（`data-model.md` 0章「RealmとViewの責務分離」）

これにより、Evidenceは「Lumoraが知識をどう扱うかの性質」を指す語になり、
既存のMarker/Arca/Realm/Wingとは層が違うため衝突しない。

## C. 実装状況（2026-07-28時点）

| 概念 | 実体 | 状態 |
|---|---|---|
| Import | `src/import/parsers/`（ChatGPT/Claude/Gemini/Perplexity/文書/Claude Code） | **実装済み** |
| Marker（＝Arca） | `markers` | **実装済み** |
| Realm | `projects` | **実装済み** |
| Wing | `themes` ＋ `marker_wings`（手動作成・手動収納が可能） | **実装済み** |
| Chronicle（会話） | `conversations` | **実装済み** |
| Beacon | — | Phase2（`VISION.md` 9章） |
| Compass | — | **Phase2。既存ドキュメントに前例が無い新概念** |
| Evidence Map | — | Phase2 |
| 思考の変遷（9章） | — | 未着手・未命名 |

**Compassについて**：Beaconは`VISION.md` 9章に既にあるが、Compassはこの文書が初出である。
「存在しないものを指す」という役割はBeaconでは埋まらない。着手時に注意すべき点として、
「証拠が無い」と判定するには**無いことを判定する仕組み**が要る。現在のLumoraで
「無い」を扱っているのは`resolveMarkerPosition`の`missing`/`text_only`
（`src/lib/markerLayout.ts`）と、バックフィルのTier 3（`scripts/backfill/README.md`）だけである。

## D. 次の段階

Beacon / Compass / Evidence View（Evidenceを集約して見せるView）の設計は、
**Phase2以降**に行う。着手時にこの文書を読み直し、7つの憲法に照らして再評価すること。

それまでは現在のコードへ持ち込まないこと。
