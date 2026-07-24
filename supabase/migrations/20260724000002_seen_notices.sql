-- 一度見せれば十分な案内（Web版の原本キャッシュ非対応など）を、毎回のインポートで
-- 繰り返し表示しないための汎用「既読フラグ」テーブル（2026-07-24）。
--
-- unlock_flags（達成の解放演出）とは目的が異なる（あちらは「知識が育った」祝福、
-- こちらは「一度知れば十分な仕様上の注意書き」）ため、別テーブルとして新設する。
-- notice_keyを増やせば他の一度きり案内にも使い回せる汎用設計。

create table seen_notices (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notice_key text not null,
  seen_at timestamptz not null default now(),
  primary key (user_id, notice_key)
);

alter table seen_notices enable row level security;
create policy "own rows" on seen_notices for all using (user_id = auth.uid()) with check (user_id = auth.uid());
