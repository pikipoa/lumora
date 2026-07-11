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

export function rangeToOffsets(container: Node, range: Range): { start: number; end: number; text: string } {
  const preRange = document.createRange();
  preRange.selectNodeContents(container);
  preRange.setEnd(range.startContainer, range.startOffset);
  const start = preRange.toString().length;
  const text = range.toString();
  return { start, end: start + text.length, text };
}
