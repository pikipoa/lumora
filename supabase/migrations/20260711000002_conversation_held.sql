-- 会話の「保留」機能（2026-07-11、実データ検証（Gemini 1178件）後のユーザーフィードバックに基づく）
--
-- 実データを一括インポートすると、雑談のような無価値な会話が未分類一覧に大量に混ざり、
-- 見通しが悪くなることが判明した。他のstatus（proposed/confirmed/rejected）と同様、
-- 物理削除ではなく論理的に「隅に追いやる」操作を基本とし、保留一覧から明示的に選んだ場合のみ
-- 物理削除できる2段階の設計にする（CLAUDE.md 2-1の「rejectedは物理削除しない」思想を踏襲）。
--
-- held_at: null = 通常表示、非null = 保留（一覧から除外、保留一覧でのみ表示）

alter table conversations add column held_at timestamptz;

create index idx_conversations_held on conversations (user_id, held_at);
