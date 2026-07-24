/**
 * AI利用上限（2026-07-24、原価防御）。
 * 判定はクライアントではなくEdge Functions側で行う（クライアントを改変されても回避できない）。
 * DB側（`check_and_increment_ai_usage`関数、20260724000001マイグレーション）で
 * 加算とチェックを1操作にまとめ、レースコンディションを避けている。
 *
 * 上限値は環境変数 AI_DAILY_LIMIT で調整可能（デフォルト20回/日/関数）。
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

const DEFAULT_DAILY_LIMIT = 20;

export interface UsageCheckResult {
  allowed: boolean;
  currentCount: number;
  limit: number;
}

export async function checkAndIncrementAiUsage(
  supabase: SupabaseClient,
  userId: string,
  functionName: string,
): Promise<UsageCheckResult> {
  const limit = Number(Deno.env.get('AI_DAILY_LIMIT') ?? DEFAULT_DAILY_LIMIT);
  const { data, error } = await supabase
    .rpc('check_and_increment_ai_usage', {
      p_user_id: userId,
      p_function_name: functionName,
      p_daily_limit: limit,
    })
    .single();

  if (error || !data) {
    // 利用回数の記録自体が失敗した場合は、原価防御より可用性を優先してブロックしない
    // （壊れても落ちない方針。Sentryへは呼び出し元でcaptureする）
    throw new Error(`利用上限チェックに失敗: ${error?.message ?? 'no data'}`);
  }

  return { allowed: data.allowed, currentCount: data.current_count, limit };
}
