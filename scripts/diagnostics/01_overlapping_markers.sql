-- 重なり合うマーカーの検出（読み取りのみ・データは一切変更しない）
--
-- 2026-07-31、実機テスト⑤で「赤いマーカーが表示されるが、色を変えても外しても
-- 赤のまま。リロードしても赤のまま」という報告を受けて作成。
--
-- computeSegments（src/lib/markerLayout.ts:131）は区間の重なりを**先勝ち**で解決し、
-- 後から来たマーカーは描画対象から落ちる。したがって同じ場所に2件以上のマーカーが
-- あると、片方を編集・削除しても、もう片方が描画され続けて「変わらない」ように見える。
--
-- さらに、markersの取得クエリに並び順が指定されていないため、
-- どちらが勝つかはロードのたびに変わりうる（＝再現しない不具合になる。2026-07-31修正済み）。
--
-- 【オフセットの単位について・重要】
-- start_offset / end_offset は **JavaScriptのUTF-16コードユニット** 単位である
-- （`content.slice(start, end)` の引数そのもの）。Postgres の substring() /
-- position() は **文字（コードポイント）** 単位なので、両者を混ぜてはいけない。
-- 絵文字はJSで2、Postgresで1と数えられ、ずれる。
--
-- 下記1)はオフセット**どうし**を比較しているだけなので、この違いの影響を受けない
-- （両方とも同じ単位のため）。2)3)はテキスト検索のみで、オフセットを使っていない。
-- **保存済みオフセットで本文を切り出す処理を足す時は、必ず文字位置へ変換すること**
-- （変換方法は scripts/backfill/01_survey_marker_offsets.sql の 4) を参照）。

-- ============================================================
-- 1) 同じメッセージ内で区間が重なっているマーカーの組
--    （両方ともstart_offsetを持つもの）
-- ============================================================
select
  a.message_id,
  a.id            as marker_a,
  a.color         as color_a,
  a.status        as status_a,
  a.start_offset  as start_a,
  a.end_offset    as end_a,
  left(a.quoted_text, 30) as text_a,
  b.id            as marker_b,
  b.color         as color_b,
  b.status        as status_b,
  b.start_offset  as start_b,
  b.end_offset    as end_b,
  left(b.quoted_text, 30) as text_b
from markers a
join markers b
  on a.message_id = b.message_id
 and a.id < b.id                      -- 同じ組を2回出さない
where a.status <> 'rejected'
  and b.status <> 'rejected'
  and a.start_offset is not null
  and b.start_offset is not null
  and a.start_offset < b.end_offset   -- 区間が重なる条件
  and b.start_offset < a.end_offset
order by a.message_id, a.start_offset;

-- ============================================================
-- 2) 引用テキストが同一のマーカーが複数あるもの
--    （start_offsetがnullの旧マーカーも拾う。1)の網から漏れる分）
-- ============================================================
select
  message_id,
  left(quoted_text, 40) as quoted_head,
  count(*)              as marker_count,
  array_agg(color)      as colors,
  array_agg(status)     as statuses,
  array_agg(id)         as marker_ids
from markers
where status <> 'rejected'
  and quoted_text is not null
  and quoted_text <> ''
group by message_id, quoted_text
having count(*) > 1
order by count(*) desc
limit 50;

-- ============================================================
-- 3) 赤（red）のマーカーの一覧
--    報告された症状が「赤が消えない」なので、実体があるかを直接確認する
-- ============================================================
select
  m.id,
  m.status,
  m.color,
  m.start_offset,
  m.end_offset,
  left(m.quoted_text, 40) as quoted_head,
  m.created_at,
  c.title as conversation_title
from markers m
join conversations c on c.id = m.conversation_id
where m.color = 'red'
order by m.created_at desc
limit 30;

-- ============================================================
-- 4) rejected も含めた全件（特定の会話を調べる用）
--    :conversation_id を実際のIDに置き換えて実行する
-- ============================================================
-- select
--   id, status, color, message_id, start_offset, end_offset,
--   left(quoted_text, 40) as quoted_head, created_at
-- from markers
-- where conversation_id = ':conversation_id'
-- order by message_id, start_offset nulls last, created_at;
