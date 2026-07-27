-- 文脈バックフィル：**正しい位置が既に分かっているマーカーだけ**が対象（2026-07-27）
--
-- 前提：20260727000001_marker_context.sql が適用済みであること。
--
-- 【なぜ対象をこう限定するのか】
-- start_offset が null のマーカーから文脈を作ろうとすると、位置情報が無いので結局
-- indexOf に頼ることになる。「Gemini」が3回出てくる本文で、本当は3つ目だったマーカーでも
-- 1つ目から文脈を生成してしまう。しかも offset のズレと違い、**誤った文脈は自己修復が
-- 効かない**：resolveMarkerPosition の段階2が、その誤った文脈を信じて自信を持って
-- 間違った箇所を選び続ける。一度焼き付けると永久に間違ったままになる。
--
-- したがって文脈を生成してよいのは「位置が確実に分かっているマーカー」に限る。
-- ここでは start_offset/end_offset を持ち、かつその位置のテキストが quoted_text と
-- 一致することを確認したものだけを対象にする（＝2026-07-26以降に作られ、保存時の
-- 検証を通過したマーカー）。
--
-- 冪等：context_before が null のものだけを対象にするので、複数回実行しても安全。

begin;

-- ------------------------------------------------------------
-- ドライラン：対象件数
-- ------------------------------------------------------------
select count(*) as will_update_count
from markers m
join messages msg on msg.id = m.message_id
where m.context_before is null
  and m.start_offset is not null
  and m.end_offset is not null
  -- 保存されている位置が実際にquoted_textを指していることを確認（ここが安全性の根拠）
  and substring(msg.content from m.start_offset + 1 for m.end_offset - m.start_offset) = m.quoted_text;

-- ------------------------------------------------------------
-- 本体
-- ------------------------------------------------------------
update markers m
set context_before = substring(
      msg.content
      from greatest(1, m.start_offset + 1 - 40)
      for m.start_offset + 1 - greatest(1, m.start_offset + 1 - 40)
    ),
    context_after = substring(msg.content from m.end_offset + 1 for 40)
from messages msg
where msg.id = m.message_id
  and m.context_before is null
  and m.start_offset is not null
  and m.end_offset is not null
  and substring(msg.content from m.start_offset + 1 for m.end_offset - m.start_offset) = m.quoted_text;

-- ------------------------------------------------------------
-- 検証：生成した文脈が、本文のその位置と実際に一致しているか
-- 0 でなければ rollback すること
-- ------------------------------------------------------------
select count(*) as inconsistent_context
from markers m
join messages msg on msg.id = m.message_id
where m.context_before is not null
  and m.start_offset is not null
  and (
    substring(
      msg.content
      from greatest(1, m.start_offset + 1 - 40)
      for m.start_offset + 1 - greatest(1, m.start_offset + 1 - 40)
    ) <> m.context_before
    or substring(msg.content from m.end_offset + 1 for 40) <> m.context_after
  );

commit;
