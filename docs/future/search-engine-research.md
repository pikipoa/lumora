# 検索エンジン設計調査（将来構想・`search-engine.md`のための材料）

> **この文書を読むAI・開発者へ（最重要）**
>
> **これは実装契約ではない。将来`search-engine.md`を書くための調査資料である。**
>
> 現在の実装は`search-spec.md`にまだ追いついていない（3-1のトークン化・厳密ANDは未実装で、
> `search_conversations` RPCは入力全体を1つの`ilike`に渡している）。**憲法にも仕様にも
> 追いついていない段階で12章の実装契約を先に置くと、契約の方が先に古びる。**
>
> この文書を根拠に現在のコードをリファクタリングしないこと。Phase1のスコープ
> （ローンチ 2026-10-01・Web版のみ）は、この文書によって変わらない。
>
> `search-engine.md`を書き始める時点で、この文書を読み直して再評価すること。

作成：2026-07-29。目的は、`search-spec.md`（検索の憲法）を1文字も変えずに実装できる
設計書を書くための材料を揃えること。非目的は、検索ライブラリの紹介・ベンチマーク比較・
アルゴリズム解説。

---

## 0. 前提として固定される制約（`search-spec.md`より）

| # | 制約 | 設計上の意味 | 出典 |
|---|---|---|---|
| C1 | 検索対象は一次情報のみ | 索引は「派生物」であり、正本は別にある | 2-1 |
| C2 | Chronicle（Conversation）が検索単位 | 結果の粒度＝Chronicle | 3-2 |
| C3 | 厳密ANDがデフォルト | クエリ意味論が固定 | 3-2 |
| C4 | Messageは結果単位ではなく着地点 | 二層モデル（match層 / result層） | 3-3 |
| C5 | 関連度ランキングは禁止 | スコアという概念を持たない | 3-5 |
| C6 | 並び順はユーザーのみが決定 | Ordererは外部入力にのみ従う | 3章冒頭 |
| C7 | 検索条件をAIが勝手に変更しない | クエリ変換は禁止（正規化のみ許可） | 0章 |
| C8 | 検索は決定的 | 同一入力 → 同一出力（再現可能） | 0章・3-6 |
| **C9** | **検索語を追加するほど結果は単調に絞られる** | **演算子は絞る方向にのみ作用してよい** | **0章** |

C9は元の調査資料に無かったが、`search-spec.md` 0章の2つ目の原則として存在する独立した制約。
C7が部分的に覆うが、C7は「システムが書き換えない」、C9は「語を足すと絞られる」であり、
拘束対象が違う。以降、各設計の評価はすべてC1〜C9への適合／衝突で行う。

---

## 1. 全体像（1枚図）

```
              Scope（値・シリアライズ可能）          Query
                        │                             │
        ┌───────────────┴──────┐                      │
        │                      │                      │
┏━━━━━━━┿━━━━━━━━━━━━━━━━━━━━━━┿━━━━━━━━━━━━━━━━━━━━━┿━━━━━━┓
┃       │      Snapshot が全工程を固定する            │      ┃
┃       ▼                      │                      ▼      ┃
┃  ┌─────────┐                 │                 ┌─────────┐ ┃
┃  │Explorer │                 │                 │ Parser  │ ┃
┃  │集計・ナビ│                 │                 └────┬────┘ ┃
┃  └────┬────┘                 │                      ▼      ┃
┃       │                      │                 ┌──────────┐┃
┃       │                      │                 │Normalizer│┃
┃       │                      │                 └────┬─────┘┃
┃       │  共有(同一primitive) │                      ▼      ┃
┃       └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┴────────────────►┌─────────┐ ┃
┃                                                │ Filter  │ ┃
┃                                                └────┬────┘ ┃
┃                            Matcher → Collector →   ▼       ┃
┃                            Orderer → Paginator →           ┃
┃                            Hydrator → Landing              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▲━━━━━━━┛
                                                     │
                          Atomic swap だけが接触する  │
┌────────────────────────────────────────────────────┴───────┐
│  Index Builder（別レーン・非同期）                          │
└────────────────────────────────────────────────────────────┘
```

