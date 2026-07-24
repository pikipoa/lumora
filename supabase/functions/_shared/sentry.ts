/**
 * Edge Function（Deno）用のSentry初期化・エラー捕捉ヘルパー（2026-07-23導入）。
 * クライアント側（src/lib/sentry.ts）と同じPII方針を踏襲する：
 * - マーカー本文（quoted_text）・メモ本文・タグ名等の実データは絶対にSentryへ渡さない
 * - 渡してよいのはID・件数・エラーメッセージ・Edge Function名などのメタ情報のみ
 *
 * SENTRY_DSN未設定時は何もしない（`supabase secrets set SENTRY_DSN=...`で設定）。
 */
import * as Sentry from 'https://deno.land/x/sentry/index.mjs';

const DSN = Deno.env.get('SENTRY_DSN');
let initialized = false;

function ensureInit() {
  if (!DSN || initialized) return;
  Sentry.init({
    dsn: DSN,
    environment: Deno.env.get('SENTRY_ENVIRONMENT') ?? 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
  });
  initialized = true;
}

/**
 * Edge Functionのハンドラをラップし、未捕捉の例外をSentryへ送る（PIIを含まない形で）。
 * 各Edge Function内の`try/catch`で既に捕捉しているエラーは、呼び出し側で
 * `captureEdgeFunctionError`を個別に呼ぶこと（ここはハンドラ全体の保険）。
 */
export function withSentry(
  functionName: string,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  ensureInit();
  return async (req: Request) => {
    try {
      return await handler(req);
    } catch (e) {
      captureEdgeFunctionError(functionName, e, {});
      throw e;
    }
  };
}

/** マーカー本文等を含めず、件数やIDなどのメタ情報のみをcontextとして送る */
export function captureEdgeFunctionError(
  functionName: string,
  error: unknown,
  meta: Record<string, string | number | boolean | null>,
) {
  if (!DSN) return;
  ensureInit();
  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    tags: { edge_function: functionName },
    extra: meta,
  });
}

/**
 * AI利用上限に達した事実だけを記録する（クラッシュではないため`captureException`ではなく
 * `captureMessage`＋warningレベルを使い、Issue一覧で障害と混同しないようにする）。
 */
export function captureQuotaExceeded(functionName: string, userId: string, currentCount: number, limit: number) {
  if (!DSN) return;
  ensureInit();
  Sentry.captureMessage(`AI利用上限に到達: ${functionName}`, {
    level: 'warning',
    tags: { edge_function: functionName, event_type: 'quota_exceeded' },
    extra: { current_count: currentCount, limit },
    user: { id: userId },
  });
}
