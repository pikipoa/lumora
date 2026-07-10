/**
 * インポート実行サービス（S1画面の裏側）。
 * パース（src/import）→ import_batches作成 → 原本の端末ローカルキャッシュ →
 * conversations/messagesのバッチ挿入 → バッチ集計更新、までを担う。
 *
 * 「壊れても落ちない」原則（CLAUDE.md 2-4）はDB挿入時も維持する：
 * 1会話の挿入失敗は記録してスキップし、全体は止めない。
 */

import { Platform } from 'react-native';

import { parseImportFile } from '@/import';
import type { ImportFile, ParseFailure, ParseWarning, ParsedConversation, Source } from '@/import';
import { supabase } from '@/lib/supabase';

export interface ImportRunSummary {
  batchId: string;
  source: Source;
  fileName: string;
  /** DBに保存できた会話数 */
  succeeded: number;
  /** パース失敗＋DB挿入失敗（S2で件数と内訳を提示） */
  failed: ParseFailure[];
  warnings: ParseWarning[];
  /** 原本のローカルキャッシュ保存先（Web等で保存できなかった場合null） */
  rawCachePath: string | null;
}

export type ImportRunResult =
  | { ok: true; summary: ImportRunSummary }
  | { ok: false; reason: string; guidance: string };

/** 挿入進捗の通知（S1の進捗表示用） */
export type ProgressCallback = (done: number, total: number) => void;

const MESSAGE_INSERT_CHUNK = 200;

export async function runImport(
  file: ImportFile,
  onProgress?: ProgressCallback,
): Promise<ImportRunResult> {
  // 1) 形式判定＋パース
  const outcome = parseImportFile(file);
  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason, guidance: outcome.guidance };
  }
  const { source, conversations, failed, warnings } = outcome.result;

  // 2) インポートバッチ作成（user_idはDB側default auth.uid()）
  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({ source, file_name: file.name })
    .select('id')
    .single();
  if (batchError || !batch) {
    return {
      ok: false,
      reason: `インポートバッチの作成に失敗しました: ${batchError?.message ?? '不明なエラー'}`,
      guidance: 'ログイン状態とネットワーク接続を確認してください。',
    };
  }
  const batchId = batch.id as string;

  // 3) 原本を端末ローカルにキャッシュ（ネイティブのみ。Webはファイルシステムが無いためスキップ）
  const rawCachePath = await cacheRawFile(file, batchId, warnings);

  // 4) 会話・メッセージの挿入（1会話単位で失敗を隔離）
  const dbFailures: ParseFailure[] = [];
  let succeeded = 0;
  for (let i = 0; i < conversations.length; i++) {
    const conv = conversations[i];
    try {
      await insertConversation(conv, batchId, file.name);
      succeeded++;
    } catch (e) {
      dbFailures.push({
        conversationRef: conv.title,
        error: `DB挿入に失敗: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    onProgress?.(i + 1, conversations.length);
  }

  // 5) バッチ集計を更新（S2サマリーのデータソース）
  const allFailures = [...failed, ...dbFailures];
  const { error: updateError } = await supabase
    .from('import_batches')
    .update({
      succeeded_count: succeeded,
      failed_count: allFailures.length,
      warnings,
      failures: allFailures,
    })
    .eq('id', batchId);
  if (updateError) {
    warnings.push({
      conversationRef: '(バッチ集計)',
      message: `集計の保存に失敗しました（インポート自体は完了）: ${updateError.message}`,
    });
  }

  return {
    ok: true,
    summary: {
      batchId,
      source,
      fileName: file.name,
      succeeded,
      failed: allFailures,
      warnings,
      rawCachePath,
    },
  };
}

async function insertConversation(
  conv: ParsedConversation,
  batchId: string,
  fileName: string,
): Promise<void> {
  const { data: row, error } = await supabase
    .from('conversations')
    .insert({
      source: conv.source,
      source_conversation_id: conv.sourceConversationId,
      title: conv.title,
      created_at: conv.createdAt,
      updated_at: conv.updatedAt,
      model: conv.model,
      import_batch_id: batchId,
      import_source_filename: fileName,
      // project_id / theme_id はnull＝未分類（Inbox）でインポートされる
    })
    .select('id')
    .single();
  if (error || !row) throw new Error(error?.message ?? '会話の挿入結果が空です');

  const conversationId = row.id as string;
  const messageRows = conv.messages.map((m, seq) => ({
    conversation_id: conversationId,
    role: m.role,
    content: m.content,
    content_format_lost: m.contentFormatLost,
    seq,
    created_at: m.createdAt,
    citations: m.citations,
  }));

  for (let i = 0; i < messageRows.length; i += MESSAGE_INSERT_CHUNK) {
    const chunk = messageRows.slice(i, i + MESSAGE_INSERT_CHUNK);
    const { error: msgError } = await supabase.from('messages').insert(chunk);
    if (msgError) {
      // 途中失敗した会話は不完全なので、会話ごと消してから失敗として報告する
      // （rejected論理削除の原則はレビュー済みデータの話。取り込み途中の残骸はロールバック扱いでよい）
      await supabase.from('conversations').delete().eq('id', conversationId);
      throw new Error(`メッセージ挿入に失敗（${i}件目以降）: ${msgError.message}`);
    }
  }
}

/**
 * 原本ファイルを imports_raw/{batchId}.{ext} として端末ローカルに保存する。
 * 失敗してもインポート全体は止めない（警告として記録するのみ）。
 */
async function cacheRawFile(
  file: ImportFile,
  batchId: string,
  warnings: ParseWarning[],
): Promise<string | null> {
  if (Platform.OS === 'web') {
    warnings.push({
      conversationRef: '(原本キャッシュ)',
      message:
        'Web版では原本のローカルキャッシュを保存しません（再パースが必要になった場合は再アップロードしてください）',
    });
    return null;
  }
  try {
    // 新FileSystem API（expo-file-system SDK54+）
    const { Directory, File, Paths } = await import('expo-file-system');
    const dir = new Directory(Paths.document, 'imports_raw');
    if (!dir.exists) dir.create({ intermediates: true });
    const ext = extensionOf(file.name);
    const target = new File(dir, `${batchId}${ext}`);
    target.write(file.bytes);
    return target.uri;
  } catch (e) {
    warnings.push({
      conversationRef: '(原本キャッシュ)',
      message: `原本のローカル保存に失敗しました（インポート自体は継続）: ${e instanceof Error ? e.message : String(e)}`,
    });
    return null;
  }
}

function extensionOf(name: string): string {
  const m = name.match(/(\.[A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '.bin';
}