図が主張していること：

1. **Scopeは「値」であってモードではない** — シリアライズ可能で`resolved_query`に載る。UIの状態にするとC8が壊れる（→5章）
2. **ExplorerとSearchは兄弟であり、積み上げではない** — 両者は同一のFilter primitiveを呼ぶ。実装が2つあると件数が食い違う
3. **Snapshotが両方を覆う** — 固定すべき視界が1つだから決定性が成立する
4. **Index Builderは別レーン** — Search Engineと接触するのはAtomic swapの一点のみ

---

## 2. 調査対象と、そこから得た設計思想

「READMEではなく設計文書があるもの」を優先して選定した。

### 2-1. 特に重要な7つ

**Apache Lucene — マッチングと収集の分離**

`QueryParser → Query → Weight → Scorer → Collector → TopDocs`。`Query`は検索意図の宣言
（不変・シリアライズ可能）、`Scorer`はセグメント単位でdocId昇順に一致文書を列挙する
イテレータ、`Collector`は流れてきたdocIdをどう集めるかを決める。`TopScoreDocCollector`と
`TopFieldCollector`を差し替えるだけで並び順が変わる。

含意：**スコアリングは`Scorer.score()`と`TopScoreDocCollector`に閉じている。**
Lumoraは「Scorer相当は一致判定だけを返し、Collector相当はスコアを見ない」構造にすれば、
**C5をコード構造で不可能にできる。**

**Tantivy — 不変セグメント + WORM Directory**

Index＝独立した不変Segmentの集合。DocIdはSegment内で追加順に採番される
（＝**投入順という決定的な自然順序が常に存在する**）。削除はtombstone。`SnippetGenerator`が
検索とは独立したモジュールとして存在。

含意：C6でユーザーが並び順を決めるとしても、**何も指定しなかった時の既定順序は必要**で、
それは「スコア」ではなく「安定した自然順序」であるべき。

**Bleve / Scorch — IndexSnapshotによる安定した視界**

`index/scorch/README.md`はRFC調（MUST/MAY）で書かれており、そのまま書き方の手本になる。
検索は必ず`IndexReader`＝IndexSnapshotを取得して始まり、そのSnapshot内の削除ビットマップは
不変。索引保守は3つのバックグラウンドループが非同期に行う。

含意：**C8の実装上の唯一まともな担保がSnapshot。**「同じ時刻なら同じ結果」ではなく
「**同じsnapshot_idなら同じ結果**」と定義すべき。

**Meilisearch / milli — spec-first運用と、真似してはいけない一点**

`meilisearch/specifications`という独立リポジトリでRFC番号付き仕様を管理している運用は、
`search-spec.md`を憲法とする運用の先例。

一方、`rankingRules`に`[]`を指定するとランキングは行われないが、結果は内部IDの
**未定義順序**で返る。**Lumoraは「ランキングなし＋定義済み順序」でなければならない。**
これは「参考にするが、そのまま真似してはいけない」典型例。

**Xapian / notmuch — Lumoraと構造がほぼ同型**

**notmuchは「メッセージにマッチさせ、スレッドを結果として表示する」検索エンジン**であり、
C2＋C4と1:1で対応する。

- 出力は1行1スレッド。**マッチしたメッセージ数 / スレッド内の総メッセージ数**を返す
- 演算子を書かなければ全項目が**暗黙のANDで結合**される（C3と同じ既定）
- prefixが2種類に型分けされている：**boolean prefix**（完全一致・スコアなし）と
  **probabilistic prefix**（語ベースの柔軟な一致）
- `thread:{<サブクエリ>}` という二段階クエリ
- 並び順は`--sort=newest-first | oldest-first`のみ。**関連度順という選択肢が存在しない**
- `--format-version=N` で**結果スキーマがバージョン管理されている**

