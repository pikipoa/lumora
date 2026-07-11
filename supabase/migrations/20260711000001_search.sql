-- ⑥横断検索（S8/S9）の基盤（2026-07-11）
--
-- 実装判断（CLAUDE.md 2-5、Step8着手時に確認・確定）：
-- Postgres標準のtsvector全文検索は日本語の分かち書きに対応しないため使えない。
-- pgroonga（形態素解析ベース）とpg_trgm（トライグラム部分一致）を比較し、pg_trgmを採用した。
-- 理由：pg_trgmはPostgres標準contrib拡張でSupabase上の追加設定が最小限、
-- Phase1の個人利用規模（数百〜数千メッセージ）ではトライグラムの部分一致で十分な検索体験になる。
-- 将来的に検索精度が不足したらpgroongaへの移行を検討する（仕様書「Postgres標準から開始」の趣旨通り）。

create extension if not exists pg_trgm;

create index idx_conversations_title_trgm on conversations using gin (title gin_trgm_ops);
create index idx_messages_content_trgm on messages using gin (content gin_trgm_ops);
create index idx_summaries_body_trgm on summaries using gin (body gin_trgm_ops);

-- 会話タイトル・本文・要約を横断してキーワード検索するRPC。
-- security invokerのためRLS（own rowsのみ参照可）がそのまま適用される。
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
     or exists (
       select 1 from summaries s
       where s.conversation_id = c.id and s.status <> 'rejected' and s.body ilike '%' || search_query || '%'
     )
  order by c.id, c.imported_at desc;
$$;
