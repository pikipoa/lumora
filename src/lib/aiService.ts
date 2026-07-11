/**
 * AI処理の呼び出し口。Edge Function `organize-markers` を、人間が既に確定させた
 * マーカー群（confirmed）に対して起動する（手動選択実行）。
 *
 * 【設計思想の転換（2026-07-11）】旧「会話全体をAIが分析」方式は廃止。
 * AIは「発見するAI」ではなく「（人間が選んだ後に）整理するAI」に役割が変わった。
 * 詳細：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 *
 * 【外部送信の明示】この呼び出しにより、指定したマーカーの引用テキスト・Roleタグ・
 * 所属会話タイトルがSupabase Edge Function経由でAnthropic Claude APIに送信される（詳細はREADME）。
 */

import { supabase } from '@/lib/supabase';

export interface OrganizeMarkersResult {
  ok: boolean;
  markers_processed?: number;
  tags_proposed?: number;
  error?: string;
}

export async function organizeMarkers(markerIds: string[]): Promise<OrganizeMarkersResult> {
  const { data, error } = await supabase.functions.invoke('organize-markers', {
    body: { marker_ids: markerIds },
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
  return data as OrganizeMarkersResult;
}