含意：本調査で最大の収穫。Lumoraが発明しようとしている二層モデルは、notmuchが10年以上
運用している実証済みモデルである。`matched / total`の返し方は、`search-spec.md` 3-3で
独立に到達した`match_count`と同じ結論。

**Zoekt — indexとsearchをファイルシステムだけで繋ぐ**

索引側と検索側は独立した2つのサブシステムで、通信手段は共有ディレクトリ上のシャード
ファイルのみ。→ゼロダウンタイム更新。全マッチは**document orderで返る**（これにより
AND/ORの合成が素直になる、と設計文書が明言）。

含意：索引更新と検索を別サブシステムとして定義し、契約はスナップショットだけにする。
**インポート中でも検索が壊れない。**

**Pagefind — 2段階フェッチ**

`search()`は軽量な結果ハンドルを返し、`result.data()`を呼んで初めて本文・抜粋を取得する。
1万ページ規模でも1回の検索の通信量が数百KBに収まる。

含意：**C4の転送設計そのもの。** 検索→Chronicleの軽量ハンドル、着地時に初めてMessage本文。

### 2-2. その他の参照先

- **Typesense** — `query_by` / `filter_by` / `sort_by` のAPI分離。索引対象フィールドの宣言
- **ripgrep** — 既定フィルタの規律。`-uuu`で全解除できる。`--smart-case`は既定ではない
- **Sourcegraph** — 3.9でliteral by defaultへ転換。Smart Searchは別トグルとして隔離
- **VS Code Search** — 3つの可視トグル。内部クエリと起動引数をログに出せる
- **SQLite FTS5** — external contentモード、auxiliary function（`bm25()`/`snippet()`が
  `MATCH`と別レイヤー）
- **PostgreSQL FTS** — `ts_rank`は明示的に呼ばない限り使われない。`ts_headline`はGIN索引を
  使わないのでページネーション後の少数件にだけ適用すべき
- Quickwit / Elasticsearch / Solr / Sonic / livegrep / IntelliJ / Recoll / Lunr系

---

## 3. 流用できる設計思想

| # | 思想 | 出典 | Lumoraでの適用 |
|---|---|---|---|
| A | MatcherとCollector/Ordererを別モジュールにする | Lucene | 一致判定はスコアを返さない型にする。**C5を型で不可能にする** |
| B | Snapshotによる安定した視界 | Bleve / Lucene / Tantivy | C8を「同一クエリ＋同一snapshot_id ⇒ 同一結果列」と定義。レスポンスにsnapshot_idを含める |
| C | filter context（スコアなし判定）だけを使う | Elasticsearch | Lumoraには「スコアを計算する層」が存在しない |
| D | 索引サブシステムと検索サブシステムの完全分離 | Zoekt | インポート中でも進行中の検索結果が変化しない |
| E | thread/message 二層モデル | notmuch | `matched件数 / 総件数`を返す |
| F | boolean prefixとprobabilistic prefixの型分け | Xapian / notmuch | 型が違うものとして仕様に定義する（ただし付録Xの制約下で） |
| G | 2段階フェッチ | Pagefind | Chronicle一覧は軽量、Message本文とスニペットは着地時 |
| H | external content（索引は本文を持たない） | SQLite FTS5 | **C1の物理的担保** |
| I | スニペット生成は独立モジュール | Tantivy / FTS5 / PG | 一致判定にも順序にも影響しない |
| J | terms / filters / order のAPI分離 | Typesense | APIの型が思想を伝える |
| K | 索引対象フィールドのホワイトリスト宣言 | Typesense / FTS5 UNINDEXED | C1の運用担保 |
| L | Analyzerに名前とバージョンを持たせる | Bleve / Lucene / FTS5 | `analyzer_version`を索引メタに埋め、変更時は再索引を必須にする |
| M | ストレージ抽象 | Tantivy WORM Directory / Lucene Codec | 同じSearch APIをPostgresとSQLiteの両方に載せる |
| N | 索引更新は非同期タスクキュー | Meilisearch index-scheduler | インポートはタスク化。検索は影響を受けない |
| O | 既定フィルタは「文書化・決定的・1操作で全解除」 | ripgrep `-uuu` | 既定除外を作るなら必ずこの3条件 |
| P | リテラル既定、拡張は明示トグル | Sourcegraph / VS Code | C7・C9と整合 |
| Q | 解決済みクエリの可視化 | VS Code | `resolved_query`をレスポンスに含める。**C7の証明手段** |
| R | 結果スキーマのバージョニング | notmuch `--format-version=N` | `schema_version`を返す |
| S | 原子的なインデックス切替 | Zoekt / Lucene commit / Typesense | 途中状態を検索させない |
| T | 仕様をRFC番号付きで管理 | meilisearch/specifications | `search-spec.md`＝憲法、`search-engine.md`＝実装契約 |
| U | document orderという自然順序を常に持つ | Zoekt / Tantivy / Lucene | **「未定義順序」にしない**（Meilisearchの失敗を避ける） |

