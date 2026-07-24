/**
 * Perplexity個別スレッドエクスポート（Markdown）、および汎用Markdown/テキスト文書のパーサー。
 *
 * 確定仕様（import-spec.md §5）：Phase1は個別スレッドの手動アップロードのみ。
 *
 * 実データ検証（2026-07-22、実際にエクスポートした1ターン/6ターンの2スレッドで確認）で判明した
 * 実際の構造。旧実装が想定していた「`## 見出し`＝ユーザーの質問」という前提は誤りだった：
 * - 先頭に`<img src="https://r2cdn.perplexity.ai/...">`（Perplexityロゴ）が必ず付く。実エクスポート
 *   かどうかの判定はこのURLの有無（または脚注形式の引用マーカーの有無）で行う。`## 見出し`の有無では
 *   判定できない（汎用文書も`##`を使いうるため、旧実装はこの誤判定を修正した）
 * - フォローアップ質問を含む複数ターンのスレッドは、各ターンが`# 見出し`（H1）で始まり、
 *   ターン同士は`---`（水平線）のみの行で区切られる
 * - `## 見出し`（H2）はAIが自分の回答を整理するために使う小見出しであり、ユーザーの追加質問では
 *   ない（回答本文の一部としてそのまま保持する）
 * - ユーザーの質問文（H1見出し行＋直後の補足行）とAIの回答本文の境界には明示的なマーカーが無い。
 *   実データでは、引用マーカー`[^N_M]`（例：`[^1_1]`）を含む最初の段落からAIの回答が始まる
 *   という一貫したパターンが検証した全12ターンで確認できたため、この境界検出に使う
 *   （マーカーが1つも無いターンは、見出し行のみを質問とし、残り全体を回答として扱う）
 * - 引用URLの定義は`[^N_M]: https://...`（脚注形式）。ターンごとに番号がリセットされる
 *   （`^1_1`〜`^1_19`, `^2_1`…）ため、ターンのブロック単位で抽出すれば自然にスコープが分かれる
 * - 回答末尾に`<span style="display:none">[^N_x]...</span>`（未使用の脚注番号一覧）と
 *   `<div align="center">⁂</div>`（装飾区切り）が付く。どちらも表示上のノイズなので除去する
 * - 旧仕様書が想定していた`[1]: https://...`（連番のみ）形式の引用は今回のデータには存在しなかった
 *   が、後方互換のため抽出パターンとして残す
 */

import type { ParsedConversation, ParsedMessage, ParseResult, ParseWarning, Source } from '../types';

const CITATION_MARKER = /\[\^\d+_\d+\]/;
const PERPLEXITY_SIGNATURE = /r2cdn\.perplexity\.ai|\[\^\d+_\d+\]/;

export function parsePerplexity(markdown: string, fileName: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const ref = fileName;

  if (!markdown.trim()) {
    return {
      source: 'perplexity',
      conversations: [],
      failed: [{ conversationRef: ref, error: 'ファイルが空です' }],
      warnings: [],
    };
  }

  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.(md|markdown|txt)$/i, '');

  // 実Perplexityエクスポートかどうかは、ロゴ画像URLか脚注形式の引用マーカーの有無で判定する
  // （`## 見出し`は汎用文書でも使われうるため判定材料にしない）
  const isPerplexity = PERPLEXITY_SIGNATURE.test(markdown);
  const source: Source = isPerplexity ? 'perplexity' : 'document';

  const messages: ParsedMessage[] = isPerplexity ? parseThreads(markdown) : parseAsDocument(markdown);

  if (!isPerplexity) {
    // ユーザー向けの文言では内部の判定ロジック（Perplexity形式かどうか）に触れない。
    // 単なる個人メモ・ドキュメントのアップロードがほとんどのケースで、そこに無関係な
    // 他社名（Perplexity）が出るとユーザーが混乱するため（2026-07-24、ピキさん実機報告）
    warnings.push({
      conversationRef: ref,
      message: '会話形式ではなく、通常のドキュメントとして取り込みました',
    });
  }

  // フォールバック：本文が1件も復元できなかったら全体を1メッセージに
  if (messages.length === 0) {
    warnings.push({
      conversationRef: ref,
      message: '内容を解釈できなかったため、ファイル全体を1メッセージとして取り込みました',
    });
    messages.push({
      role: 'user',
      content: stripMarkup(markdown).trim(),
      contentFormatLost: true,
      createdAt: null,
      citations: null,
    });
  }

  const conversation: ParsedConversation = {
    source,
    sourceConversationId: null,
    title,
    createdAt: null,
    updatedAt: null,
    model: null,
    messages,
  };

  return { source, conversations: [conversation], failed: [], warnings };
}

