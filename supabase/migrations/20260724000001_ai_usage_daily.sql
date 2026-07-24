-- AI利用上限（2026-07-24）：organize-markers/organize-wingsの原価防御。
--
-- 設計方針（ピキさん提示）：
-- - 判定場所はクライアントではなくEdge Functions側（クライアントを改変されても回避できない）
-- - 制限対象はPhase1では呼び出し回数のみ（トークン数までは必要になってから拡張）
-- - リセットは日次（UTC日付境界）
-- - 利用回数の記録はSupabaseで管理する（Sentryは制限超過・想定外エラーのみ記録）
--
-- 上限に達した呼び出しもcall_countを増やす（Anthropic API呼び出し前に弾くため追加コストは
-- 発生しない。何度も試みている＝乱用の兆候を記録として残す意図）。

create table ai_usage_daily (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  usage_date date not null default (current_date),
  function_name text not null,
  call_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date, function_name)
);

alter table ai_usage_daily enable row level security;
create policy "own rows" on ai_usage_daily for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Edge Function（service roleクライアント）から呼ぶ、残量チェック＋加算を1操作で行う関数。
-- レースコンディション対策として、加算とチェックを同一SQL文で完結させる。
create or replace function check_and_increment_ai_usage(
  p_user_id uuid,
  p_function_name text,
  p_daily_limit int
) returns table (allowed boolean, current_count int) as $$
declare
  v_count int;
begin
  insert into ai_usage_daily (user_id, usage_date, function_name, call_count)
  values (p_user_id, current_date, p_function_name, 1)
  on conflict (user_id, usage_date, function_name)
  do update set call_count = ai_usage_daily.call_count + 1, updated_at = now()
  returning ai_usage_daily.call_count into v_count;

  return query select (v_count <= p_daily_limit), v_count;
end;
$$ language plpgsql security definer set search_path = public;
