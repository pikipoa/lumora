-- Pivot-1（20260711000003_marker_centric_pivot.sql）で`summaries`テーブルを削除した際、
-- `search_conversations`RPC（20260711000001_search.sql）内の参照を更新し忘れていたバグの修正。
-- 実行時に`relation "summaries" does not exist`(42P01)で横断検索が全滅していた
-- （進化するホーム画面の検証中に発見）。summariesを参照するOR節を削除するだけで良い
-- （summaries自体はテーブルごと削除済みのため、依存していたidx_summaries_body_trgmも
-- テーブル削除時に自動的に消えている）。

create or replace function search_conversations(search_query text)
returns table (
  id uuid,
  title text,
  source source_type,
  project_id uuid,
  imported_at timestamptz,
  snippet text
)
language sql
stable
security invoker
as $$
  select distinct on (c.id)
    c.id,
    c.title,
    c.source,
    c.project_id,
    c.imported_at,
    coalesce(
      (select m.content from messages m
       where m.conversation_id = c.id and m.content ilike '%' || search_query || '%'
       order by m.seq limit 1),
      c.title
    ) as snippet
  from conversations c
  where c.title ilike '%' || search_query || '%'
     or exists (
       select 1 from messages m
       where m.conversation_id = c.id and m.content ilike '%' || search_query || '%'
     )
  order by c.id, c.imported_at desc;
$$;
