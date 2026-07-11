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
 * 取り込み、応答が取れない項目には warning を残す。
 *
 * 実データ検証（2026-07-11、1214件の実エクスポートで確認）で判明した実際のスキーマ：
 * - title は "送信したメッセージ: <本文>"（英語ロケールでは "Prompted <本文>" の可能性、未確認）。
 *   旧実装が想定していた「「〜」というプロンプト」形式は実データに存在しなかった
 * - 応答本文は subtitles ではなく safeHtmlItem[].html（HTML）に入る。複数要素のことがあり、
 *   その場合は連結する。subtitlesは応答が無い場合（Gemini Canvas作成等）のフォールバックとしてのみ使う
 * - 添付ファイルは attachedFiles（ファイル名の配列）で参照される。原本はローカルZIP内にのみ存在し
 *   クラウドには送らない方針（import-spec.md）のため、ファイル名のみcitationsとして記録する
 * - "使用: Gemini アプリ" のような、プロンプトも応答も持たない純粋な起動ログが少数混ざる→スキップ
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

/** MyActivity.json の1項目（実データ例：{header:"Gemini アプリ", title:"送信したメッセージ: ...", time, safeHtmlItem?, subtitles?, attachedFiles?}） */
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
  // 応答を先に取っておく：純粋な使用ログ（"使用: Gemini アプリ"等）かどうかの判定に使う
  const response = extractResponse(o);
  const extractedPrompt = extractPrompt(rawTitle);
  // "送信したメッセージ:"/"Prompted"のどちらの既知パターンにも一致しない場合、
  // 応答があればタイトル全体を説明文として採用（Gemini Canvas作成等）、無ければ使用ログとしてスキップ
  const prompt = extractedPrompt !== null ? extractedPrompt : response ? rawTitle : '';
  if (!prompt.trim()) {
    warnings.push({ conversationRef: ref, message: 'プロンプト本文が取れないためスキップしました（使用ログ等）' });
    return null;
  }

  const createdAt = toIso(o.time);
  const messages: ParsedMessage[] = [
    {
      role: 'user',
      content: prompt,
      contentFormatLost: false,
      createdAt,
      citations: extractAttachments(o),
    },
  ];

  if (response) {
    messages.push({
      role: 'assistant',
      content: response,
      contentFormatLost: true, // HTML→プレーンテキスト変換のため元の整形は失われる
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

/** 既知のプロンプト形式に一致すれば本文を返す。一致しなければnull（呼び出し側でタイトル全体の採用可否を判断） */
function extractPrompt(title: string): string | null {
  const ja = title.match(/^送信したメッセージ:\s*(.+)$/s);
  if (ja) return ja[1];
  // 英語ロケールでの実データは未確認。旧仕様の推測パターンをフォールバックとして残す
  const en = title.match(/^Prompted\s+(.+)$/s);
  if (en) return en[1];
  return null;
}

function extractResponse(o: Record<string, unknown>): string | null {
  // 実データ確認済み：応答本文はsafeHtmlItem[].html（HTML）。複数要素の場合は連結する
  if (Array.isArray(o.safeHtmlItem) && o.safeHtmlItem.length > 0) {
    const texts = o.safeHtmlItem
      .map((item) => (item as Record<string, unknown> | null)?.html)
      .filter((h): h is string => typeof h === 'string' && !!h.trim())
      .map(htmlToPlainText)
      .filter((t) => t.trim());
    if (texts.length > 0) return texts.join('\n\n');
  }
  // safeHtmlItemが無い場合のフォールバック（例：Gemini Canvas作成時はsubtitlesに生成物本体が入る）
  if (Array.isArray(o.subtitles)) {
    const names = o.subtitles
      .map((s) => (s as Record<string, unknown> | null)?.name)
      .filter((n): n is string => typeof n === 'string' && !!n.trim());
    if (names.length > 0) return names.join('\n');
  }
  if (typeof o.details === 'string' && o.details.trim()) return o.details;
  return null;
}

/** attachedFiles（添付ファイル名の配列）をcitations形式で記録する。原本はローカルZIP内のみでクラウドには送らない */
function extractAttachments(o: Record<string, unknown>): string[] | null {
  if (!Array.isArray(o.attachedFiles)) return null;
  const names = o.attachedFiles.filter((n): n is string => typeof n === 'string' && !!n.trim());
  return names.length > 0 ? names.map((n) => `添付ファイル: ${n}`) : null;
}

/**
 * GeminiのsafeHtmlItem.htmlをプレーンテキスト化する（見た目の整形情報は失われる）。
 * 実データ検証（2026-07-11）：応答がHTML/CSSアーティファクト生成（例："〇〇のレポートをHTMLで作成"）の場合、
 * safeHtmlItem.htmlに<style>ブロックごと丸ごと埋め込まれることがあり、タグだけ除去すると
 * CSSの中身がテキストとして残ってしまうため、<style>/<script>はブロックごと除去する。
 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/(p|li|h[1-6]|div|blockquote)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
