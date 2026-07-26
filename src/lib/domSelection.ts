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
/** 長いHTML/テキストをログ用に切り詰める */
function trunc(value: string | null | undefined, max = 1200): string | null {
  if (value == null) return null;
  return value.length > max ? value.slice(0, max) + `…(全${value.length}文字)` : value;
}

/**
 * 境界点（startContainer/endContainer）が実際にどんなDOMノードなのかを出力する
 * 調査用ログ（2026-07-26）。nodeType/nodeName/textContent/親要素のouterHTMLに加え、
 * boundaryOffsetがそのノードの文字数（テキストノードの場合）や子ノード数（要素ノードの
 * 場合）に対して妥当な範囲かも判定する。boundaryOffsetの解釈を確定させるためのもの。
 */
function describeBoundary(label: string, node: Node, offset: number): void {
  const isText = node.nodeType === Node.TEXT_NODE;
  const parent = node.parentElement;
  // eslint-disable-next-line no-console
  console.log(
    `[marker-debug][boundary:${label}] ` +
      JSON.stringify(
        {
          nodeType: node.nodeType,
          nodeTypeName: isText ? 'TEXT_NODE' : node.nodeType === Node.ELEMENT_NODE ? 'ELEMENT_NODE' : 'OTHER',
          nodeName: node.nodeName,
          offset,
          textContent: trunc(node.textContent),
          textContentLength: node.textContent?.length ?? null,
          childNodeCount: node.childNodes.length,
          // テキストノードなら offset は文字位置、要素ノードなら子ノードのインデックス。
          // どちらの解釈が妥当かを判定する材料
          offsetLooksLikeCharIndex: isText && offset <= (node.textContent?.length ?? 0),
          offsetLooksLikeChildIndex: !isText && offset <= node.childNodes.length,
          // テキストノードの場合、offset位置の前後の文字（境界がどこを指しているかの確認）
          charsBeforeOffset: isText ? trunc(node.textContent?.slice(Math.max(0, offset - 10), offset), 40) : null,
          charsAfterOffset: isText ? trunc(node.textContent?.slice(offset, offset + 10), 40) : null,
          parentTag: parent?.tagName ?? null,
          parentDataSegStart: parent?.getAttribute?.('data-seg-start') ?? null,
          parentOuterHTML: trunc(parent?.outerHTML),
        },
        null,
        2,
      ),
  );
}

function textOffsetAtPoint(container: Node, boundaryNode: Node, boundaryOffset: number, label: string): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  let cursor = 0;
  let step = 0;
  while ((node = walker.nextNode() as Text | null)) {
    step++;
    // 参照一致したノードだけをログに出す（全ノード列挙はログが膨大になり読めないため）
    if (node === boundaryNode) {
      const result = cursor + boundaryOffset;
      // eslint-disable-next-line no-console
      console.log(
        `[marker-debug][textOffsetAtPoint:${label}] 参照一致（range.${label}Container === node）が true になったノード: ` +
          JSON.stringify(
            {
              step,
              nodeText: trunc(node.textContent),
              nodeTextLength: node.textContent?.length ?? null,
              parentTag: node.parentElement?.tagName ?? null,
              parentDataSegStart: node.parentElement?.getAttribute?.('data-seg-start') ?? null,
              cursorBeforeThisNode: cursor,
              boundaryOffset,
              result,
            },
            null,
            2,
          ),
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
    if (cmp <= 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[marker-debug][textOffsetAtPoint:${label}] 参照一致せずcomparePointで確定（boundaryOffsetは捨てられる）: ` +
          JSON.stringify({ step, nodeText: trunc(node.textContent, 80), cursor, cmp, cmpError, result: cursor }, null, 2),
      );
      return cursor;
    }
    cursor += len;
  }
  // eslint-disable-next-line no-console
  console.log(
    `[marker-debug][textOffsetAtPoint:${label}] 参照一致せず最後まで到達: ` +
      JSON.stringify({ totalSteps: step, result: cursor }),
  );
  return cursor;
}

export function rangeToOffsets(container: Node, range: Range): { start: number; end: number; text: string } {
  describeBoundary('start', range.startContainer, range.startOffset);
  describeBoundary('end', range.endContainer, range.endOffset);
  // DOMのテキスト全体とDBのcontentが一致しているかの確認材料（TreeWalkerが辿る
  // 対象そのものが想定と違っていないかを1行で見る）
  const walkerAll = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let n: Text | null;
  let domText = '';
  let nodeCount = 0;
  while ((n = walkerAll.nextNode() as Text | null)) {
    domText += n.textContent ?? '';
    nodeCount++;
  }
  // eslint-disable-next-line no-console
  console.log(
    '[marker-debug][rangeToOffsets] DOM側テキストの素性: ' +
      JSON.stringify({
        textNodeCount: nodeCount,
        domTextLength: domText.length,
        containerTextContentLength: (container.textContent ?? '').length,
        domTextEqualsContainerTextContent: domText === (container.textContent ?? ''),
        rangeToString: trunc(range.toString(), 200),
        rangeToStringLength: range.toString().length,
      }),
  );
  const start = textOffsetAtPoint(container, range.startContainer, range.startOffset, 'start');
  const end = textOffsetAtPoint(container, range.endContainer, range.endOffset, 'end');
  // eslint-disable-next-line no-console
  console.log(
    '[marker-debug][rangeToOffsets] 最終結果: ' +
      JSON.stringify({
        start,
        end,
        computedLength: end - start,
        text: trunc(range.toString(), 200),
        textLength: range.toString().length,
        lengthMatches: end - start === range.toString().length,
        domTextAtComputedOffsets: trunc(domText.slice(start, end), 200),
      }),
  );
  return { start, end, text: range.toString() };
}
