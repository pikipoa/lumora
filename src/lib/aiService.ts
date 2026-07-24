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

import { Sentry } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

export interface OrganizeMarkersResult {
  ok: boolean;
  markers_processed?: number;
  tags_proposed?: number;
  error?: string;
}

export async function organizeMarkers(markerIds: string[]): Promise<OrganizeMarkersResult> {
  // breadcrumbにはIDの件数のみ残す（マーカー本文は含めない）
  Sentry.addBreadcrumb({ category: 'ai', message: 'organize-markers 呼び出し開始', data: { count: markerIds.length } });
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
    Sentry.captureException(new Error(`organize-markers failed: ${detail}`), { tags: { edge_function: 'organize-markers' } });
    return { ok: false, error: detail };
  }
  return data as OrganizeMarkersResult;
}

/**
 * Edge Function `organize-wings` — Tag/Wingの役割分離（2026-07-11）の第2段階。
 * organize-markersがTagを付けた「後」に、Realm単位でWing（人間向けの章）へまとめる。
 * 詳細：C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-11 Tag/Wingの役割分離」
 *
 * 【外部送信の明示】このRealmの、Tag済みでWing未割当のマーカーの引用テキスト・Roleタグ・
 * 確定済みTag・所属会話タイトル・既存Wing名一覧がAnthropic Claude APIに送信される。
 */
export interface OrganizeWingsResult {
  ok: boolean;
  markers_processed?: number;
  wings_proposed?: number;
  new_wings_created?: number;
  error?: string;
}

export async function organizeWings(projectId: string): Promise<OrganizeWingsResult> {
  Sentry.addBreadcrumb({ category: 'ai', message: 'organize-wings 呼び出し開始', data: { project_id: projectId } });
  const { data, error } = await supabase.functions.invoke('organize-wings', {
    body: { project_id: projectId },
  });
  if (error) {
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
    Sentry.captureException(new Error(`organize-wings failed: ${detail}`), { tags: { edge_function: 'organize-wings' } });
    return { ok: false, error: detail };
  }
  return data as OrganizeWingsResult;
}