---

## 4. 採用しない設計

| # | 設計 | 出典 | 理由 |
|---|---|---|---|
| 1 | BM25 / TF-IDF スコアリング | Lucene, ES, FTS5, PG | C5違反 |
| 2 | ranking rules / bucket sort | Meilisearch | C5・C6違反 |
| 3 | typo tolerance | Meilisearch, Typesense | C7・C8違反 |
| 4 | ステミング / 語幹化 | PG `english`, FTS5 `porter` | C3違反（「厳密」が壊れる） |
| 5 | シノニム自動展開 | Meilisearch, Solr | C7違反 |
| 6 | 入力内容に応じた暗黙のモード切替 | ripgrep `--smart-case` | C8違反 |
| 7 | クエリ自動緩和・再実行 | Sourcegraph Smart Search | C7の直接的な違反 |
| 8 | ベクトル検索 / hybrid search | Meilisearch, Typesense, ES | 「上位k件」概念が必須。全件AND・決定性と両立しない |
| 9 | LLMリランキング / 会話型検索 | Typesense, Meilisearch | C5・C7違反 |
| 10 | パーソナライズドリランキング | Meilisearch | C6違反 |
| 11 | offsetベースのページング | 一般的なREST設計 | 索引更新で結果がずれる。C8を実質的に破る |
| 12 | 分散シャーディング / レプリカ | Typesense, ES | 個人知識1ユーザー規模には過剰 |
| 13 | positional trigram索引 | Zoekt | 索引が本文の数倍。モバイルに載らない |
| 14 | 索引に本文を丸ごと持つ | FTS5 default | C1違反（一次情報の二重管理） |
| 15 | 自動クラスタリング / 自動ファセット順序 | Solr | 分類を機械が決める |
| 16 | UI上の関連度示唆（★、%、スコアバッジ） | 一般的な検索UI | C5の思想がUIで破られる |
| 17 | ランキングを外すと順序が未定義になる設計 | Meilisearch `rankingRules: []` | Lumoraは「ランキングなし＋定義済み順序」 |
| 18 | **Realm / Wing / Tag によるフィルタ** | Sourcegraph `repo:`, ES index選択 | **付録X参照。1章・2-3・3-1違反** |

### 一般には優秀だが思想が衝突するもの（要点）

- **BM25**：「たぶん欲しいもの」を機械が決める。Lumoraは**ユーザー自身の知識世界**を扱う。
  他人の推測順で並べられることは、その世界の所有権を奪うことに等しい
- **typo tolerance**：ユーザーが「なぜこれが出たのか」を説明できなくなる
- **`--smart-case`**：決定的ではあるが**予測可能ではない**。C8の精神に反する
- **Smart Search**：Lumoraでは0件は正しい答え
- **ベクトル検索**：Lumoraの検索とは**別の機能**であり、同じ名前で呼んではいけない
- **ESのrelevance tuning**：「スコアを触って改善する」という**運用文化そのもの**が憲法違反。
  ツールを持たないほうがよい

