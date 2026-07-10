/**
 * ③AI処理（要約・タグ提案・重要箇所抽出）の呼び出し口。
 * Edge Function `analyze-conversation` を1会話単位で起動する（手動選択実行）。
 *
 * 【外部送信の明示】この呼び出しにより、対象会話の全メッセージ本文が
 * Supabase Edge Function経由でAnthropic Claude APIに送信される（詳細はREADME）。
 */

import { supabase } from '@/lib/supabase';

export interface AnalyzeResult {
  ok: boolean;
  should_tag?: boolean;
  conversation_tags?: number;
  markers?: number;
  dropped_markers?: number;
  error?: string;
}

export async function analyzeConversation(conversationId: string): Promise<AnalyzeResult> {
  const { data, error } = await supabase.functions.invoke('analyze-conversation', {
    body: { conversation_id: conversationId },
  });
  if (error) {
    // FunctionsHttpErrorの場合、レスポンス本文にエラー詳細が入っている
    let detail = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        const body = await ctx.json();
        if (body?.error) detail = body.error;
      }
    } catch {
      // 本文が読めなければ元のメッセージのまま
    }
    return { ok: false, error: detail };
  }
  return data as AnalyzeResult;
}
