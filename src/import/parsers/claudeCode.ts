/**
 * Claude Code CLIのセッション記録（JSONL、1行1イベント）のパーサー。
 *
 * 実データ検証（2026-07-21、実際のローカルセッションファイルで確認済み）で判明したスキーマ：
 * - 1行が1つのJSONイベント。`type`は "user" | "assistant" | "ai-title" | "system" | "mode" |
 *   "queue-operation" | "attachment" | "last-prompt" 等、セッション運営イベントも多数混ざる
 * - `type: "user"`は`message.content`が**文字列なら**実際にユーザーが入力した内容。
 *   `content`が配列（`tool_result`ブロックのみ等）の場合は、ツール実行結果をAPI形式で
 *   返送しているだけでユーザー自身の発言ではないため取り込まない
 * - `type: "assistant"`は`message.content`配列の中の`type: "text"`ブロックのみを回答として
 *   採用する。`type: "thinking"`（内部思考。要約表示や非表示のことがあり本文として不適切）と
 *   `type: "tool_use"`（Bash/Read/Edit等のツール呼び出しパラメータ）は取り込まない
 * - `type: "ai-title"`の`aiTitle`フィールドが会話タイトル（セッション中に複数回更新されるため
 *   最後に出現した値を採用する）
 * - `sessionId`を`sourceConversationId`として保持する
 *
 * 「壊れても落ちない」原則（CLAUDE.md 2-4）：1行のJSON解析に失敗しても無視して続行する。
 * 未知の`type`値（将来Claude Codeのイベント種別が増えても）は単に無視する。
 */

import type { ParsedConversation, ParsedMessage, ParseResult, ParseWarning } from '../types';

interface RawEntry {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  aiTitle?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

export function parseClaudeCode(jsonl: string, fileName: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const ref = fileName;

  if (!jsonl.trim()) {
    return {
      source: 'claude_code',
      conversations: [],
      failed: [{ conversationRef: ref, error: 'ファイルが空です' }],
      warnings: [],
    };
  }

  const lines = jsonl.split(/\r?\n/).filter((l) => l.trim());
  const messages: ParsedMessage[] = [];
  let title: string | null = null;
  let sessionId: string | null = null;
  let parseErrorCount = 0;

  for (const line of lines) {
    let entry: RawEntry;
    try {
      entry = JSON.parse(line);
    } catch {
      parseErrorCount++;
      continue;
    }

    if (entry.sessionId && !sessionId) sessionId = entry.sessionId;

    if (entry.type === 'ai-title' && typeof entry.aiTitle === 'string' && entry.aiTitle.trim()) {
      title = entry.aiTitle.trim();
      continue;
    }

    if (entry.type === 'user' && entry.message) {
      const content = entry.message.content;
      if (typeof content === 'string' && content.trim()) {
        messages.push({
          role: 'user',
          content,
          contentFormatLost: false,
          createdAt: toIso(entry.timestamp),
          citations: null,
        });
      }
      // content配列（tool_result等）はツール実行結果でありユーザー発言ではないため無視
      continue;
    }

    if (entry.type === 'assistant' && entry.message && Array.isArray(entry.message.content)) {
      const textBlocks = (entry.message.content as { type?: string; text?: string }[])
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim())
        .map((b) => b.text as string);
      if (textBlocks.length > 0) {
        messages.push({
          role: 'assistant',
          content: textBlocks.join('\n\n'),
          contentFormatLost: false,
          createdAt: toIso(entry.timestamp),
          citations: null,
        });
      }
      // thinking/tool_useブロックのみ（textブロックが無い）のターンは取り込まない
      continue;
    }
    // system/mode/queue-operation/attachment/last-prompt等はセッション運営の内部イベントであり
    // 会話内容ではないため無視する（将来型が増えても同様に無視される）
  }

  if (parseErrorCount > 0) {
    warnings.push({ conversationRef: ref, message: `${parseErrorCount}行のJSONを解釈できず無視しました` });
  }

  if (messages.length === 0) {
    return {
      source: 'claude_code',
      conversations: [],
      failed: [{ conversationRef: ref, error: '会話として復元できるメッセージが見つかりませんでした' }],
      warnings,
    };
  }

  const conversation: ParsedConversation = {
    source: 'claude_code',
    sourceConversationId: sessionId,
    title: title ?? fileName.replace(/\.jsonl$/i, ''),
    createdAt: messages[0].createdAt,
    updatedAt: messages[messages.length - 1].createdAt,
    model: null,
    messages,
  };

  return { source: 'claude_code', conversations: [conversation], failed: [], warnings };
}

function toIso(v: unknown): string | null {
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
