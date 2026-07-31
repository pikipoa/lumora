# rejected-decisions.md — 却下した設計案とその理由（生ログ）

運用ルール：新しい却下判断が出たら、整形せずこの下に追記するだけ。定期的な棚卸しはしない。

---

- Beaconの定義を「proposed状態のラベル」→「AIによる関連発見機能」に変更。
  却下理由：同じ言葉で2つの意味を持たせるとユーザーが混乱する（「Beaconってタグ？保存場所？」問題）。
  proposed状態のラベルは代わりにOreとした。

- Theme(Wing)の代替候補：Chapter(チャプター)、Sector(セクター)。
  却下理由：Chapterは物語色が強すぎてゲーム世界観と若干ズレる。Sectorは無機質で
  Arca/Beaconの城・探索系の世界観と噛み合わない。

- ConversationTagを廃止しMarkerTagに一本化する案。
  却下理由：会話全体への大まかな横断検索にも使い道があるため、両方残すことにした。

- タグ体系のBAS Scan機能をPhase1に含める案。
  却下理由：BAS自体が文明監査目的のフレームワークであり、Lumora向けに
  再設計されたバージョンが先に必要。前提タスクが未完了のため保留。

- 有料化モデルとして「14日間トライアル（カード不要、AI整理回数制限）」で全機能を期間限定開放する案。
  却下理由：Lumoraの価値はArcaの蓄積量に比例するため、契約直後（Arcaが数個〜十数個）の
  ユーザーがAI検索を使っても「まだ何も覚えていない」という空虚な体験になりやすく、
  トライアル期間中に価値を実感させるのが構造的に難しい。代わりに機能ゲート型
  （無料＝知識を育てる一式、Pro＝Beaconで育った知識と対話する）を採用した。
  詳細：VISION.md 10章。

- Realm/Wing/Chronicle（および将来的にOre）を、長期利用時の学習コストを下げる目的で
  汎用語（プロジェクト/セクション/会話等）に変更する案。
  却下理由：`unlocks.ts`に実装済みの解放演出（新語を1つずつ教えるDESIGN.md原則7の
  仕組み）が、これらの固有名詞を教えることを前提に作られており、汎用語化すると
  演出自体の存在意義が失われる。代わりに、名前はそのまま維持し各名称に象形的な
  ワンポイントアイコン（Realm=球体/Wing=三角/Chronicle=四角）を追加してタイポグラフィを
  補強する方針を採用した。詳細：VISION.md 8章。

- Evidence OSの憲法を「8原則」（Knowledge First / Human Decides / Immutable Origin /
  Layered Knowledge / Composable Knowledge / Traceable Knowledge / AI Augments, Never Owns /
  Stable Identity）へ**置き換える**案。
  却下理由：8原則は7憲法の改良版ではなく別の軸（7＝AIの**振る舞い**、8＝知識の**構造**）
  だったため、置き換えると軸が1本消える。特にEvidence First（Beaconの実装を縛る唯一の
  条項）とUnknown is Sacred（Compassの存在理由）は構造の原則では代替できない。
  代わりに、憲法を11-1 Behavior Constitution（7条・維持）と11-2 Architecture Principles
  （新規）の2層にし、8原則のうち新規性のあるLayered KnowledgeとStable Identityだけを
  後者へ追加した。詳細：`docs/EVIDENCE-OS.md` 付録D。

- 上記のうち **Composable Knowledge**（`Arca → Wing → Realm`）を原則として採用する案。
  却下理由：現在のER図を条文化してしまう。実際の構造はこの連鎖ではなく、MarkerはRealmへ
  直接割り当てられ（`markers.project_id`）Wingは多対多の**任意**である（Wingを経由しない
  Arcaが正常に存在する）。仮に現構造を正確に書き写しても、スキーマが変わった時に壊れるのが
  実装ではなく憲法の方になる。`docs/future/mission-architecture.md`を隔離したのと同じ判断。

- 横断検索にRealm/Wing/Tagのフィルタ（`realm:` `tag:` 等の接頭辞、またはScope値）を
  導入する案（`search-engine.md`調査資料 4.4／7.5、2026-07-29）。
  却下理由：整理**後**の構造を検索体験へ持ち込むことになり、「未整理を発掘する場所」
  という1章の定義が崩れる。接頭辞かScope値かという形の違いは問わない——絞り込みで
  あっても、ユーザーは整理済みの構造を頼りに検索することになるため。
  「Realm内だけ検索したい」という実在するニーズは、**検索条件ではなく別の入口
  （Realmページを開いてその中を見る画面遷移）**として解決する。これにより
  search-spec.md 3-1を破らずに両立できる。詳細：`search-spec.md` 3-1、
  `docs/future/search-engine-research.md` 付録X。
  なお`source:`は対象外ではない（一次情報そのものの属性であり、後から人間が付与した
  組織化ラベルではないため。実装済み：`src/app/search.tsx`の`sourceFilter`）。
