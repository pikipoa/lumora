-- start_offset バックフィル：現状把握（読み取りのみ・データは一切変更しない）
--
-- 2026-07-26のマーカー位置ズレ調査（CHANGELOG.md参照）で、markersに
-- start_offset/end_offset を追加した。マイグレーション前に作られた既存マーカーは
-- これがnullで、表示時は quoted_text の indexOf にフォールバックする。
-- 同じ文字列が本文中に複数回出現する場合、常に最初の一致に解決されるため
-- 位置ズレが残る。
--
-- バックフィルはTierに分けて安全性を担保する：
--   Tier 1（出現1回）        → 位置が一意に定まる。自動確定してよい
--   Tier 2（複数回出現）      → SQLだけでは確定できない。周辺文脈での推定が必要
--   Tier 3（本文に見つからない）→ 保留。編集・再インポート等でcontentが変わった可能性
--
-- このファイルは件数を数えるだけ。実際の更新は 02_backfill_tier1.sql で行う。

-- ============================================================
-- 1) 全体像：Tierごとの件数
-- ============================================================
-- 注意：出現回数を replace() の長さ差で数える方法は、重なり合う出現を数え落とす
-- （本文 "あああ" における "ああ" は2箇所あるが1回と判定される）。ここでは
-- 「最初の一致より後ろにもう1つ一致があるか」で一意性を判定する。
with target as (
  select
    m.id,
    m.quoted_text,
    msg.content,
    case
      when m.quoted_text is null or m.quoted_text = '' then 0
      else position(m.quoted_text in msg.content)
    end as pos
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is null
    and m.status <> 'rejected'
),
classified as (
  select
    id,
    case
      when pos = 0 then 'Tier 3（本文に見つからない・保留）'
      when position(quoted_text in substring(content from pos + 1)) = 0 then 'Tier 1（1箇所のみ・offset自動確定可）'
      else 'Tier 2（複数箇所・データからは復元不能）'
    end as tier
  from target
)
select tier, count(*) as marker_count
from classified
group by tier
order by tier;

-- ============================================================
-- 2) Tier 2 の内訳：何回出現するマーカーがどれだけあるか
--    （2回程度なら文脈推定の効果が高い。10回以上なら保留が無難）
-- ============================================================
with target as (
  select
    m.id,
    m.quoted_text,
    (length(msg.content) - length(replace(msg.content, m.quoted_text, ''))) / length(m.quoted_text) as occurrences
  from markers m
  join messages msg on msg.id = m.message_id
  where m.start_offset is null
    and m.status <> 'rejected'
    and m.quoted_text is not null
    and m.quoted_text <> ''
)
select occurrences, count(*) as marker_count
from target
where occurrences > 1
group by occurrences
order by occurrences;

-- ============================================================
-- 3) Tier 3 のサンプル（本文に見つからないもの・最大20件）
--    quoted_textが空／本文が編集された／改行の扱いが違う等の可能性を目視で確認する
-- ============================================================
select
  m.id,
  left(m.quoted_text, 60) as quoted_text_head,
  length(m.quoted_text) as quoted_len,
  length(msg.content) as content_len,
  m.created_at
from markers m
join messages msg on msg.id = m.message_id
where m.start_offset is null
  and m.status <> 'rejected'
  and (m.quoted_text is null or m.quoted_text = '' or position(m.quoted_text in msg.content) = 0)
order by m.created_at desc
limit 20;

-- ============================================================
-- 4) 参考：既にstart_offsetを持つマーカーの健全性チェック
--    保存済みの位置が実際のテキストと一致しているか（1件でも出たら要調査）
-- ============================================================
select count(*) as inconsistent_saved_offsets
from markers m
join messages msg on msg.id = m.message_id
where m.start_offset is not null
  and m.end_offset is not null
  and substring(msg.content from m.start_offset + 1 for m.end_offset - m.start_offset) <> m.quoted_text;
