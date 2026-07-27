-- offsetバックフィル：本文中に**1箇所しか無い**マーカーだけが対象（2026-07-27）
--
-- 【文脈は書かない】
-- このスクリプトは start_offset/end_offset だけを埋める。context_before/context_after は
-- **意図的に触らない**。位置情報を持たないマーカーから文脈を作ると、複数箇所ある場合に
-- 誤った文脈を焼き付けてしまい、しかも誤った文脈は自己修復が効かない
-- （resolveMarkerPosition の段階2が、それを信じて自信を持って間違った箇所を選ぶ）。
-- offset のズレは文脈があれば訂正できるが、その逆は成り立たない。
-- 文脈を埋めるのは 02_backfill_context_for_known_offsets.sql（位置が確実なものだけ）。
--
-- 【一意性の判定について】
-- 出現回数を replace() の長さ差で数える方法は、**重なり合う出現を数え落とす**。
-- 例：本文 "あああ" における "??あ" は位置0と1の2箇所にあるが、replace()方式では
-- 1回と判定されてしまう。日本語の繰り返し表現では実際に起こりうる。
-- ここでは「最初の一致より後ろに、もう1つ一致があるか」を直接調べることで、
-- 重なり合う出現も正しく検出する。
--
-- 冪等：start_offset is null のものだけを対象にするので、複数回実行しても安全。

begin;

-- ------------------------------------------------------------
-- ドライラン：対象件数（本文中にちょうど1箇所しか無いもの）
-- ------------------------------------------------------------
with candidate as (
  select
    m.id,
    m.quoted_text,
    msg.content,
    position(m.quoted_text in msg.content) as pos
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is null
    and m.status <> 'rejected'
    and m.quoted_text is not null
    and m.quoted_text <> ''
)
select count(*) as will_update_count
from candidate
where pos > 0
  -- 最初の一致の1文字後ろから探して、もう1つ見つからないこと（重なりも検出できる）
  and position(quoted_text in substring(content from pos + 1)) = 0;

-- ------------------------------------------------------------
-- 本体：offsetのみ更新（文脈は触らない）
-- ------------------------------------------------------------
with unambiguous as (
  select
    m.id,
    position(m.quoted_text in msg.content) as pos,
    length(m.quoted_text) as qlen
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is null
    and m.status <> 'rejected'
    and m.quoted_text is not null
    and m.quoted_text <> ''
    and position(m.quoted_text in msg.content) > 0
    and position(
      m.quoted_text in substring(msg.content from position(m.quoted_text in msg.content) + 1)
    ) = 0
)
update markers m
set start_offset = u.pos - 1,
    end_offset   = u.pos - 1 + u.qlen
from unambiguous u
where m.id = u.id;

-- ------------------------------------------------------------
-- 検証：保存された位置が実際のテキストと一致しているか
-- 0 でなければ rollback すること
-- ------------------------------------------------------------
select count(*) as inconsistent_offsets
from markers m
join messages msg on msg.id = m.message_id
where m.start_offset is not null
  and m.end_offset is not null
  and substring(msg.content from m.start_offset + 1 for m.end_offset - m.start_offset) <> m.quoted_text;

commit;

-- ------------------------------------------------------------
-- 補足：このあと 02_backfill_context_for_known_offsets.sql をもう一度流すと、
-- ここで offset が確定したマーカーにも文脈が付く（位置が一意と確認済みのため安全）。
-- ------------------------------------------------------------