---

## 5. ExplorerとSearchの関係（検討と結論）

「FilterはSearch Engineの一工程ではなく、その上位にあるExploration Engineの中核ではないか」
という問いを、反証を通して精査した記録。

### 反証1：決定性が「二重状態」になる

C8の担保はSnapshotに依存するが、**あれが効くのは固定すべき視界が1つだから**である。
FilterをSearch Engineの外に出すと、再現に必要な状態がsnapshot_idとExplorerのセッション状態の
2つになる。

**回避条件**：Explorerの出力は「UIの状態」ではなく**シリアライズ可能な値（Scope）**であり、
必ず`resolved_query`に含める。

### 反証2：実行順序を固定すると最適化余地を自分で捨てる

「先に絞る→次に検索」は直感的だが、成熟した実装はほぼ全部逆をやっている。Zoektは
マッチ数が最小になるtrigramペアを選んで先に走らせ、Luceneは最も安いイテレータから合成し、
Postgresのプランナは選択度で順序を決める。

**回避条件**：「これは概念の分離であって実行順序の規定ではない」と明記する。

### 反証3：同じ集合に対する実装が2つできる（最も危険）

Explorerが「340件」と表示し、検索が338件を返す。マッチング実装が2つあれば必ず起きる。
Lumoraは「AIが検索条件を勝手に変えない」を看板にしている製品であり、この種のズレは
他のどのアプリより致命的に効く。

**回避条件**：Explorerは独自のマッチング実装を持たない。Searchと同一のFilter primitiveを呼ぶ。

### 反証できなかった点 — 分離の理由は「Filter」ではなく「集計」

| | Search | Explorer |
|---|---|---|
| 出力 | 条件に合う集合の**1ページ分** | バケットごとの**count** |
| 取り出し | する | しない |
| 最適化対象 | 上位N件の取得コスト | 全コーパスの集計コスト |
| キャッシュ | しにくい（cursor依存） | しやすい（Snapshot単位で不変） |

分離は正当。ただし**分離線は「Filter vs Match」ではなく「Aggregation vs Retrieval」**。

### 結論：積み上げではなく兄弟

```
              Scope（値）
        ┌──────┴──────┐
        ▼             ▼
    Explorer       Search
   (集計・ナビ)   (取得・AND・順序・着地)
        └──────┬──────┘
               ▼
       Filter Primitive   ← 単一の真実
               ▼
           Snapshot
```

- **D1**：Scopeはシリアライズ可能な値として定義し、`resolved_query`に必ず含める
- **D2**：ExplorerとSearchはScopeの上の兄弟であり、積み上げにしない
- **D3**：Filter primitiveの実装は1つ。Explorerは自前のマッチングを持たない
- **D4**：Search EngineのFilter工程は残す。**Scope未指定でも検索は成立しなければならない**
- **D5**：Explorerの固有責務は「集計・ナビゲーション・クエリなしの閲覧」であり「絞り込み」ではない
- **D6**：`Realm → Tag → Marker → 期間 → 検索`というファネル順序は採らない。Explorerは
  検索の前段ではなく**検索と並列の入口**
- **D7**：Exploration Engineという語は製品概念として使い、層境界名としては使わない
- **D8**（付録Xの帰結）：**ScopeにRealm / Wing / Tagは載らない。** Explorerは
  Realmごとの件数を集計してよい（ナビゲーション）が、その値が検索条件へ渡ることはない

---

## 6. 知能の責務分離

### 6-1. 境界線は「抽出 vs 生成」

「Index BuilderはAI利用可、Search EngineはAI禁止」という契約境界は正しいが不十分。
Index Builder内部でAIが**生成**（要約・タグ付け・重要度判定）を行って索引に直接書き込むと、
契約境界の内側でC1が破られる。しかもSnapshotで視界を固定しているためC8のテストは通り、
発見しにくい。

