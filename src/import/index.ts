/**
 * インポート層のエントリーポイント。
 * アプリ本体（S1画面）はこの parseImportFile だけを呼ぶ。
 */

import { detectFormat } from './detect';
import { parseChatGpt } from './parsers/chatgpt';
import { parseClaude } from './parsers/claude';
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
      return { ok: true, result: parseChatGpt(detected.conversationsJson) };
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
    case 'perplexity':
      return { ok: true, result: parsePerplexity(detected.markdown, detected.fileName) };
    case 'unsupported':
      return { ok: false, reason: detected.reason, guidance: detected.guidance };
  }
}
