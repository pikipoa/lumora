# Lumora（ルモラ）

AIとの対話を「消費」から「資産」に変える、知識に光を当てるナレッジOS。
ChatGPT / Gemini / Claude / Perplexity との会話を取り込み、タグ・要約・マーカーで知識資産として蓄積・検索するアプリ。

ブランド命名（Realm/Wing/Chronicle/Ore/Arca）は**UI表示層のみ**に使い、コード・DB層はデータモデル名（Project/Theme/Conversation/proposed/confirmed）のまま実装する（CLAUDE.md参照）。

- 仕様書：[docs/PRINCIPLES.md](docs/PRINCIPLES.md) / [docs/VISION.md](docs/VISION.md) / [docs/import-spec.md](docs/import-spec.md) / [docs/data-model.md](docs/data-model.md) / [docs/ux-flow-and-screens.md](docs/ux-flow-and-screens.md)
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
- **AI分析の実行時（会話一覧の「AI分析」ボタン、手動選択式）**、以下がSupabase Edge Function経由で**Anthropic Claude API（api.anthropic.com）に送信される**：
  - 対象会話のタイトルと全メッセージ本文
  - ユーザーの既存タグ名の一覧（既存タグ優先マッチングのため）
  - それ以外（他の会話・アカウント情報等）は送信されない
- 使用モデルは`claude-sonnet-5`（Edge Function環境変数`LUMORA_AI_MODEL`で切替可能）。APIキーはEdge Functionのsecretとしてサーバー側のみに保存される

## ディレクトリ構成

```
src/import/    インポート層（形式判定＋4社パーサー、純粋TS・アプリ本体から独立）
docs/          プロダクト仕様書
```
