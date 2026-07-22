-- 汎用Markdown/テキスト文書のインポート対応（2026-07-14）
--
-- これまでインポート対象は「4社AIチャットのエクスポート」のみだったが、`.md`/`.txt`拡張子の
-- ファイルは元々Perplexityパーサーへ渡していた（import-spec.md §5）。実際にPerplexityの
-- Q/A構造（`## 見出し`）が見つからない場合、汎用的なメモ・ドキュメントとして取り込めるように
-- パーサー側を拡張したため、そのsource値`document`をDBのenumにも追加する。
--
-- 検索（search-spec.md「2章 一次情報」原則）は`conversations.title`/`messages.content`を
-- 見るだけなので、この変更だけで既存の横断検索がそのまま対象に含める。

alter type source_type add value if not exists 'document';
