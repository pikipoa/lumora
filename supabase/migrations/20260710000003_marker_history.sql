-- MarkerHistory：マーカーの色/状態遷移の履歴（2026-07-10、ピキさんの明示的な設計指示）
--
-- 設計意図：Lumoraは「知識の変遷」自体に価値を置くプロダクトである。summaries（論点C）は
-- Phase1では上書きのみとしたが、markersは色や却下が変わるたびに履歴行を追加し、
-- 「2026:黄色 → 2027:赤 → 2028:却下」のような変化を後から追えるようにする。
-- 既存のmarkers.color/statusへのUPDATE自体は維持し、marker_historyは追記専用の副次記録とする
-- （markersテーブル自体を履歴化して複雑にはしない）。

create table marker_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  marker_id uuid not null references markers (id) on delete cascade,
  -- そのイベント時点の色・状態（削除＝rejectedの記録時はcolor: null）
  color marker_color,
  status review_status not null,
  changed_at timestamptz not null default now()
);

create index idx_marker_history_marker on marker_history (marker_id, changed_at);

alter table marker_history enable row level security;
create policy "own rows" on marker_history for all using (user_id = auth.uid()) with check (user_id = auth.uid());
