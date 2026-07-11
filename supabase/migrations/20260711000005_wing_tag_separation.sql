-- Tag/Wingの役割分離（2026-07-11）
--
-- 背景：Tagは「AIが検索・分類のために使う内部メタデータ」、Wingは「人間が読むための
-- 本の目次・章立て」として役割を完全に分離する。詳細経緯：
-- C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-11 Tag/Wingの役割分離」
--
-- Wingの実体は`themes`テーブルをそのまま使う（VISION.mdの元々のブランド対応
-- 「Theme→Wing」に戻す形。Pivot-4で一時的にMarkerTagで代替する節約実装にしていた）。
-- id/user_id/project_id(not null)/nameという形がそのままWingの定義に合致するため、
-- 新テーブルはicon列の追加とmarker_wings（多対多の中間テーブル）だけで済む。

alter table themes add column icon text;

-- conversations.theme_idは「会話が属するTheme」という旧い意味の列で、Pivot-3/4以降
-- どのコードからも書き込まれていない（grep確認済み）。themesテーブルの意味を
-- 「会話の分類」から「Marker/Realmの章立て」へ転換するため、意味が矛盾する古いFKは残さない。
alter table conversations drop column theme_id;

-- Marker↔Wingは多対多（1つのMarkerが複数のWingに所属できる。「勉強ノートの
-- 『詳しくは第7章』」と同じ参照であり、Marker本文を複製しない）。
-- marker_tagsと全く同じ状態機械（proposed→confirmed/rejected）を踏襲する。
create table marker_wings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  marker_id uuid not null references markers (id) on delete cascade,
  wing_id uuid not null references themes (id) on delete cascade,
  status review_status not null default 'proposed',
  proposed_by proposer_type not null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (marker_id, wing_id)
);

alter table marker_wings enable row level security;
create policy "own rows" on marker_wings for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index idx_marker_wings_marker on marker_wings (marker_id);
create index idx_marker_wings_wing on marker_wings (wing_id);
