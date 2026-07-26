/**
 * ブラウザDOM上のオフセット⇄Range変換ユーティリティ（Web専用）。
 * Step6技術スパイクの結論（ブラウザ標準Selection/Range API）に基づく実装で使う。
 * ネイティブ版はWebView内で同等のロジックをJSとして動かす想定（data-model.md参照）。
 *
 * DOM APIに依存するため、jest（jsdom無し）でのユニットテストは対象外とし、
 * ブラウザ実機での動作確認で担保する。
 */

export function offsetsToRange(container: Node, start: number, end: number): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  let cursor = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  while ((node = walker.nextNode() as Text | null)) {
    const len = node.textContent?.length ?? 0;
    if (startNode === null && cursor + len >= start) {
      startNode = node;
      startOffset = Math.max(0, start - cursor);
    }
    if (endNode === null && cursor + len >= end) {
      endNode = node;
      endOffset = Math.max(0, end - cursor);
    }
    if (startNode && endNode) break;
    cursor += len;
  }

  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  return range;
}

/**
 * 選択範囲の境界点を、セグメント自身の開始位置（data-seg-start属性）＋セグメント内の
 * ローカル文字数で解決する。以前はコンテナ全体を一度にRange.toString()で数える方式
 * だったが、マーカー数が多い（＝本文が多数のセグメントに分割される）会話で、実際に
 * 選択した位置と異なる数値が計算される不具合が実機ログで確認された（2026-07-26）。
 * 各セグメントは自分の開始位置をdata-seg-start属性として持つ
 * （conversation-marker-workspace.tsx）ため、境界点の祖先セグメントを見つけて
 * ローカル計算するほうが、セグメント数に依存せず安定する。
 */
function resolvePointOffset(container: Node, node: Node, offset: number): number {
  const el = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)) ?? null;
  const segEl = el?.closest('[data-seg-start]') as HTMLElement | null;
  if (!segEl) {
    // フォールバック：セグメントが見つからない場合は従来通りコンテナ全体で数える
    const preRange = document.createRange();
    preRange.selectNodeContents(container);
    preRange.setEnd(node, offset);
    return preRange.toString().length;
  }
  const segStart = Number(segEl.dataset.segStart ?? '0');
  const localRange = document.createRange();
  localRange.selectNodeContents(segEl);
  localRange.setEnd(node, offset);
  return segStart + localRange.toString().length;
}

export function rangeToOffsets(container: Node, range: Range): { start: number; end: number; text: string } {
  const start = resolvePointOffset(container, range.startContainer, range.startOffset);
  const end = resolvePointOffset(container, range.endContainer, range.endOffset);
  return { start, end, text: range.toString() };
}
