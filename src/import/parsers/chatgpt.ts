/**
 * ChatGPT公式エクスポート（conversations.json）のパーサー。
 *
 * 特徴（import-spec.md §2）：
 * - mapping というdictに全メッセージノードが入るツリー構造（id/parent/children）
 * - 分岐（regenerate等）がある場合は採用枝を1本選ぶ：current_node から親を遡るのが
 *   「最後に採用された枝」に相当する。current_node が無い場合は最も深いリーフで代替
 * - role: system / tool はUIに出さないため除外
 * - content.parts 以外のcontent_type（code, multimodal等）はテキスト部分のみ拾い
 *   contentFormatLost を立てる
 */

import type {
  ParsedConversation,
  ParsedMessage,
  ParseFailure,
  ParseResult,
  ParseWarning,
} from '../types';

export function parseChatGpt(json: string): ParseResult {
  const conversations: ParsedConversation[] = [];
  const failed: ParseFailure[] = [];
  const warnings: ParseWarning[] = [];

  let root: unknown;
  try {
    root = JSON.parse(json);
  } catch (e) {
    return {
      source: 'chatgpt',
      conversations: [],
      failed: [{ conversationRef: '(ファイル全体)', error: `JSONとして読めません: ${String(e)}` }],
      warnings: [],
    };
  }

  const items = Array.isArray(root) ? root : null;
  if (!items) {
    return {
      source: 'chatgpt',
      conversations: [],
      failed: [{ conversationRef: '(ファイル全体)', error: 'conversations.jsonが配列形式ではありません' }],
      warnings: [],
    };
  }

  items.forEach((item, index) => {
    const ref = refOf(item, index);
    try {
      const conv = parseOneConversation(item, ref, warnings);
      if (conv) conversations.push(conv);
    } catch (e) {
      failed.push({ conversationRef: ref, error: String(e) });
    }
  });

  return { source: 'chatgpt', conversations, failed, warnings };
}

function refOf(item: unknown, index: number): string {
  const o = item as Record<string, unknown> | null;
  const title = typeof o?.title === 'string' ? o.title : null;
  const id =
    typeof o?.conversation_id === 'string' ? o.conversation_id
    : typeof o?.id === 'string' ? o.id
    : null;
  return title ?? id ?? `#${index + 1}`;
}

interface MappingNode {
  id?: unknown;
  parent?: unknown;
  children?: unknown;
  message?: {
    author?: { role?: unknown };
    content?: { content_type?: unknown; parts?: unknown; text?: unknown };
    create_time?: unknown;
    metadata?: { model_slug?: unknown };
  } | null;
}

function parseOneConversation(
  item: unknown,
  ref: string,
  warnings: ParseWarning[],
): ParsedConversation | null {
  const o = item as Record<string, unknown>;
  const mapping = o.mapping as Record<string, MappingNode> | undefined;
  if (!mapping || typeof mapping !== 'object') {
    throw new Error('mapping がありません（ChatGPT形式として不正）');
  }

  // 採用枝の決定：current_node から parent を遡る。無ければ最深リーフから遡る
  const currentNode = typeof o.current_node === 'string' ? o.current_node : findDeepestLeaf(mapping);
  if (!currentNode) {
    throw new Error('会話ツリーの終端ノードが特定できません');
  }
  if (typeof o.current_node !== 'string') {
    warnings.push({ conversationRef: ref, message: 'current_nodeが無いため最深リーフの枝を採用しました' });
  }

  const chain: MappingNode[] = [];
  const seen = new Set<string>();
  let cursor: string | null = currentNode;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const node: MappingNode | undefined = mapping[cursor];
    if (!node) break;
    chain.unshift(node);
    cursor = typeof node.parent === 'string' ? node.parent : null;
  }

  const messages: ParsedMessage[] = [];
  let lastModel: string | null = null;

  for (const node of chain) {
    const msg = node.message;
    if (!msg) continue; // ルート等の空ノード

    const role = msg.author?.role;
    if (role !== 'user' && role !== 'assistant') continue; // system / tool は除外

    const modelSlug = msg.metadata?.model_slug;
    if (typeof modelSlug === 'string' && modelSlug) lastModel = modelSlug;

    const { text, formatLost } = extractContent(msg.content);
    if (!text.trim()) continue; // 空メッセージ（visually_hidden等）は出さない

    messages.push({
      role,
      content: text,
      contentFormatLost: formatLost,
      createdAt: toIso(msg.create_time),
      citations: null,
    });
  }

  if (messages.length === 0) {
    warnings.push({ conversationRef: ref, message: '表示可能なメッセージが0件のためスキップしました' });
    return null;
  }

  const defaultModel = typeof o.default_model_slug === 'string' ? o.default_model_slug : null;

  return {
    source: 'chatgpt',
    sourceConversationId:
      typeof o.conversation_id === 'string' ? o.conversation_id
      : typeof o.id === 'string' ? o.id
      : null,
    title: typeof o.title === 'string' && o.title.trim() ? o.title : '(無題)',
    createdAt: toIso(o.create_time),
    updatedAt: toIso(o.update_time),
    model: lastModel ?? defaultModel,
    messages,
  };
}

/** content_type がtext以外でも、拾えるテキストは拾い、失われた整形は formatLost で申告する */
function extractContent(content: unknown): { text: string; formatLost: boolean } {
  if (!content || typeof content !== 'object') return { text: '', formatLost: false };
  const c = content as { content_type?: unknown; parts?: unknown; text?: unknown };

  if (c.content_type === 'text' && Array.isArray(c.parts)) {
    const strParts = c.parts.filter((p): p is string => typeof p === 'string');
    // 文字列以外のpart（画像等のオブジェクト）が混ざっていたら整形喪失扱い
    return { text: strParts.join('\n'), formatLost: strParts.length !== c.parts.length };
  }
  // code / multimodal_text / thoughts 等：テキスト片だけ回収して整形喪失フラグ
  if (Array.isArray(c.parts)) {
    const strParts = c.parts.filter((p): p is string => typeof p === 'string');
    return { text: strParts.join('\n'), formatLost: true };
  }
  if (typeof c.text === 'string') {
    return { text: c.text, formatLost: true };
  }
  return { text: '', formatLost: true };
}

function findDeepestLeaf(mapping: Record<string, MappingNode>): string | null {
  // childrenを持たないノードのうち、ルートからの深さが最大のものを選ぶ
  const depth = (id: string, guard = 0): number => {
    if (guard > 10000) return guard;
    const parent = mapping[id]?.parent;
    return typeof parent === 'string' && mapping[parent] ? 1 + depth(parent, guard + 1) : 0;
  };
  let best: string | null = null;
  let bestDepth = -1;
  for (const [id, node] of Object.entries(mapping)) {
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length === 0) {
      const d = depth(id);
      if (d > bestDepth) {
        bestDepth = d;
        best = id;
      }
    }
  }
  return best;
}

/** ChatGPTのcreate_timeはunix秒（小数含む） */
function toIso(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v * 1000).toISOString();
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
