/**
 * アップロードされたファイルの形式自動判定（import-spec.md §6 手順2）。
 * ZIP / 生JSON / Markdown を受け取り、4社のどれかを判定して
 * 各パーサーが必要とする中身（文字列）まで取り出す。
 */

import { unzipSync, strFromU8 } from 'fflate';
import type { DetectResult, ImportFile } from './types';

const ZIP_MAGIC = [0x50, 0x4b]; // "PK"

export function detectFormat(file: ImportFile): DetectResult {
  const lower = file.name.toLowerCase();

  if (isZip(file.bytes)) {
    return detectZip(file);
  }

  if (lower.endsWith('.json')) {
    return detectRawJson(safeDecode(file.bytes), file.name);
  }

  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) {
    return { kind: 'perplexity', markdown: safeDecode(file.bytes), fileName: file.name };
  }

  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return {
      kind: 'unsupported',
      reason: 'HTML形式のエクスポートには対応していません',
      guidance:
        'Google TakeoutでGeminiをエクスポートする場合は、出力形式に「JSON」を指定して再エクスポートしてください。',
    };
  }

  return {
    kind: 'unsupported',
    reason: `対応していないファイル形式です（${file.name}）`,
    guidance:
      '対応形式：ChatGPT/ClaudeのエクスポートZIP（conversations.json）、Google TakeoutのZIP（JSON形式）、PerplexityのMarkdownファイル。',
  };
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === ZIP_MAGIC[0] && bytes[1] === ZIP_MAGIC[1];
}

function detectZip(file: ImportFile): DetectResult {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(file.bytes);
  } catch (e) {
    return {
      kind: 'unsupported',
      reason: `ZIPファイルを展開できませんでした: ${String(e)}`,
      guidance: 'ファイルが破損している可能性があります。再ダウンロードして試してください。',
    };
  }

  const names = Object.keys(entries);

  // --- Google Takeout（Gemini） ---
  // 階層2パターン：Takeout/My Activity/Gemini Apps/MyActivity.json または
  //               Takeout/Gemini Apps/conversation_NNN.json 等（import-spec.md §3）
  const isTakeout = names.some((n) => /^Takeout\//i.test(n));
  if (isTakeout) {
    // 実データ検証（2026-07-11）：日本語ロケールのTakeoutは"Gemini アプリ"（"apps"は付かない）
    // というパス名になるため、"apps"の有無を前提にしない
    const geminiJsons = names.filter((n) => /gemini/i.test(n) && n.toLowerCase().endsWith('.json'));
    if (geminiJsons.length > 0) {
      const warnings: string[] = [];
      const otherProducts = names.filter((n) => /^Takeout\//i.test(n) && !/gemini/i.test(n));
      if (otherProducts.length > 0) {
        warnings.push('Gemini Apps以外のTakeoutデータが含まれています（Gemini Appsのみ取り込みます）');
      }
      return { kind: 'gemini', activityJsons: geminiJsons.map((n) => safeDecode(entries[n])), warnings };
    }

    const geminiHtml = names.some((n) => /gemini/i.test(n) && /\.html?$/i.test(n));
    if (geminiHtml) {
      return {
        kind: 'unsupported',
        reason: 'GeminiのエクスポートがHTML形式になっています',
        guidance: 'Google Takeoutで出力形式に「JSON」を指定して再エクスポートしてください。',
      };
    }

    // 「Gemini」単独（Gems設定）や他製品のみのTakeout（例：マップの保存済みリスト）
    return {
      kind: 'unsupported',
      reason: 'このTakeout ZIPにGemini Appsの会話履歴が含まれていません',
      guidance:
        'Google Takeoutでは「My Activity」→「Gemini Apps」を選択してください（「Gemini」単独はGemsの設定ファイルで、会話履歴ではありません）。',
    };
  }

  // --- ChatGPT / Claude（どちらも conversations.json を含むZIP） ---
  const convEntry = names.find((n) => n.split('/').pop() === 'conversations.json');
  if (convEntry) {
    const json = safeDecode(entries[convEntry]);
    return detectRawJson(json, file.name);
  }

  return {
    kind: 'unsupported',
    reason: 'ZIP内に会話データ（conversations.json / Gemini Apps）が見つかりません',
    guidance:
      'ChatGPT・Claudeは公式エクスポートのZIPをそのまま、GeminiはTakeout（JSON形式）のZIPをアップロードしてください。',
  };
}

/**
 * conversations.json（またはMyActivity.json）の中身から3社を判別する。
 * - ChatGPT：各要素が mapping を持つ
 * - Claude：各要素が chat_messages を持つ
 * - Gemini：各要素が header（"Gemini Apps"等）を持つアクティビティログ
 */
function detectRawJson(json: string, fileName: string): DetectResult {
  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch {
    return {
      kind: 'unsupported',
      reason: `JSONとして読めません（${fileName}）`,
      guidance: 'ファイルが破損しているか、途中で切れている可能性があります。',
    };
  }

  if (Array.isArray(root)) {
    const sample = root.find((x) => x && typeof x === 'object') as Record<string, unknown> | undefined;
    if (!sample) {
      return {
        kind: 'unsupported',
        reason: '会話データが空です',
        guidance: 'エクスポートに会話が含まれているか確認してください。',
      };
    }
    if ('mapping' in sample) return { kind: 'chatgpt', conversationsJson: json };
    if ('chat_messages' in sample) return { kind: 'claude', conversationsJson: json };
    if ('header' in sample || 'title' in sample) {
      return { kind: 'gemini', activityJsons: [json], warnings: [] };
    }
  }

  return {
    kind: 'unsupported',
    reason: `どのAIサービスのエクスポートか判定できませんでした（${fileName}）`,
    guidance:
      '対応形式：ChatGPT/Claudeのconversations.json、GeminiのMyActivity.json（Takeout・JSON形式）。',
  };
}

/** UTF-8デコード（BOM除去） */
function safeDecode(bytes: Uint8Array): string {
  const text = strFromU8(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