> **索引に載る語・タグは、一次情報に実在するか、ユーザーが承認したものでなければならない。**

| 操作 | 出力は入力の部分集合か | 分類 | 索引への扱い |
|---|---|---|---|
| 形態素分割 | Yes | 抽出 | 自動でOK |
| 関連メッセージの選別 | Yes | 抽出 | 自動でOK |
| 重要箇所の抜粋 | Yes | 抽出 | 自動でOK |
| キーワード抽出 | 条件付き | 抽出寄り生成 | 検索用途は可、UI表示は要注意 |
| 観点分類（ラベル付け） | No | 生成 | **承認ゲート必須** |
| 要約・言い換え | No | 生成 | 索引に**入れない**。別ストアで隔離 |
| ベクトル埋め込み | No | 生成 | 別API・既定オフ |

### 6-2. 承認ゲートは既存のBeacon規則を流用する

「AIは候補を提示するだけ、採用はユーザー」という既存規則（`PRINCIPLES.md` Principle 1、
`marker_wings`の`proposed → confirmed/rejected`）を、分類・タグ付け全般へ拡張適用する。
**新しい概念は導入しない。** 承認された時点でそのタグは「ユーザーが書いたもの」になり、
以降はC1上まったく問題のない一次情報として扱える。

### 6-3. 「束ねたビュー」をChronicleと呼ばない

複数の元Chronicleから抜粋を集めて1つのまとまりとして見せる機能は、**新しい文書ではなく、
既存Messageへのポインタの並び**として実装する。

- 誤り：新しいテキストを合成し`Chronicle`として索引に登録する → C2違反。検索結果に
  実在しない会話が紛れ込む
- 正しい：参照リストだけを持つ別オブジェクトとして扱い、検索対象にしないか、対象にする
  場合も型で区別する

**このオブジェクトには現時点で名前を付けない。** 実装が存在しないため
（`EVIDENCE-OS.md`付録B「まだ作っていないものには名前を付けない」）。着手時に命名する。

---

## 7. `search-engine.md` 目次案

