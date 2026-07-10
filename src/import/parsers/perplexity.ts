/**
 * Perplexity個別スレッドエクスポート（Markdown）のパーサー。
 *
 * 確定仕様（import-spec.md §5）：Phase1は個別スレッドの手動アップロードのみ。
 * - 引用元URLがフッターノート（[1]: https://... 等）として付くのが特徴 → Message.citations へ
 * - エクスポート形式は非公式で揺れるため、構造が読めない場合は
 *   「ファイル全体を1つのassistantメッセージ」として取り込むフォールバックを持つ
 */

import type { ParsedConversation, ParsedMessage, ParseResult, ParseWarning } from '../types';

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

  // 1) フッターノート形式の引用を回収： "[1]: https://..." または "1. https://..."
  const citations = extractCitations(markdown);

  // 2) タイトル：先頭の "# 見出し"、無ければファイル名
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.(md|markdown|txt)$/i, '');

  // 3) Q/A分割：「## 見出し」をユーザー質問、その下の本文をassistant回答として解釈する
  //    （Perplexityの標準的なMarkdownエクスポートは質問が見出し、回答が本文になる）
  const messages: ParsedMessage[] = [];
  const sections = splitSections(markdown);

  for (const section of sections) {
    if (section.heading) {
      messages.push({
        role: 'user',
        content: section.heading,
        contentFormatLost: false,
        createdAt: null,
        citations: null,
      });
    }
    const body = stripCitationFootnotes(section.body).trim();
    if (body) {
      messages.push({
        role: 'assistant',
        content: body,
        contentFormatLost: true, // Markdown整形をプレーンテキスト扱いにするため
        createdAt: null,
        citations: citations.length > 0 ? citations : null,
      });
    }
  }

  // 質問（見出し）が1つも復元できなかった場合は、構造を解釈できていない可能性を申告する
  if (messages.length > 0 && !messages.some((m) => m.role === 'user')) {
    warnings.push({
      conversationRef: ref,
      message: 'Q/A構造（質問見出し）が見つからなかったため、本文を1メッセージとして取り込みました',
    });
  }

  // 4) フォールバック：Q/A構造が読めなかったら全体を1メッセージに
  if (messages.length === 0) {
    warnings.push({
      conversationRef: ref,
      message: 'Q/A構造を解釈できなかったため、ファイル全体を1メッセージとして取り込みました',
    });
    messages.push({
      role: 'assistant',
      content: stripCitationFootnotes(markdown).trim(),
      contentFormatLost: true,
      createdAt: null,
      citations: citations.length > 0 ? citations : null,
    });
  }

  const conversation: ParsedConversation = {
    source: 'perplexity',
    sourceConversationId: null,
    title,
    createdAt: null,
    updatedAt: null,
    model: null,
    messages,
  };

  return { source: 'perplexity', conversations: [conversation], failed: [], warnings };
}

interface Section {
  heading: string | null;
  body: string;
}

/** "## 見出し" で分割。最初の見出しより前の本文（#タイトル除く）も1セクションとして扱う */
function splitSections(markdown: string): Section[] {
  const withoutTitle = markdown.replace(/^#\s+.+$/m, '');
  const lines = withoutTitle.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section = { heading: null, body: '' };

  for (const line of lines) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      if (current.heading !== null || current.body.trim()) sections.push(current);
      current = { heading: h[1].trim(), body: '' };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.heading !== null || current.body.trim()) sections.push(current);
  return sections;
}

function extractCitations(markdown: string): string[] {
  const urls = new Set<string>();
  // フッターノート形式 "[1]: https://..."
  for (const m of markdown.matchAll(/^\[\d+\]:\s*(https?:\/\/\S+)/gm)) {
    urls.add(m[1]);
  }
  // 箇条書き形式 "1. https://..." （Citations/Sourcesセクション想定）
  for (const m of markdown.matchAll(/^\s*\d+\.\s*(https?:\/\/\S+)\s*$/gm)) {
    urls.add(m[1]);
  }
  return [...urls];
}

function stripCitationFootnotes(text: string): string {
  return text
    .replace(/^\[\d+\]:\s*https?:\/\/\S+.*$/gm, '')
    .replace(/^\s*\d+\.\s*https?:\/\/\S+\s*$/gm, '');
}
