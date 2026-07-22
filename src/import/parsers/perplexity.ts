/**
 * Perplexity個別スレッドエクスポート（Markdown）、および汎用Markdown/テキスト文書のパーサー。
 *
 * 確定仕様（import-spec.md §5）：Phase1は個別スレッドの手動アップロードのみ。
 * - 引用元URLがフッターノート（[1]: https://... 等）として付くのが特徴 → Message.citations へ
 * - エクスポート形式は非公式で揺れるため、構造が読めない場合は
 *   「ファイル全体を1つのメッセージ」として取り込むフォールバックを持つ
 *
 * 【汎用ドキュメント対応（2026-07-14）】detect.tsは`.md`/`.markdown`/`.txt`拡張子のファイルを
 * すべてこのパーサーへ渡す。実際にPerplexityのQ/A構造（`## 見出し`）が見つかった場合のみ
 * `source: 'perplexity'`とし、見つからなければ`source: 'document'`（汎用メモ・ドキュメント）
 * として取り込む。これにより、例えば外部で作ったロードマップ等のMarkdownファイルも
 * Lumoraへそのままインポートでき、search-spec.md「2章」の「一次情報」原則（ユーザー自身が
 * 作成またはインポートした一次情報は検索対象）にそのまま乗る。検索側の変更は不要
 * （`conversations.title`/`messages.content`を見る既存の横断検索がそのまま拾う）。
 */

import type { ParsedConversation, ParsedMessage, ParseResult, ParseWarning, Source } from '../types';

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
  const sections = splitSections(markdown);

  // 「## 見出し」が1つでも見つかれば実際のPerplexityエクスポートとみなす。見つからなければ
  // Perplexity以外の汎用的なMarkdown/テキスト文書（メモ・ドキュメント等）として扱う
  const hasQaStructure = sections.some((s) => s.heading !== null);
  const source: Source = hasQaStructure ? 'perplexity' : 'document';

  const messages: ParsedMessage[] = [];
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
        // Q/A構造があればAIの回答（assistant）、無ければユーザー自身の文書本文（user）として扱う
        role: hasQaStructure ? 'assistant' : 'user',
        content: body,
        contentFormatLost: true, // Markdown整形をプレーンテキスト扱いにするため
        createdAt: null,
        citations: citations.length > 0 ? citations : null,
      });
    }
  }

  if (!hasQaStructure) {
    warnings.push({
      conversationRef: ref,
      message: 'Q/A構造（見出し）が見つからなかったため、汎用ドキュメントとして取り込みました',
    });
  }

  // 4) フォールバック：本文が1件も復元できなかったら全体を1メッセージに
  if (messages.length === 0) {
    warnings.push({
      conversationRef: ref,
      message: '内容を解釈できなかったため、ファイル全体を1メッセージとして取り込みました',
    });
    messages.push({
      role: 'user',
      content: stripCitationFootnotes(markdown).trim(),
      contentFormatLost: true,
      createdAt: null,
      citations: citations.length > 0 ? citations : null,
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
