-- 検索結果の表示改善（2026-07-12、ピキさんUXフィードバック）
-- 検索結果の行を「会話された日付・会話元のAI・ユーザーの言葉・AIの回答」の最小表示にするため、
-- RPCの戻り値を拡張する：
-- - created_at：会話された日付（元サービス側。nullならクライアント側でimported_atへフォールバック）
-- - user_text / assistant_text：最初のユーザー発言・最初のAI回答（会話の要旨として表示）
-- - total_chars：会話本文の総文字数（「長い順/短い順」の並び替え用）
--
-- 戻り値の型が変わるため create or replace では置換できず、drop→createで作り直す。

drop function if exists search_conversations(text);

create function search_conversations(search_query text)
returns table (
  id uuid,
  title text,
  source source_type,
  project_id uuid,
  created_at timestamptz,
  imported_at timestamptz,
  user_text text,
  assistant_text text,
  total_chars integer
)
language sql
stable
security invoker
as $$
  select
    c.id,
    c.title,
    c.source,
    c.project_id,
    c.created_at,
    c.imported_at,
    (select m.content from messages m
     where m.conversation_id = c.id and m.role = 'user' order by m.seq limit 1),
    (select m.content from messages m
     where m.conversation_id = c.id and m.role = 'assistant' order by m.seq limit 1),
    (select coalesce(sum(length(m.content)), 0)::integer from messages m
     where m.conversation_id = c.id)
  from conversations c
  where c.title ilike '%' || search_query || '%'
     or exists (
       select 1 from messages m
       where m.conversation_id = c.id and m.content ilike '%' || search_query || '%'
     );
$$;
