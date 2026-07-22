-- Claude Code CLIのセッション記録（JSONL）インポート対応（2026-07-21）
--
-- ユーザー自身がClaude Codeで行った過去のセッション（Bash/Read/Edit等のツール呼び出しを
-- 挟んだエージェント作業ログ）も、`.jsonl`ファイルとしてアップロードすればLumoraへ
-- 取り込めるようにする。実データ検証済みのパーサー：`src/import/parsers/claudeCode.ts`。
--
-- 検索（search-spec.md「2章 一次情報」原則）は`conversations.title`/`messages.content`を
-- 見るだけなので、この変更だけで既存の横断検索がそのまま対象に含める。

alter type source_type add value if not exists 'claude_code';
