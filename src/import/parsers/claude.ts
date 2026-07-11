/**
 * Claude公式エクスポート（conversations.json）のパーサー。
 *
 * 特徴（import-spec.md §4）：4社中最もフラットで単純。
 * - 配列の各要素：uuid / name / created_at / updated_at / model? / chat_messages[]
 * - chat_messages: sender ("human" | "assistant") / text / created_at
 * - 新しめのエクスポートでは text の代わりに content: [{type:"text", text}] の場合がある
 * - コードブロック等はプレーンテキスト化されている → contentFormatLost は基本 false
 *   （整形情報の喪失は「元からプレーン」なので偽らない。復元不能ブロック検出時のみ true）
 *
 * 実データ検証（2026-07-11、52会話・2257メッセージの実エクスポートで確認）で判明した点：
 * - **「フラット」という前提は誤りだった**：chat_messagesには`parent_message_uuid`があり、
 *   編集・再生成による分岐が実在する（52会話中7件で確認）。ChatGPTと同様「採用された1本の枝」
 *   を選ぶ必要がある。Claudeのエクスポートには採用枝を示す明示的なポインタが無いため、
 *   「どの枝にも子として参照されていない葉（＝分岐の末端）のうちcreated_atが最も新しいもの」
 *   を採用枝の終点とみなし、そこから親を遡って1本の経路を再構成する
 * - `attachments[].extracted_content`にテキストファイル添付の中身がそのまま入っている
 *   （70メッセージで確認）。無視すると内容が消えるため本文に統合する
 * - `content[].citations[].details.url`にWeb検索の引用URLが入る（60ブロックで確認）→citationsに反映
 * - `files`（画像等、テキスト抽出不可の添付）はfile_nameが取れる場合のみ参考情報として残す
 * - 会話・メッセージいずれにも`model`フィールドは存在しなかった（常にnull、既知の制約）
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

  const activeMessages = selectActiveBranch(rawMessages, ref, warnings);

  const messages: ParsedMessage[] = [];
  for (const raw of activeMessages) {
    const m = raw as Record<string, unknown> | null;
    if (!m) continue;

    const sender = m.sender;
    const role = sender === 'human' ? 'user' : sender === 'assistant' ? 'assistant' : null;
    if (!role) {
      warnings.push({ conversationRef: ref, message: `未知のsender "${String(sender)}" をスキップしました` });
      continue;
    }

    const { text, formatLost } = extractText(m);
    const attachmentText = extractAttachmentText(m);
    const fullText = [text, attachmentText].filter((t) => t.trim()).join('\n\n');
    if (!fullText.trim()) continue;

    messages.push({
      role,
      content: fullText,
      contentFormatLost: formatLost || !!attachmentText,
      createdAt: toIso(m.created_at),
      citations: extractCitationsAndFiles(m),
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

/**
 * parent_message_uuidによる編集/再生成の分岐から、採用された1本の経路のみを返す。
 * 分岐が無い（またはparent_message_uuidが無い旧形式）場合は元の配列順をそのまま使う。
 */
function selectActiveBranch(rawMessages: unknown[], ref: string, warnings: ParseWarning[]): unknown[] {
  type M = { uuid?: unknown; parent_message_uuid?: unknown; created_at?: unknown };
  const messages = rawMessages as M[];

  const childCount = new Map<string, number>();
  for (const m of messages) {
    const parent = m?.parent_message_uuid;
    if (typeof parent === 'string' && parent) {
      childCount.set(parent, (childCount.get(parent) ?? 0) + 1);
    }
  }
  const hasBranching = [...childCount.values()].some((n) => n > 1);
  if (!hasBranching) return rawMessages;

  const byUuid = new Map<string, M>();
  for (const m of messages) {
    if (typeof m?.uuid === 'string') byUuid.set(m.uuid, m);
  }

  const leaves = messages.filter((m) => typeof m?.uuid === 'string' && !childCount.has(m.uuid as string));
  if (leaves.length === 0) return rawMessages; // 想定外の構造。安全側にフォールバック

  const finalLeaf = leaves.reduce((a, b) => {
    const da = typeof a.created_at === 'string' ? Date.parse(a.created_at) : -Infinity;
    const db = typeof b.created_at === 'string' ? Date.parse(b.created_at) : -Infinity;
    return db > da ? b : a;
  });

  const path: M[] = [];
  const visited = new Set<string>();
  let current: M | undefined = finalLeaf;
  while (current && typeof current.uuid === 'string' && !visited.has(current.uuid)) {
    visited.add(current.uuid);
    path.push(current);
    current = typeof current.parent_message_uuid === 'string' ? byUuid.get(current.parent_message_uuid) : undefined;
  }
  path.reverse();

  const skipped = messages.length - path.length;
  if (skipped > 0) {
    warnings.push({
      conversationRef: ref,
      message: `編集/再生成による分岐を検出し、未採用の${skipped}件を除外しました`,
    });
  }
  return path;
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

/** attachments[].extracted_content（貼付テキストファイルの中身）を本文に統合する分を組み立てる */
function extractAttachmentText(m: Record<string, unknown>): string {
  if (!Array.isArray(m.attachments)) return '';
  const parts: string[] = [];
  for (const raw of m.attachments) {
    const a = raw as Record<string, unknown> | null;
    const content = a && typeof a.extracted_content === 'string' ? a.extracted_content.trim() : '';
    if (!content) continue;
    const name = a && typeof a.file_name === 'string' && a.file_name.trim() ? a.file_name : '添付ファイル';
    parts.push(`[${name}]\n${content}`);
  }
  return parts.join('\n\n');
}

/** content[].citations（Web検索引用URL）とfiles（テキスト抽出不可の添付、ファイル名のみ）を統合する */
function extractCitationsAndFiles(m: Record<string, unknown>): string[] | null {
  const urls: string[] = [];
  if (Array.isArray(m.content)) {
    for (const block of m.content) {
      const b = block as Record<string, unknown> | null;
      if (!b || !Array.isArray(b.citations)) continue;
      for (const c of b.citations) {
        const details = (c as Record<string, unknown> | null)?.details as Record<string, unknown> | null;
        const url = details && typeof details.url === 'string' ? details.url : null;
        if (url && !urls.includes(url)) urls.push(url);
      }
    }
  }

  const fileNotes: string[] = [];
  if (Array.isArray(m.files)) {
    for (const raw of m.files) {
      const f = raw as Record<string, unknown> | null;
      const name = f && typeof f.file_name === 'string' ? f.file_name.trim() : '';
      if (name) fileNotes.push(`添付ファイル: ${name}`);
    }
  }

  const combined = [...urls, ...fileNotes];
  return combined.length > 0 ? combined : null;
}

function toIso(v: unknown): string | null {
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
