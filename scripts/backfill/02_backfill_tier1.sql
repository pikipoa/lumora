-- start_offset バックフィル：Tier 1（本文中に1回だけ出現するマーカー）
--
-- 前提：01_survey_marker_offsets.sql で件数を確認してから実行すること。
--
-- Tier 1 は quoted_text が本文中にちょうど1回しか出現しないマーカー。
-- 位置が一意に定まるため、推測なしで確定できる（これが「安全」の根拠）。
-- 複数回出現するもの（Tier 2）はこのスクリプトの対象外。SQLだけでは
-- どの出現箇所を指していたか決められないため、意図的に触らない。
--
-- 冪等：start_offset is null のものだけを対象にするので、複数回実行しても
-- 二重更新にならない。
--
-- Postgresのpositionは1始まり、アプリ側のstart_offsetは0始まり（JSのslice互換）
-- のため -1 する。

begin;

-- ------------------------------------------------------------
-- ドライラン：これから更新される件数と、内容のサンプル
-- ------------------------------------------------------------
with tier1 as (
  select
    m.id,
    m.quoted_text,
    position(m.quoted_text in msg.content) - 1 as new_start_offset,
    position(m.quoted_text in msg.content) - 1 + length(m.quoted_text) as new_end_offset
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is null
    and m.status <> 'rejected'
    and m.quoted_text is not null
    and m.quoted_text <> ''
    and (length(msg.content) - length(replace(msg.content, m.quoted_text, ''))) / length(m.quoted_text) = 1
)
select count(*) as will_update_count from tier1;

-- ------------------------------------------------------------
-- 本体：Tier 1 のみ更新
--
-- offsetに加えて前後40文字の文脈も埋める（20260727000001マイグレーションで追加した
-- context_before/context_after）。出現が1回だけなので文脈も一意に定まる。
-- これにより、将来この本文が編集されても文脈から位置を追従できるようになる
-- （src/lib/markerLayout.ts の resolveMarkerPosition）。
-- ------------------------------------------------------------
with tier1 as (
  select
    m.id,
    position(m.quoted_text in msg.content) as pos,          -- 1始まり
    length(m.quoted_text) as qlen,
    msg.content as content
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is null
    and m.status <> 'rejected'
    and m.quoted_text is not null
    and m.quoted_text <> ''
    and (length(msg.content) - length(replace(msg.content, m.quoted_text, ''))) / length(m.quoted_text) = 1
)
update markers m
set start_offset   = t.pos - 1,
    end_offset     = t.pos - 1 + t.qlen,
    context_before = substring(t.content from greatest(1, t.pos - 40) for t.pos - greatest(1, t.pos - 40)),
    context_after  = substring(t.content from t.pos + t.qlen for 40)
from tier1 t
where m.id = t.id;

-- ------------------------------------------------------------
-- 検証：更新後、保存された位置が実際のテキストと一致しているか
-- ここが 0 でなければ commit してはいけない（rollback すること）
-- ------------------------------------------------------------
select count(*) as inconsistent_after_backfill
from markers m
join messages msg on msg.id = m.message_id
where m.start_offset is not null
  and m.end_offset is not null
  and substring(msg.content from m.start_offset + 1 for m.end_offset - m.start_offset) <> m.quoted_text;

-- 上の inconsistent_after_backfill が 0 であることを目視で確認してから：
--   commit;
-- 0 でなければ：
--   rollback;
--
-- ※ Supabase SQL Editor は文をまとめて実行するとトランザクションの途中で
--    止められないことがある。その場合はドライラン部分だけ先に実行して件数を
--    確認し、次に本体＋検証を実行する、という2段階に分けて流すこと。

commit;
