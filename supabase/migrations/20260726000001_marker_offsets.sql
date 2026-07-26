-- マーカー位置の恒久化（2026-07-26、原因修正）。
-- 従来はquoted_text（文字列）だけを保存し、表示のたびにindexOfで本文から位置を再検索していた。
-- 同一文字列が会話内に複数回出現すると常に最初の出現箇所に解決され、既存マーカーとの重なり
-- 判定（先勝ち）で新しいマーカーの区間が描画されずに消える不具合があった
-- （src/lib/markerLayout.ts locateQuotedText/computeSegments）。
-- Selection APIから作成時点で取得できる正確な位置をそのまま保存し、再検索を不要にする。
-- 既存マーカーはnullのままとし、表示側はstart_offset/end_offsetがあれば優先、
-- 無ければ従来のlocateQuotedTextにフォールバックする（後方互換）。
alter table markers add column start_offset integer;
alter table markers add column end_offset integer;
