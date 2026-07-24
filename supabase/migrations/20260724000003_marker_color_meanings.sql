-- マーカー色の意味登録（data-model.md「MarkerColorMeaning」、settings-ia.md「4-1」）。
-- 「AIのための機能」ではなく「ユーザー自身の思考ルールを言語化・表現する機能」（VISION.md「1-1」）。
-- 任意登録：未設定でも従来通り色だけで運用できる。色自体は固定（5色）、label/descriptionのみ編集可能。

create table marker_color_meanings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  color text not null check (color in ('pink', 'green', 'yellow', 'blue', 'red')),
  label text not null,
  description text,
  updated_at timestamptz not null default now(),
  unique (user_id, color)
);

alter table marker_color_meanings enable row level security;
create policy "own rows" on marker_color_meanings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
