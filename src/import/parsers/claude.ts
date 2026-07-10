/**
 * Claude公式エクスポート（conversations.json）のパーサー。
 *
 * 特徴（import-spec.md §4）：4社中最もフラットで単純。
 * - 配列の各要素：uuid / name / created_at / updated_at / model? / chat_messages[]
 * - chat_messages: sender ("human" | "assistant") / text / created_at
 * - 新しめのエクスポートでは text の代わりに content: [{type:"text", text}] の場合がある
 * - コードブロック等はプレーンテキスト化されている → contentFormatLost は基本 false
 *   （整形情報の喪失は「元からプレーン」なので偽らない。復元不能ブロック検出時のみ true）
 */

import type {
  ParsedConversation,
  ParsedMessage,
  ParseFailure,
  ParseResult,
  ParseWarning,
} from '../types';

export function parseClaude(json: string): ParseResult {
  const conversations: ParsedConversation[] = [];
  const failed: ParseFailure[] = [];
  const warnings: ParseWarning[] = [];

  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (e) {
    return {
      source: 'claude',
      conversations: [],
      failed: [{ conversationRef: '(ファイル全体)', error: `JSONとして読めません: ${String(e)}` }],
      warnings: [],
    };
  }

  if (!Array.isArray(root)) {
    return {
      source: 'claude',
      conversations: [],
      failed: [{ conversationRef: '(ファイル全体)', error: 'conversations.jsonが配列形式ではありません' }],
      warnings: [],
    };
  }

  root.forEach((item, index) => {
    const o = item as Record<string, unknown> | null;
    const ref =
      (typeof o?.name === 'string' && o.name) ||
      (typeof o?.uuid === 'string' && o.uuid) ||
      `#${index + 1}`;
    try {
      const conv = parseOne(o, ref, warnings);
      if (conv) conversations.push(conv);
    } catch (e) {
      failed.push({ conversationRef: ref, error: String(e) });
    }
  });

  return { source: 'claude', conversations, failed, warnings };
}

function parseOne(
  o: Record<string, unknown> | null,
  ref: string,
  warnings: ParseWarning[],
): ParsedConversation | null {
  if (!o || typeof o !== 'object') throw new Error('会話オブジェクトが不正です');

  const rawMessages = Array.isArray(o.chat_messages) ? o.chat_messages : null;
  if (!rawMessages) throw new Error('chat_messages がありません（Claude形式として不正）');

  const messages: ParsedMessage[] = [];
  for (const raw of rawMessages) {
    const m = raw as Record<string, unknown> | null;
    if (!m) continue;

    const sender = m.sender;
    const role = sender === 'human' ? 'user' : sender === 'assistant' ? 'assistant' : null;
    if (!role) {
      warnings.push({ conversationRef: ref, message: `未知のsender "${String(sender)}" をスキップしました` });
      continue;
    }

    const { text, formatLost } = extractText(m);
    if (!text.trim()) continue;

    messages.push({
      role,
      content: text,
      contentFormatLost: formatLost,
      createdAt: toIso(m.created_at),
      citations: null,
    });
  }

  if (messages.length === 0) {
    warnings.push({ conversationRef: ref, message: 'メッセージが0件のためスキップしました' });
    return null;
  }

  return {
    source: 'claude',
    sourceConversationId: typeof o.uuid === 'string' ? o.uuid : null,
    title: typeof o.name === 'string' && o.name.trim() ? o.name : 'Untitled',
    createdAt: toIso(o.created_at),
    updatedAt: toIso(o.updated_at),
    model: typeof o.model === 'string' ? o.model : null,
    messages,
  };
}

function extractText(m: Record<string, unknown>): { text: string; formatLost: boolean } {
  if (typeof m.text === 'string' && m.text) return { text: m.text, formatLost: false };

  // content: [{type:"text", text:"..."}, {type:"tool_use", ...}, ...] 形式
  if (Array.isArray(m.content)) {
    const texts: string[] = [];
    let lost = false;
    for (const block of m.content) {
      const b = block as Record<string, unknown> | null;
      if (b && b.type === 'text' && typeof b.text === 'string') {
        texts.push(b.text);
      } else {
        lost = true; // テキスト以外のブロック（tool_use等）は復元できない
      }
    }
    return { text: texts.join('\n'), formatLost: lost };
  }

  return { text: '', formatLost: false };
}

function toIso(v: unknown): string | null {
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
