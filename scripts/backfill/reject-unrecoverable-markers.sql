-- 復元不能なマーカーを rejected にする（2026-07-31）
--
-- 対象：start_offsetを持つが、その位置に quoted_text が存在しないマーカー。
-- 「存在しない」の判定は、**quoted_textが現れる全ての位置についてJSオフセットを計算し、
-- 保存された start_offset と一致するものが1つも無いこと**で行う。
--   JSオフセット ＝ 文字位置 ＋ その手前にある4バイト文字（サロゲートペア）の個数
-- Postgresのsubstring()を素で使うとUTF-16との単位差で誤判定するため（CHANGELOG 2026-07-31）。
--
-- 【なぜ却下するのか】
-- これらは context_before を持たない世代で、resolveMarkerPosition の段階2（文脈による訂正）が
-- 効かない。放置すると**間違った場所に色がついたまま永久に直らない**。
--
-- 【物理削除ではない】
-- status を 'rejected' にするだけ。行は残り、marker_history にも遷移を記録する
-- （PRINCIPLES.md Principle 2「人間の意思は必ず残す」／Principle 3「知識は破壊しない」）。
--
-- 【冪等】
-- status <> 'rejected' を条件に含むため、複数回実行しても二重に履歴が増えない。

begin;

-- ------------------------------------------------------------
-- 1) ドライラン：対象の一覧（実行前に必ず目視する）
-- ------------------------------------------------------------
with m2 as (
  select m.id, m.user_id, m.quoted_text, m.start_offset, m.color, m.created_at, msg.content
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is not null
    and m.quoted_text is not null
    and m.quoted_text <> ''
    and m.status <> 'rejected'
)
select id, left(quoted_text, 30) as quoted_head, color, start_offset, created_at
from m2
where not exists (
  select 1 from generate_series(1, length(m2.content)) as p
  where substring(m2.content from p for length(m2.quoted_text)) = m2.quoted_text
    and (p - 1) + (select count(*) from generate_series(1, p - 1) as q
                   where octet_length(substring(m2.content from q for 1)) = 4) = m2.start_offset
)
order by created_at;

-- ------------------------------------------------------------
-- 2) 本体：履歴を残しつつ rejected にする
--    データ変更CTEで1文にまとめている。対象の抽出を2回書くと、その間に
--    集合がずれる可能性があるため（履歴だけ残って本体が変わらない等）。
-- ------------------------------------------------------------
with m2 as (
  select m.id, m.user_id, m.quoted_text, m.start_offset, msg.content
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is not null
    and m.quoted_text is not null
    and m.quoted_text <> ''
    and m.status <> 'rejected'
),
target as (
  select id, user_id
  from m2
  where not exists (
    select 1 from generate_series(1, length(m2.content)) as p
    where substring(m2.content from p for length(m2.quoted_text)) = m2.quoted_text
      and (p - 1) + (select count(*) from generate_series(1, p - 1) as q
                     where octet_length(substring(m2.content from q for 1)) = 4) = m2.start_offset
  )
),
hist as (
  -- user_id は auth.uid() の既定値に頼らず markers から引き継ぐ。
  -- SQL Editor（service role）では auth.uid() が null になり not null 制約に違反するため。
  -- color は null（スキーマのコメントどおり、却下の記録時は色を持たない）
  insert into marker_history (user_id, marker_id, color, status)
  select user_id, id, null, 'rejected' from target
  returning marker_id
)
update markers set status = 'rejected'
where id in (select marker_id from hist);

-- ------------------------------------------------------------
-- 3) 検証：残っている不整合が 0 であること
--    0 でなければ rollback すること
-- ------------------------------------------------------------
with m2 as (
  select m.id, m.quoted_text, m.start_offset, msg.content
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is not null
    and m.quoted_text is not null
    and m.quoted_text <> ''
    and m.status <> 'rejected'
)
select count(*) as remaining_inconsistent
from m2
where not exists (
  select 1 from generate_series(1, length(m2.content)) as p
  where substring(m2.content from p for length(m2.quoted_text)) = m2.quoted_text
    and (p - 1) + (select count(*) from generate_series(1, p - 1) as q
                   where octet_length(substring(m2.content from q for 1)) = 4) = m2.start_offset
);

-- 3) が 0 なら commit、そうでなければ rollback。
-- commit;
-- rollback;
