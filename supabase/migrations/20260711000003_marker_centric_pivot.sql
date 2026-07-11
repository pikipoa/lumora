-- マーカー中心アーキテクチャへの転換（2026-07-11、実データ運用フィードバックによる設計思想転換）
--
-- 背景：実データ運用の結果、「会話全体をAIが分析→人間が確認」ではなく
-- 「人間が横断検索でマーカーを引く→AIはマーカー群を整理するだけ」が正しい情報フローだと判明した。
-- 詳細な経緯・判断はC:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-11 マーカー中心
-- アーキテクチャへの転換」を参照。ピキさんとAskUserQuestionで確認済みの決定：
-- 1. AIによる会話全体からのマーカー自動発見は廃止
-- 2. 会話ごとのAI要約（Summary）機能は廃止 → summariesテーブルを削除
-- 3. Wing（Theme）はMarkerTagで代替 → 新テーブル不要

-- マーカーをRealm（Project）へ直接割り当てる手段。
-- 知識の最小単位がConversationからMarkerへ移ったため、Markerが直接Projectに属する。
alter table markers add column project_id uuid references projects (id) on delete set null;
create index idx_markers_project on markers (project_id);

-- 会話ごとのAI要約機能を廃止（ピキさん承認済み）
drop table if exists summaries;