| 章 | タイトル | 参照 |
|---|---|---|
| 0 | 本書の位置づけ（憲法と実装契約の関係） | meilisearch/specifications |
| 1 | 設計原則（C1〜C9の実装原則への翻訳・「禁止は型で表現する」） | Lucene, Bleve scorch README |
| 2 | 用語とデータモデル | notmuch, Lucene, Tantivy |
| **3.0** | **状態遷移図（1枚）— ここから書く** | Zoekt, Bleve, Meilisearch |
| 3.1 | 索引レーンと検索レーン（契約はAtomic swapのみ） | Zoekt, Typesense |
| 3.2 | Scopeの定義（値であってモードでない） | ES index/alias |
| 3.3 | ExplorerとSearchの関係（D1〜D8） | 本資料5章 |
| 4.1 | Query Input（何も加工しない層） | VS Code |
| 4.2 | Query Parser（リテラル既定・暗黙AND・prefix型分け） | Xapian, notmuch, PG `websearch_to_tsquery` |
| 4.3 | Query Normalizer（**許される正規化の限定列挙**） | 反面教師: typo tolerance, `--smart-case` |
| 4.4 | Filter（期間・source・採掘状態の真偽判定。**Realm/Wing/Tagは含まない**） | ES filter context, 付録X |
| 4.5 | Matcher（Message単位の一致→Chronicleへ集約。厳密AND） | Lucene Scorer, Zoekt, notmuch |
| 4.6 | Collector（**スコアを見ない・作らない**） | Lucene Collector |
| 4.7 | Orderer（既定順序の定義とタイブレーカー必須ルール） | Typesense, notmuch `--sort` |
| 4.8 | Paginator（`search_after`方式。offset禁止） | ES search_after + PIT |
| 4.9 | Hydrator / Snippet Generator（2段階フェッチ） | Pagefind, Tantivy, FTS5, PG |
| 4.10 | Landing Resolver（着地Messageの決定規則） | notmuch, VS Code |
| 5 | トークナイズ仕様（日本語・正規化範囲・固定パイプライン） | Bleve registry, FTS5 tokenizer API |
| 5.1 | Analyzerバージョニング（変更時は再索引必須） | Lucene Codec, Tantivy meta.json |
| 6.1〜6.6 | インデックス設計（論理・物理2系統・external content・Snapshot・増分更新・ストレージ抽象） | PG FTS, SQLite FTS5, Bleve, Zoekt, Tantivy |
| 7.1 | 決定性の形式的定義（resolved_query ＋ snapshot_id ⇒ 同一結果列） | Bleve "stable view" |
| 7.2 | 決定性を壊す要因の一覧 | Meilisearch非同期, ripgrep暗黙フィルタ, ESオフセット |
| 7.3 | ゴールデンテスト設計 | `CLAUDE.md` 2-7、Meilisearch snapshot tests |
| 8.1 | リクエストスキーマ `{ terms, filters, order, cursor, limit }` | Typesense |
| 8.2 | レスポンススキーマ（Chronicle単位・`matched/total`・landing・軽量ハンドル） | notmuch, Pagefind |
| 8.3 | `resolved_query`の返却（C7の検証手段） | VS Code |
| 8.4 | スキーマバージョニング | notmuch `--format-version=N` |
| 8.5 | ゼロ件時の振る舞い（提案しない・緩めない・再実行しない） | 反面教師: Smart Search |
| 9 | 非採用設計とADR（本資料4章をADR形式で確定） | — |
| 10 | パフォーマンス設計（モバイル前提） | Pagefind, VS Code, Zoekt, ripgrep |
| 11 | 拡張ポイントと禁止領域（将来ベクトル検索等の**隔離条件**） | Bleve KNN, Sourcegraph別トグル |
| 11.1 | 知能の責務分離（抽出 vs 生成） | 本資料6章 |
| 11.2 | Markerパイプラインの実例 | 本資料6章 |
| 12 | 参考リポジトリ・一次資料一覧 | 付録 |

### 執筆順序

1. **3.0（状態遷移図）** — ここから書く。図が固まらないうちに本文を書くと、章が増えるたびに責務がずれる
2. **3.2〜3.3（ScopeとExplorerの境界）** — D1〜D8を確定させる。ここが未決だと4.4が書けない
3. **4.4（Filter）** — 最も重い章。ここが薄いと、憲法は守れても検索は使いにくくなる
4. 残り

---

## 8. この調査で最も強かった発見

**notmuchとPagefind**の2つで、どちらも「有名な検索エンジン」ではない。Lumoraの憲法に
最も近い設計は、大規模検索サーバではなく、**個人が自分のデータを探すための小さなツール**の
側にあった。

そして正直に書いておくべき懸念が1つある。**C5（ランキング禁止）とC3（厳密AND）を同時に
守ると、Chronicleが数千件を超えたとき「一致は多いが、どれから見ればいいか分からない」状態が
発生する。** notmuchはこれをタグと保存済みクエリで解決し、Sourcegraphはフィルタの豊富さで
解決している。

つまり**Lumoraでランキングの代替になるのは「フィルタとタグの設計」**であって、順序の設計ではない。

**ただし付録Xにより、Lumoraはその一般解を採れない。** タグ（Realm/Wing/Tag）は検索条件に
載せないと決めたため、notmuchやSourcegraphと同じ逃げ道が塞がっている。Lumoraが使える手は
現時点で次の3つに限られる：

- `match_count`（一致の濃さを見せる。`search-spec.md` 3-3）
- 採掘状態（未採掘／一部採掘済み。同3-3）
- 期間・source による絞り込み

**これで足りるかは未検証である。** 数千件規模の実データで確かめるまで、この懸念は
解消したことにしない。もし足りないと分かった場合、選択肢は「Realmを条件に入れる（＝付録Xの
再検討）」ではなく、**まずExplorer側（集計・ナビゲーション）を厚くすること**から検討する。

