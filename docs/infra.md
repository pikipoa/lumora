# infra.md — 開発インフラ（採否判断）

Lumora（旧称：Knowledge OS）

前提：Lumoraは認証必須の個人向けアプリ（Supabase Auth + React Native/Expo Web + Vercel）であり、古着ダンジョン（Shopify公開ストア、不特定多数がアクセス）とは脅威モデル・利用規模が異なる。この違いを踏まえた採否判断。

---

## 採用する

| サービス | 理由 |
|---|---|
| GitHub | Claude Codeでの開発・コード履歴管理に必須 |
| Vercel | Expo Webビルドのホスティング先 |
| Sentry | クライアント側4社パーサー・マーカー範囲調整UIという技術リスクの高い箇所のエラーを可視化するため |

## 見送る（Phase1では不要）

| サービス | 理由 |
|---|---|
| Cloudflare | Vercel・Supabaseがそれぞれ自前でCDN/SSL/基本的なDDoS対策を持っている。公開LP開設や不特定多数の新規登録受付が始まったら再検討 |
| UptimeRobot | 監視対象になる「公開サーバー」が存在しない（SupabaseもVercelも自前でステータス監視を持つマネージドサービス）。監視すべき公開エンドポイントができたら再検討 |
| PostHog | Phase1の実利用者が1人の段階では行動分析の母数がない。App Store/Google Play配信後、他ユーザーが使い始めてから導入 |
| Resend | Supabase Authの組み込みメール機能でPhase1の個人利用には十分。不特定多数へのサインアップ受付段階でメール到達率の問題が出たら乗り換え |
| Better Stack | Sentry+UptimeRobot+ログ管理の統合版。どちらも本格導入していない現時点では時期尚早 |
