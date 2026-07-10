-- Knowledge OS 初期スキーマ（docs/data-model.md 準拠）
--
-- 設計方針：
-- - 全テーブルに user_id + RLS（own rows only）。Phase1は1アカウント運用だが最初から入れる（確定済み判断）
-- - Tag/Marker の status は proposed → confirmed/rejected。rejected は論理削除（物理削除しない）
-- - ImportBatch は data-model.md に無い追加エンティティ（承認済み）：
--   原本ファイルの端末ローカルキャッシュとの紐付け + S2サマリー（成功/失敗件数）の記録先
--
-- 仕様書に無い詳細の実装判断（CLAUDE.md 2-5、影響小・理由明示）：
-- - messages.seq：メッセージの表示順。元データの created_at は null がありうるため順序保証用に必須化
-- - summaries.status に 'rejected' を含める：data-model.md は proposed|confirmed|edited だが、
--   ux-flow-and-screens.md §1-3 の「不要（非表示にする）→ rejected」を実現するために必要
-- - citations は jsonb（URL配列）。将来引用メタデータが増えても後方互換で拡張できる

-- ========== enums ==========
create type source_type as enum ('chatgpt', 'gemini', 'claude', 'perplexity');
create type review_status as enum ('proposed', 'confirmed', 'rejected');
create type summary_status as enum ('proposed', 'confirmed', 'edited', 'rejected');
create type marker_color as enum ('pink', 'green', 'yellow', 'blue', 'red');
create type proposer_type as enum ('ai', 'human');
create type message_role as enum ('user', 'assistant');
create type memo_target_type as enum ('conversation', 'marker');

-- ========== tables ==========

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table themes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Themeは単独では存在しない（data-model.md）
  project_id uuid not null references projects (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source source_type not null,
  file_name text not null,
  imported_at timestamptz not null default now(),
  succeeded_count integer not null default 0,
  failed_count integer not null default 0,
  -- パーサーが返した警告/失敗の詳細（S2サマリー・デバッグ用）
  warnings jsonb not null default '[]'::jsonb,
  failures jsonb not null default '[]'::jsonb
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source source_type not null,
  source_conversation_id text,
  title text not null,
  -- null = 未分類（Inbox）
  project_id uuid references projects (id) on delete set null,
  -- null = プロジェクトには属すがテーマ未割当
  theme_id uuid references themes (id) on delete set null,
  -- 元サービス側の作成/更新日時（取れない場合null）
  created_at timestamptz,
  updated_at timestamptz,
  model text,
  imported_at timestamptz not null default now(),
  import_batch_id uuid references import_batches (id) on delete set null,
  -- 端末ローカルの原本キャッシュへの参照（例：imports_raw/{batch_id}.zip）。クラウドには原本を置かない
  raw_ref text not null default ''
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  role message_role not null,
  content text not null,
  content_format_lost boolean not null default false,
  -- 会話内の表示順（元データのcreated_atはnullがありうるため必須の順序キーを持つ）
  seq integer not null,
  created_at timestamptz,
  -- 引用元URLの配列（Perplexity等）
  citations jsonb,
  unique (conversation_id, seq)
);

create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- "#"はDB上では付けない（表示側で付与）。タグはプロジェクト横断のグローバル存在
  name text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- このプロダクトの思想的な核：AI提案と人間確定を1レコード内で区別する
create table conversation_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  tag_id uuid not null references tags (id) on delete cascade,
  status review_status not null default 'proposed',
  proposed_by proposer_type not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, tag_id)
);

create table markers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  message_id uuid not null references messages (id) on delete cascade,
  -- マーカーを引いた原文の抜粋（proposed時はAIの近似範囲、確定時に人間が調整した範囲で更新）
  quoted_text text not null,
  -- 色の選択＝確定操作そのもの。proposed（AI提案）時はnull、confirmed時は必須
  color marker_color,
  status review_status not null default 'proposed',
  proposed_by proposer_type not null,
  created_at timestamptz not null default now(),
  constraint confirmed_marker_has_color check (status <> 'confirmed' or color is not null)
);

create table memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  target_type memo_target_type not null,
  -- conversation_id または marker_id（target_typeで分岐するポリモーフィック参照のためFKは張らない）
  target_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid not null references conversations (id) on delete cascade,
  body text not null,
  status summary_status not null default 'proposed',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ========== indexes ==========
create index idx_themes_project on themes (project_id);
create index idx_conversations_user_project on conversations (user_id, project_id);
create index idx_conversations_theme on conversations (theme_id);
create index idx_conversations_batch on conversations (import_batch_id);
create index idx_messages_conversation_seq on messages (conversation_id, seq);
create index idx_conversation_tags_conversation on conversation_tags (conversation_id);
create index idx_conversation_tags_tag on conversation_tags (tag_id);
create index idx_markers_conversation on markers (conversation_id);
create index idx_markers_message on markers (message_id);
create index idx_memos_target on memos (target_type, target_id);
create index idx_summaries_conversation on summaries (conversation_id);
-- ⑥横断検索用の全文検索インデックスはここでは張らない（日本語検索方式を⑥着手時に判断）

-- ========== RLS ==========
alter table projects enable row level security;
alter table themes enable row level security;
alter table import_batches enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table tags enable row level security;
alter table conversation_tags enable row level security;
alter table markers enable row level security;
alter table memos enable row level security;
alter table summaries enable row level security;

-- own rows only（全テーブル共通）
create policy "own rows" on projects for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on themes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on import_batches for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on conversations for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on messages for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on tags for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on conversation_tags for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on markers for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on memos for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own rows" on summaries for all using (user_id = auth.uid()) with check (user_id = auth.uid());
