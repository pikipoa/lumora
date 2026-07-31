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

## 前文

> **Lumoraは知識を保存するシステムではない。知識が時間とともに意味・構造・文脈を獲得し、
> そのライフサイクルを通じて未来の思考を支え続けられる環境を提供するシステムである。
> AIはその過程を支援する交換可能なエンジンであり、知識そのものがプロダクトの中心である。**

この前文の主語は最後まで**知識**である。AIは支援するエンジン、人間は価値を決める主体、
Lumoraはその両者の間で知識が育ち続けられる**環境**を提供する。

以降の憲法（11章）は、すべてこの前文から導かれている。

---

## 0. この文書の位置

```
Tier 1  Philosophy               前文・定義（この文書の冒頭、VISION.md 1章）
          ↓                      「なぜ作るか」
Tier 2  Behavior Constitution    11-1. 振る舞いの憲法（7条）
          ↓                      AI・Beacon・Compassが**どう振る舞うか**を拘束する
Tier 3  Architecture Principles  11-2. 構造の原則
          ↓                      知識が**どう構造化されるか**を拘束する
Tier 4  Implementation           data-model.md / DESIGN.md / search-spec.md / ER図
                                 「どう作るか」。**変更可能**
```

`PRINCIPLES.md`（5原則）はTier 2とTier 3の内容を、日々の実装判断で使える形に落とした
**窓口**として機能する。憲法を読まなくても実装できるが、迷ったら憲法へ戻る、という関係。

**Tier 2とTier 3を混ぜないこと（重要）。** 両者は拘束する対象が違う。

| | 拘束するもの | 例 |
|---|---|---|
| Behavior | 実行時の振る舞い | Evidence First＝「生成の前に必ず検索を通す」 |
| Architecture | 知識の構造 | Layered Knowledge＝「原本と派生を分離する」 |

**Tier 4をTier 2・3へ持ち上げないこと（重要）。** 憲法には何十年も変わらないものを書く。
ER図は半年後に変わる。現在のスキーマを条文にすると、スキーマが変わった時に憲法の方が壊れる
（この理由で採用しなかった原則がある。付録E参照）。

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

## 11. 憲法

憲法は2層ある。**振る舞い**を拘束するものと、**構造**を拘束するものは別物であり、
混ぜない（0章のTier表を参照）。

### 11-1. Behavior Constitution（振る舞いの憲法・7条）

AI・Beacon・Compassが実行時にどう振る舞うかを拘束する。

1. **Memory Before Intelligence** — 知能より先に、記憶を守る
2. **Evidence First** — 証拠のない断定をしない
3. **Human Owns Meaning** — 意味を決めるのは人間
4. **Unknown is Sacred** — 分からないことを尊重する
5. **Every Answer Has Roots** — すべての回答は証拠へ辿れる
6. **Time Is Evidence** — 思考の変化そのものが知識になる
7. **Silence Is a Feature** — 静けさもUXである

このうち **2（Evidence First）と 4（Unknown is Sacred）は、構造の原則では代替できない。**
2は「生成の前に必ずEvidenceへ戻る」という順序そのものであり、これが無いと
`AI → それっぽい回答` に戻る。4はCompassの存在理由であり、AIが「分かりません」ではなく
「Evidenceがありません」と言えることを支えている。データモデルをどう変えても、
この2条は別途書かれていなければ失われる。

### 11-2. Architecture Principles（構造の原則）

知識がどう構造化されるかを拘束する。**現在のスキーマではなく、スキーマが満たすべき性質**を
書く（現在のER図を条文にしない。付録E参照）。

#### A-1. Layered Knowledge — 原本と派生を分離する

```
Derived   要約 / Wing / Tag / Beacon / 翻訳 / 編集後の本文
   ↑
Evidence  原本（不変）
```

**派生を作る操作は、原本を書き換えてはならない。** 原本を保ったまま、派生だけを何度でも
破棄・再生成できること。派生がどれだけ増えても、原本は1つのまま増殖しない。

実装での実体（Tier 4）：`quoted_text`（不変の原本）と`edited_text`（派生）の分離、
Tag/Wingが参照であって本文の複製ではないこと、`MarkerHistory`が追記専用であること。
いずれも`data-model.md`に既にある決定だが、**個別の設計判断ではなく原則である**と
位置づけ直したのが今回（2026-07-28）。

#### A-2. Stable Identity — 知識の同一性は維持する（**未確定**）

分類され、再構成され、関連付けられ、翻訳され、活用されても、**それは同じ知識である**。

**この条項はまだ実装を拘束できていない。** 思想としては正しいが、条文として機能するには
「どの操作がIDを保持しなければならず、どの操作が新しいIDを作るのか」が決まっている必要が
ある。決まっていないものを憲法に置くと、読んだ人が各自の解釈で実装する。

現時点で言えること：

- **Markerの同一性は既に保たれている。** 色の変更・範囲の調整・Wingの移動・Realmの移動・
  `edited_text`の編集・`rejected`への変更は、いずれもUPDATEか中間テーブルの行であって、
  新しい`markers.id`を作らない