---

## 付録X. Realm / Wing / Tag をフィルタにしない（決定・2026-07-29）

元の調査資料は4.4と7.5で`Realm / タグ / Marker / 期間`をFilterに含めていた。これは
`search-spec.md` 3-1と**正面から衝突する**ため、資料側を修正した。

### 衝突の内容

元資料7.5は先例を較正した上で「どの索引を開くかは外、タグ・日付・フィールドは中」と結論し、
Realmを外・Tagを中に置いた。一方`search-spec.md` 3-1は次のように書いている。

> `realm:` `wing:` `tag:` は**導入しない**。…「フィルタなら対象外原則に触れないのでは」という
> 理屈は成立しない——絞り込みであっても、ユーザーは整理済みの構造を頼りに検索することに
> なるためである。

元資料が採った論法（フィルタなら中に置ける）を、3-1が先回りして否定していた形になる。
D1（Scopeを`resolved_query`に載せる）を採ると逃げ場が無い——接頭辞であれ値であれ、
Realmが検索条件に載る点は同じだからである。

### 決定：3-1を維持する（案A）

`search-spec.md`を変えない。資料の4.4からRealm / Wing / Tagを外し、Filterは
**期間・source・採掘状態**までとする。D8としてScopeにも載せない。

**「Realm内だけ検索したい」という実在するニーズは、検索条件ではなく別の入口
（画面遷移）として解く。** Realmページを開き、その中だけを見る導線にすれば、横断検索（S8）に
Realmを持ち込まずに両立する。横断検索は最後まで「どこにあるか分からないものを掘る場所」で
あり、置き場所が既に分かっているものを見る行為とは別の画面が担う。

この決定は、未決だった「提案C（Realm内検索）」の答えでもある。両者は同じ判断だった。

### `source:` は対象外ではない

`source`は一次情報そのものの属性であり、後から人間が付与した組織化ラベルではない。
実装済み（`src/app/search.tsx`の`sourceFilter`）で、3-1にも抵触しない。

---

## 付録Y. この資料の未確認事項

**トップページ構想が`docs/`に存在しない。** 元資料5章（Explorerの分離根拠）は
「Chronicle/Realm件数、100件での自動発火、件数に応じた幾何学模様」を主要な根拠にしているが、
`docs/`・`CLAUDE.md`のいずれにも記述が無い（2026-07-29時点で確認）。別の場所で検討された
構想と思われる。

**Explorerの分離を`search-engine.md`で確定させる前に、この構想をどこかへ記録すること。**
未記録の構想に依存した結論は、後から検証できない。

---

## 付録Z. 一次資料リンク集

| プロジェクト | 資料 |
|---|---|
| Tantivy | `github.com/quickwit-oss/tantivy` の `ARCHITECTURE.md` / `fulmicoton.com` |
| Bleve | `github.com/blevesearch/bleve` の `index/scorch/README.md` |
| Zoekt | `github.com/sourcegraph/zoekt` の `doc/design.md` |
| Typesense | `github.com/typesense/typesense` の `DESIGN.md` |
| Meilisearch | `github.com/meilisearch/specifications` / `specs.meilisearch.dev` |
| SQLite FTS5 | `sqlite.org/fts5.html` |
| PostgreSQL FTS | `postgresql.org/docs/current/textsearch-tables.html` |
| Lucene | `org.apache.lucene.search` package-summary |
| ripgrep | `github.com/BurntSushi/ripgrep`（README / FAQ / Discussions） |
| Sourcegraph | 検索クエリ言語リファレンス / "Life of a search query" / 3.9リリースノート |
| VS Code | `github.com/microsoft/vscode/wiki/Search-Issues` |
| notmuch | `notmuchmail.org/doc/latest/man7/notmuch-search-terms.html` |
| Pagefind | `pagefind.app` / CloudCannon "Introducing Pagefind" |
