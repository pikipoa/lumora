/**
 * Gemini（Google Takeout）のパーサー。
 *
 * 特徴（import-spec.md §3）：
 * - 非公式・非保証。フィールドはすべて存在しない可能性がある前提でパースする
 * - MyActivity.json（一括）と conversation_NNN.json（分割）の両方に対応
 * - HTML形式は対象外（detect側で「JSONで再エクスポートしてください」と案内）
 *
 * 実装判断（CLAUDE.md 2-5、影響小・理由明示）：
 * MyActivity.json はアクティビティの平坦なログで「会話」単位のグルーピングを持たない。
 * そのため Phase1 では 1アクティビティ項目 = 1会話（userプロンプト + 取れれば応答）として
 * 取り込み、応答が取れない項目には warning を残す。実データ検証時に精度を上げる。
 */

import type {
  ParsedConversation,
  ParsedMessage,
  ParseFailure,
  ParseResult,
  ParseWarning,
} from '../types';

export function parseGemini(activityJsons: string[]): ParseResult {
  const conversations: ParsedConversation[] = [];
  const failed: ParseFailure[] = [];
  const warnings: ParseWarning[] = [];

  activityJsons.forEach((json, fileIndex) => {
    let root: unknown;
    try {
      root = JSON.parse(json);
    } catch (e) {
      failed.push({
        conversationRef: `(ファイル${fileIndex + 1})`,
        error: `JSONとして読めません: ${String(e)}`,
      });
      return;
    }

    // パターン1：MyActivity.json（アクティビティ項目の配列）
    if (Array.isArray(root)) {
      root.forEach((item, index) => {
        const ref = `activity#${index + 1}`;
        try {
          const conv = parseActivityItem(item, ref, warnings);
          if (conv) conversations.push(conv);
        } catch (e) {
          failed.push({ conversationRef: ref, error: String(e) });
        }
      });
      return;
    }

    // パターン2：会話ごとの分割ファイル（スキーマ非公開のため汎用的に試みる）
    const ref = `(ファイル${fileIndex + 1})`;
    try {
      const conv = parseConversationFile(root, ref, warnings);
      if (conv) conversations.push(conv);
      else failed.push({ conversationRef: ref, error: '会話として解釈できる構造が見つかりません' });
    } catch (e) {
      failed.push({ conversationRef: ref, error: String(e) });
    }
  });

  return { source: 'gemini', conversations, failed, warnings };
}

/** MyActivity.json の1項目（例：{header:"Gemini Apps", title:"Prompted ...", time, subtitles?}） */
function parseActivityItem(
  item: unknown,
  ref: string,
  warnings: ParseWarning[],
): ParsedConversation | null {
  const o = item as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') throw new Error('アクティビティ項目が不正です');

  // Gemini Apps 以外の製品のアクティビティが混ざっていたらスキップ（警告のみ）
  const header = typeof o.header === 'string' ? o.header : null;
  if (header && !/gemini/i.test(header)) {
    warnings.push({ conversationRef: ref, message: `Gemini以外のアクティビティ("${header}")をスキップしました` });
    return null;
  }

  const rawTitle = typeof o.title === 'string' ? o.title : '';
  // "Prompted <本文>" / 日本語ロケール "「<本文>」というプロンプト..." の両方から本文を推定
  const prompt = extractPrompt(rawTitle);
  if (!prompt.trim()) {
    warnings.push({ conversationRef: ref, message: 'プロンプト本文が取れないためスキップしました' });
    return null;
  }

  const createdAt = toIso(o.time);
  const messages: ParsedMessage[] = [
    {
      role: 'user',
      content: prompt,
      contentFormatLost: false,
      createdAt,
      citations: null,
    },
  ];

  // 応答テキストが取れる場合（subtitles等）。Takeoutでは応答が含まれないことも多い
  const response = extractResponse(o);
  if (response) {
    messages.push({
      role: 'assistant',
      content: response,
      contentFormatLost: true, // Takeout経由の応答は整形情報が信頼できない
      createdAt,
      citations: null,
    });
  } else {
    warnings.push({
      conversationRef: ref,
      message: 'AI側の応答テキストがエクスポートに含まれていません（プロンプトのみ取り込み）',
    });
  }

  return {
    source: 'gemini',
    sourceConversationId: null,
    title: truncateTitle(prompt),
    createdAt,
    updatedAt: null,
    model: null,
    messages,
  };
}

function extractPrompt(title: string): string {
  const en = title.match(/^Prompted\s+(.+)$/s);
  if (en) return en[1];
  const ja = title.match(/^「(.+)」(?:という)?プロンプト/s);
  if (ja) return ja[1];
  // どちらの形式でもない場合はタイトル全体をプロンプト扱い（空なら呼び出し側でスキップ）
  return title;
}

function extractResponse(o: Record<string, unknown>): string | null {
  // subtitles: [{name: "..."}] に応答や補足が入ることがある
  if (Array.isArray(o.subtitles)) {
    const names = o.subtitles
      .map((s) => (s as Record<string, unknown> | null)?.name)
      .filter((n): n is string => typeof n === 'string' && !!n.trim());
    if (names.length > 0) return names.join('\n');
  }
  if (typeof o.details === 'string' && o.details.trim()) return o.details;
  return null;
}

/** 会話ごと分割ファイル用：{messages:[...]} や {role/author, text/content} の並びを汎用的に探す */
function parseConversationFile(
  root: unknown,
  ref: string,
  warnings: ParseWarning[],
): ParsedConversation | null {
  const o = root as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return null;

  const rawMessages = Array.isArray(o.messages) ? o.messages : Array.isArray(o.turns) ? o.turns : null;
  if (!rawMessages) return null;

  const messages: ParsedMessage[] = [];
  for (const raw of rawMessages) {
    const m = raw as Record<string, unknown> | null;
    if (!m) continue;
    const roleRaw = m.role ?? m.author;
    const role =
      roleRaw === 'user' || roleRaw === 'human' ? 'user'
      : roleRaw === 'assistant' || roleRaw === 'model' || roleRaw === 'gemini' ? 'assistant'
      : null;
    const text =
      typeof m.text === 'string' ? m.text
      : typeof m.content === 'string' ? m.content
      : null;
    if (!role || !text?.trim()) {
      warnings.push({ conversationRef: ref, message: '解釈できないメッセージ項目をスキップしました' });
      continue;
    }
    messages.push({
      role,
      content: text,
      contentFormatLost: true,
      createdAt: toIso(m.time ?? m.created_at),
      citations: null,
    });
  }

  if (messages.length === 0) return null;

  const title =
    (typeof o.title === 'string' && o.title.trim()) ? o.title : truncateTitle(messages[0].content);

  return {
    source: 'gemini',
    sourceConversationId: typeof o.id === 'string' ? o.id : null,
    title,
    createdAt: messages[0].createdAt,
    updatedAt: null,
    model: null,
    messages,
  };
}

function truncateTitle(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 50 ? `${oneLine.slice(0, 50)}…` : oneLine || '(無題)';
}

function toIso(v: unknown): string | null {
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