/** 汎用Markdown/テキスト文書：先頭の"# タイトル"を除いた全文を1つのuserメッセージとして扱う */
function parseAsDocument(markdown: string): ParsedMessage[] {
  const body = markdown.replace(/^#\s+.+$/m, '').trim();
  if (!body) return [];
  return [
    {
      role: 'user',
      content: body,
      contentFormatLost: true,
      createdAt: null,
      citations: null,
    },
  ];
}

/** Perplexityの実エクスポート構造：`---`でターン分割し、各ターンをuser(質問)+assistant(回答)に復元する */
function parseThreads(markdown: string): ParsedMessage[] {
  const cleaned = stripMarkup(markdown);
  const turnBlocks = cleaned
    .split(/^[ \t]*---[ \t]*$/m)
    .map((t) => t.trim())
    .filter(Boolean);

  const messages: ParsedMessage[] = [];
  for (const block of turnBlocks) {
    const headingMatch = block.match(/^#\s+(.+)$/m);
    const heading = headingMatch ? headingMatch[1].trim() : null;
    const rest = (heading ? block.replace(/^#\s+.+$/m, '') : block).trim();

    const { question, answer } = splitQuestionAndAnswer(rest);
    const userContent = [heading, question].filter((s) => s && s.trim()).join('\n\n').trim();
    if (userContent) {
      messages.push({
        role: 'user',
        content: userContent,
        contentFormatLost: false,
        createdAt: null,
        citations: null,
      });
    }

    if (answer) {
      const citations = extractCitations(block);
      messages.push({
        role: 'assistant',
        content: stripCitationFootnotes(answer).trim(),
        contentFormatLost: true, // Markdown整形をプレーンテキスト扱いにするため
        createdAt: null,
        citations: citations.length > 0 ? citations : null,
      });
    }
  }
  return messages;
}

/**
 * 見出し直後の本文を、質問の補足（question）とAIの回答本文（answer）に分割する。
 * 引用マーカー`[^N_M]`を含む最初の段落からAIの回答が始まるという実データパターンに基づく
 * （マーカーが1つも見つからなければ、境界を判定できないため安全側として本文全体を回答とみなす）。
 */
function splitQuestionAndAnswer(rest: string): { question: string; answer: string } {
  if (!rest.trim()) return { question: '', answer: '' };
  const paragraphs = rest.split(/\n\s*\n/).filter((p) => p.trim());
  const answerStart = paragraphs.findIndex((p) => CITATION_MARKER.test(p));
  if (answerStart === -1) {
    return { question: '', answer: rest.trim() };
  }
  return {
    question: paragraphs.slice(0, answerStart).join('\n\n').trim(),
    answer: paragraphs.slice(answerStart).join('\n\n').trim(),
  };
}

/** ロゴ画像・非表示脚注リスト・装飾区切りなど、表示用ノイズのマークアップを除去する */
function stripMarkup(markdown: string): string {
  return markdown
    .replace(/<img[^>]*>/gi, '')
    .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '')
    .replace(/<div[^>]*>\s*⁂\s*<\/div>/gi, '');
}

function extractCitations(text: string): string[] {
  const urls = new Set<string>();
  // 脚注形式 "[^1_1]: https://..."（実データで確認済み）
  for (const m of text.matchAll(/^\[\^\d+_\d+\]:\s*(https?:\/\/\S+)/gm)) {
    urls.add(m[1]);
  }
  // 旧仕様書が想定していた連番形式 "[1]: https://..."（未確認だが後方互換のため残す）
  for (const m of text.matchAll(/^\[\d+\]:\s*(https?:\/\/\S+)/gm)) {
    urls.add(m[1]);
  }
  // 箇条書き形式 "1. https://..." （Citations/Sourcesセクション想定、未確認だが後方互換のため残す）
  for (const m of text.matchAll(/^\s*\d+\.\s*(https?:\/\/\S+)\s*$/gm)) {
    urls.add(m[1]);
  }
  return [...urls];
}

function stripCitationFootnotes(text: string): string {
  return text
    .replace(/^\[\^\d+_\d+\]:\s*https?:\/\/\S+.*$/gm, '')
    .replace(/^\[\d+\]:\s*https?:\/\/\S+.*$/gm, '')
    .replace(/^\s*\d+\.\s*https?:\/\/\S+\s*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}
