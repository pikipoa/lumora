# PRINCIPLES.md — Lumoraの設計原則

この5つは、Lumoraの全ての機能・実装判断の土台であり、迷った時に立ち返る場所である。
各仕様書（VISION.md / DESIGN.md / data-model.md / CLAUDE.md）に書かれた個別の決定は、
すべてこの原則から導かれている（逆に、この原則と矛盾する決定を見つけたら、
それは原則側ではなく決定側を疑うこと）。

**上位文書**：この5原則のさらに上に`EVIDENCE-OS.md`（設計思想・7つの憲法）がある。
5原則は引き続き**実装判断の窓口**として機能し、7つの憲法がこれを置き換えることはない。
両者の対応関係（7つのうち4つは5原則と実質同一、新しいのは Memory Before Intelligence /
Unknown is Sacred / Silence Is a Feature の3つ）は`EVIDENCE-OS.md`付録Aに記載。

---

## Principle 1

AIは提案者であり、
決定者ではない。

*AIは意味を推測できるが、意味を確定する権利は人間にある（VISION.md 3-2）。Tag/Wingの提案は必ず`proposed → confirmed/rejected`を経て人間が確定し、Markerの自動発見もAIには行わせない（2026-07-11の情報フロー転換、CLAUDE.md）。*

---

## Principle 2

人間の意思は
必ず残す。

*マーカーの色・範囲・状態が変わるたびに`MarkerHistory`へ追記専用で記録する（data-model.md）。人間が下した「確定」「却下」の判断そのものが、消えない記録として残る。*

---

## Principle 3

知識は
破壊しない。

*`rejected`（却下）は論理削除であり、物理削除しない。Wing/Tagの付け外しは、Marker本文を複製・削除しない参照関係（多対多）。「もう要らない」と判断した知識さえ、痕跡として残す。*

---

## Principle 4

根拠へ
戻れる。

*Arca（Marker）の`quoted_text`（原文）は生成された瞬間に固定され、以後不変。編集後の理解（`edited_text`）と原文を分離しているのは、AIも人間も常に一次情報・元のChronicle（会話）へ立ち返れるようにするため。*

---

## Principle 5

AIと人間は
共通言語を持つ。

*Tag（AIの理解構造）とWing（人間の理解構造）は、同じ知識に対する2つの語彙として意図的に対応づけられている。マーカー色の意味登録（`MarkerColorMeaning`）も、色という記号を人間とAIが同じ意味で扱うための仕組み。*
