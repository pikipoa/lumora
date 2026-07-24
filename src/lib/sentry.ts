/**
 * Sentry（エラー監視）の初期化とヘルパー（2026-07-23導入、infra.md）。
 *
 * 【PII対策（最重要）】Lumoraは会話・メモという機微なデータを扱うため、以下を徹底する：
 * - `sendDefaultPii: false`（メールアドレス等の自動収集を無効化）
 * - console breadcrumb統合を無効化（コード中のconsole.log等が会話内容を含む可能性を断つ、
 *   最も確実な防御策として個別のログ文言を精査するより統合自体を切る方針を採った）
 * - `beforeSend`/`beforeBreadcrumb`で、万一混入した場合の保険としてもう一段スクラブする
 * - アプリ側のコードでは、Sentryへ渡すcontext/extraに**マーカー本文・メモ本文・検索語**を
 *   直接渡さない（IDや件数、画面名などメタ情報のみ）という規律を必ず守ること
 *
 * DSN未設定（EXPO_PUBLIC_SENTRY_DSN）の場合はinitを呼ばず、Sentryへの送信は行わない
 * （ローカル開発でDSNが無くてもアプリが壊れないようにするため）。
 */
import * as Sentry from '@sentry/react-native';

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const APP_ENV = process.env.EXPO_PUBLIC_APP_ENV ?? 'development';

// Vercelがビルド時に自動注入するコミットSHA（ローカルビルドでは未設定）
const COMMIT_SHA =
  process.env.EXPO_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';

/** 会話・メモ本文が誤って紛れ込んでいないかの簡易チェック（保険。主防御はconsole breadcrumb無効化） */
function looksLikeSensitiveField(key: string): boolean {
  return /quoted_text|edited_text|memo|body|content|query/i.test(key);
}

export function initSentry() {
  if (!DSN) return; // DSN未設定時は何もしない

  Sentry.init({
    dsn: DSN,
    environment: APP_ENV,
    release: `lumora@${require('../../app.json').expo.version}+${COMMIT_SHA.slice(0, 7)}`,
    sendDefaultPii: false,
    // パフォーマンス計測・セッションリプレイはPhase1では収集しない（機微データアプリのため最小限に絞る）
    tracesSampleRate: 0,
    integrations: (defaultIntegrations) =>
      defaultIntegrations.filter((i) => i.name !== 'Console'),
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'console') return null;
      if (breadcrumb.data) {
        for (const key of Object.keys(breadcrumb.data)) {
          if (looksLikeSensitiveField(key)) delete breadcrumb.data[key];
        }
      }
      return breadcrumb;
    },
    beforeSend(event) {
      if (event.extra) {
        for (const key of Object.keys(event.extra)) {
          if (looksLikeSensitiveField(key)) delete event.extra[key];
        }
      }
      if (event.user?.email) delete event.user.email;
      return event;
    },
  });
}

/** ログイン後にユーザーIDのみを紐付ける（メールアドレスは渡さない） */
export function setSentryUser(userId: string | null) {
  Sentry.setUser(userId ? { id: userId } : null);
}

/** 現在表示中の画面（Realm/Chronicle/Wing/Beacon等）をタグとして残す */
export function setSentryRoute(pathname: string) {
  Sentry.setTag('route', pathname);
}

export { Sentry };
