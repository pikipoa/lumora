/**
 * インポート層のエントリーポイント。
 * アプリ本体（S1画面）はこの parseImportFile だけを呼ぶ。
 */

import { detectFormat } from './detect';
import { parseChatGpt } from './parsers/chatgpt';
import { parseClaude } from './parsers/claude';
import { parseClaudeCode } from './parsers/claudeCode';
import { parseGemini } from './parsers/gemini';
import { parsePerplexity } from './parsers/perplexity';
import type { DetectResult, ImportFile, ParseResult } from './types';

export * from './types';
export { detectFormat };

export type ImportOutcome =
  | { ok: true; result: ParseResult }
  | { ok: false; reason: string; guidance: string };

export function parseImportFile(file: ImportFile): ImportOutcome {
  const detected: DetectResult = detectFormat(file);

  switch (detected.kind) {
    case 'chatgpt':
      return { ok: true, result: parseChatGpt(detected.conversationsJsons) };
    case 'claude':
      return { ok: true, result: parseClaude(detected.conversationsJson) };
    case 'gemini': {
      const result = parseGemini(detected.activityJsons);
      // detect段階の警告（他製品混在等）もまとめてS2で見せる
      for (const w of detected.warnings) {
        result.warnings.unshift({ conversationRef: '(ZIP全体)', message: w });
      }
      return { ok: true, result };
    }
    case 'perplexity': {
      const result = parsePerplexity(detected.markdown, detected.fileName);
      // Perplexity実エクスポート/汎用ドキュメントとも本文に日付情報が無いため、
      // インポート時刻（＝常に「今」になり古いメモほど不自然）ではなく、
      // ファイルの最終更新日時をフォールバックの会話日時として使う
      if (file.lastModified != null) {
        const fallback = new Date(file.lastModified).toISOString();
        for (const conv of result.conversations) {
          conv.createdAt ??= fallback;
          for (const msg of conv.messages) msg.createdAt ??= fallback;
        }
      }
      return { ok: true, result };
    }
    case 'claude_code':
      return { ok: true, result: parseClaudeCode(detected.jsonl, detected.fileName) };
    case 'unsupported':
      return { ok: false, reason: detected.reason, guidance: detected.guidance };
  }
}
