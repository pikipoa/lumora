# Knowledge OS

AIとの対話を「消費」から「資産」に変えるナレッジOS。
ChatGPT / Gemini / Claude / Perplexity との会話を取り込み、タグ・要約・マーカーで知識資産として蓄積・検索するアプリ。

- 仕様書：[docs/VISION.md](docs/VISION.md) / [docs/import-spec.md](docs/import-spec.md) / [docs/data-model.md](docs/data-model.md) / [docs/ux-flow-and-screens.md](docs/ux-flow-and-screens.md)
- 実装判断ルール：[CLAUDE.md](CLAUDE.md)

## 技術スタック

- React Native (Expo) — iOS / Android / Web
- Supabase — Postgres + Auth + Storage + Edge Functions

## セットアップ

```bash
npm install

# Supabase接続情報を設定（ダッシュボード → Project Settings → API）
cp .env.example .env   # → 実際のURL/anon keyを記入

npx expo start         # w: Web / a: Android / Expo Goでスマホ実機
```

## テスト

```bash
npm test   # インポートパーサーの単体テスト（jest）
```

## データの扱いについて（重要）

- インポートされた会話データは**Supabase（クラウド）に保存**される
- インポート元の原本ファイル（ZIP/JSON）は**端末ローカルのみ**に保持され、クラウドには送信されない
- AI要約・タグ・重要箇所の生成時には、**会話本文がSupabase Edge Functions経由で外部AI APIに送信される**（対象範囲は該当機能の実装時に本セクションへ明記する）

## ディレクトリ構成

```
src/import/    インポート層（形式判定＋4社パーサー、純粋TS・アプリ本体から独立）
docs/          プロダクト仕様書
```
