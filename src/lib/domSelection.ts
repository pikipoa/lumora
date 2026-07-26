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
 * 選択範囲の境界点（Range.startContainer/startOffset等）を、containerの先頭からの
 * 文字数へ変換する。offsetsToRangeと対になる処理だが、こちらは逆方向（DOM位置→数値）
 * であるため単純なTreeWalkerの往復では済まない：boundaryNodeがテキストノード自身の
 * 場合と、要素ノード（子要素のインデックスとしてのoffset）の場合の両方があり得る。
 *
 * 以前はcontainer全体、次にセグメント単位でRange.toString()の文字列長を数える方式を
 * 試したが、いずれも実機ログで実際の選択位置と異なる数値が計算されることが確認された
 * （2026-07-26）。Range.toString()による文字列化を経由せず、Range.comparePoint()で
 * 境界点とテキストノードの前後関係を直接判定する、より基礎的な方式に変更する。
 */
function textOffsetAtPoint(container: Node, boundaryNode: Node, boundaryOffset: number, label: string): number {
  // eslint-disable-next-line no-console
  console.log(
    `[marker-debug][textOffsetAtPoint:${label}] 開始: ` +
      JSON.stringify(
        {
          boundaryNodeType: boundaryNode.nodeType,
          boundaryNodeName: boundaryNode.nodeName,
          boundaryNodeText: boundaryNode.textContent,
          boundaryOffset,
        },
        null,
        2,
      ),
  );
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  let cursor = 0;
  let step = 0;
  while ((node = walker.nextNode() as Text | null)) {
    step++;
    if (node === boundaryNode) {
      const result = cursor + boundaryOffset;
      // eslint-disable-next-line no-console
      console.log(
        `[marker-debug][textOffsetAtPoint:${label}] step ${step} 完全一致: ` +
          JSON.stringify({ nodeText: node.textContent, cursor, boundaryOffset, result }, null, 2),
      );
      return result;
    }
    const len = node.textContent?.length ?? 0;
    const nodeRange = document.createRange();
    nodeRange.selectNodeContents(node);
    let cmp: number;
    let cmpError: string | null = null;
    try {
      cmp = nodeRange.comparePoint(boundaryNode, boundaryOffset);
    } catch (e) {
      cmp = 1;
      cmpError = e instanceof Error ? e.message : String(e);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[marker-debug][textOffsetAtPoint:${label}] step ${step}: ` +
        JSON.stringify({ nodeText: node.textContent, len, cursor, cmp, cmpError }, null, 2),
    );
    if (cmp <= 0) {
      // 境界点はこのテキストノードの手前（またはこのノードの範囲内だが自身ではない＝
      // 要素境界がこのノードの直前を指している）にある
      // eslint-disable-next-line no-console
      console.log(`[marker-debug][textOffsetAtPoint:${label}] step ${step}で確定: cursor=${cursor}`);
      return cursor;
    }
    cursor += len;
  }
  // eslint-disable-next-line no-console
  console.log(`[marker-debug][textOffsetAtPoint:${label}] 最後まで到達: cursor=${cursor}, totalSteps=${step}`);
  return cursor;
}

export function rangeToOffsets(container: Node, range: Range): { start: number; end: number; text: string } {
  // eslint-disable-next-line no-console
  console.log(
    '[marker-debug][rangeToOffsets] range境界点: ' +
      JSON.stringify(
        {
          startContainerType: range.startContainer.nodeType,
          startContainerName: range.startContainer.nodeName,
          startContainerText: range.startContainer.textContent,
          startOffset: range.startOffset,
          endContainerType: range.endContainer.nodeType,
          endContainerName: range.endContainer.nodeName,
          endContainerText: range.endContainer.textContent,
          endOffset: range.endOffset,
          rangeToString: range.toString(),
        },
        null,
        2,
      ),
  );
  const start = textOffsetAtPoint(container, range.startContainer, range.startOffset, 'start');
  const end = textOffsetAtPoint(container, range.endContainer, range.endOffset, 'end');
  // eslint-disable-next-line no-console
  console.log('[marker-debug][rangeToOffsets] 最終結果: ' + JSON.stringify({ start, end, text: range.toString() }));
  return { start, end, text: range.toString() };
}
