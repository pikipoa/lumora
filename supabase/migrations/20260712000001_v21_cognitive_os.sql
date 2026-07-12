-- v2.1 認知OSへの改訂（2026-07-12）
-- 詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-12 v2.1 認知OSへの改訂」
-- 5つの知識オブジェクト定義はdocs/data-model.md「0. 設計思想」を正とする。

-- Realm内で自由編集できる表示用本文（文章修正・要約・補足）。
-- quoted_textはChronicle原文として不変に保ち、AIは元知識を参照し続けられる。
-- 表示は edited_text ?? quoted_text。
alter table markers add column edited_text text;

-- AIのWing候補の確度（0〜100）。UI表示は◎（90以上）/○。
-- 将来の学習型自動収納（95%以上のみ自動、「元に戻す」付き）の土台。
alter table marker_wings add column confidence smallint;
