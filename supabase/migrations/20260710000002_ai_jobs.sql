-- AI処理ジョブ（③要約・タグ提案・重要箇所抽出）のキュー/実行記録
--
-- 実行タイミングは「手動選択」（2026-07-10ピキさん確定）：
-- ユーザーが会話を選んでジョブを投入し、Edge Function (analyze-conversation) が処理する。
-- 1会話の分析全体（Summary + ConversationTag + Marker + MarkerTag）を1ジョブとして扱う。

create type ai_job_status as enum ('queued', 'running', 'done', 'error');

create table ai_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  status ai_job_status not null default 'queued',
  error text,
  -- 生成件数の記録（デバッグ・コスト観測用）
  result_summary jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index idx_ai_jobs_conversation on ai_jobs (conversation_id);
create index idx_ai_jobs_user_status on ai_jobs (user_id, status);

alter table ai_jobs enable row level security;
create policy "own rows" on ai_jobs for all using (user_id = auth.uid()) with check (user_id = auth.uid());