- **Chronicleの同一性は保証されていない。** 同じエクスポートを再インポートすると、
  `conversations`に新しい行（別のuuid）が増える。`importService.ts`に重複排除
  （`upsert`／`onConflict`）は無い。**これは仮定ではなく現在の実装である**

**先に決めるべきは名前ではなく規則である。** `Arca ID` / `Evidence ID` / `Knowledge ID`
のどれを名乗るかは、規則が決まってから付ける（付録B「まだ作っていないものには名前を付けない」）。

> **この条項を「未確定のまま」にできなくなる条件（2026-07-31追記）**：Realmを配布・販売する
> 構想（`docs/future/knowledge-pack-market.md`）に着手する場合、A-2は**先に決めなければ
> ならない**。同じRealmが複数人にコピーされ、それぞれが編集し、元が更新される状況では、
> 「これは同じ知識か」を判定できなければ更新履歴も信頼スコアも成立しないためである。

---

## 12. 非目標（Non Goals）

思想は拡大解釈されやすい。**Evidence OSがやらないことを明文化しておく。**

**Evidence OS does NOT:**

- **AI人格を作ることを目的としない**
- **人間の意思決定を代替しない**
- **Evidenceという新しいデータモデルを追加しない**
- **既存のPhase1実装を書き換える理由にならない**

3つ目は付録Bの決定と対応する。4つ目は最上部のガード文と同じことを、
読み飛ばした人にもう一度言っている。

---

## 13. Lumoraとは何か

Lumoraは AIチャットではない。ノートアプリでもない。RAGでもない。PKMでもない。

Lumoraは **Evidence OS という設計思想の上に作られた、思考を育てるOS**である。

AIを統合するのではない。**思考を統合する。**

時間を越えて。AIを越えて。

そして、昨日の自分と、今日の自分と、未来の自分が、
同じEvidenceを囲んで対話できる場所。

---

## 14. 定義（最終形）

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

## D. 8原則の提案レビュー（2026-07-28）

「憲法を8原則にする」という提案（Knowledge First / Human Decides / Immutable Origin /
Layered Knowledge / Composable Knowledge / Traceable Knowledge / AI Augments, Never Owns /
Stable Identity）を検討し、**置き換えではなく追加**という結論に至った経緯。

### 結論に至った観察

**8原則は7憲法の改良版ではなく、別の軸だった。** 7憲法はAIが**どう振る舞うか**、
8原則は知識が**どう構造化されるか**を語っている。競合していないため、置き換えると軸が1本消える。

置き換えた場合に失われる条項：**Evidence First**（Beaconの実装を縛る唯一の条項）、
**Unknown is Sacred**（Compassの存在理由）、**Time Is Evidence**、**Silence Is a Feature**。
8原則のどれもこの4つを代替しない。

### 採用しなかったもの

| 原則 | 理由 |
|---|---|
| Knowledge First | 前文へ吸収。「AIは交換可能なエンジン」は前文が述べている |
| Human Decides | `PRINCIPLES.md` Principle 1と同一 |
| AI Augments, Never Owns | 同上（Human Decidesとも重複。8つのうち3つが「AIは主役ではない」を別方向から述べていた） |
| Immutable Origin | A-1 Layered Knowledgeに含まれる（原本が不変だから派生を分離できる。表裏の関係） |
| Traceable Knowledge | `PRINCIPLES.md` Principle 4「根拠へ戻れる」と同一。またA-1の帰結でもある |
| **Composable Knowledge** | **採用しない。現在のER図を条文化してしまうため**（下記） |

### Composable Knowledgeを採用しない理由

提案された連鎖は `Arca → Wing → Realm` だが、**現在の実装はこの形ではない**。
MarkerはRealmへ直接割り当てられ（`markers.project_id`）、Wingは多対多の**任意**である
（`data-model.md`：「ArcaでのRealm割当直後にはWingは未設定」）。Wingを経由しないArcaが
正常に存在する。

仮に現在の構造を正確に書き写したとしても、それは**憲法にER図を書くこと**になる。
ER図は半年後に変わる。変わった時に壊れるのが実装ではなく憲法の方になる、という逆転が起きる。
`docs/future/mission-architecture.md`を隔離したのと同じ判断。

### この整理から得た運用ルール

**原則を評価する時は「良い原則か」ではなく「それは何を拘束するのか」を問う。**
拘束対象が実行時の振る舞いならTier 2、知識の構造ならTier 3、現在のスキーマならTier 4（＝憲法に
書かない）。この問いを通さないと、憲法は「AIの哲学 → 知識哲学 → ER図」へ静かに降りていく。

## E. 次の段階

Beacon / Compass / Evidence View（Evidenceを集約して見せるView）の設計は、
**Phase2以降**に行う。着手時にこの文書を読み直し、11章の憲法（振る舞い7条＋構造の原則）に
照らして再評価すること。Stable Identity（A-2）の規則も、その時点までに決めておく。

それまでは現在のコードへ持ち込まないこと。
