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
 * 選択範囲の境界点（Range.startContainer/startOffset）を本文の文字位置に変換する。
 *
 * 【方式：セグメント基準のローカル計算（2026-07-26確定）】
 * 各セグメント要素は自分が本文の何文字目から始まるかを data-seg-start として持つ
 * （computeSegmentsが純粋関数として算出した値。conversation-marker-workspace.tsx で付与）。
 * 境界点の属するセグメントを特定し、「そのセグメントの開始位置＋セグメント内での
 * ローカル文字数」で求める。
 *
 * container全体を一度に数える方式（Range.toString().length）は、DOMのテキストと本文が
 * 1文字でもズレると全体が破綻する。セグメント基準なら、土台になる開始位置は本文由来の
 * 値であり、DOMに依存するのは1セグメント内のローカル位置だけで済む。
 *
 * なお、この方式は一度失敗したが、原因は方式ではなく data-seg-start の値が壊れていた
 * ことだった（render中に変数を加算する実装＋React Compilerにより非単調な値が付与されて
 * いた。詳細：markerLayout.ts の TextSegment.start のコメント）。値を純粋関数側で
 * 確定させたうえで再採用している。
 */
function resolvePointOffset(container: Node, boundaryNode: Node, boundaryOffset: number): number {
  const el =
    boundaryNode.nodeType === Node.TEXT_NODE ? boundaryNode.parentElement : (boundaryNode as Element | null);
  const segEl = el?.closest?.('[data-seg-start]') as HTMLElement | null;

  if (segEl) {
    const segStart = Number(segEl.getAttribute('data-seg-start') ?? '0');
    const localRange = document.createRange();
    localRange.selectNodeContents(segEl);
    // setEndはテキストノード境界（offset＝文字位置）でも要素ノード境界（offset＝子ノード
    // インデックス）でも正しく扱える
    localRange.setEnd(boundaryNode, boundaryOffset);
    return segStart + localRange.toString().length;
  }

  // フォールバック：境界点がセグメントの外（コンテナ直下など）を指している場合。
  // セグメント要素を前から辿り、境界点より手前で終わる最後のセグメントを基準にする。
  const segments = Array.from((container as Element).querySelectorAll?.('[data-seg-start]') ?? []);
  let best: { segStart: number; local: number } | null = null;
  for (const seg of segments) {
    const segRange = document.createRange();
    segRange.selectNodeContents(seg);
    let cmp: number;
    try {
      cmp = segRange.comparePoint(boundaryNode, boundaryOffset);
    } catch {
      continue;
    }
    const segStart = Number(seg.getAttribute('data-seg-start') ?? '0');
    if (cmp === 0) {
      // 境界点はこのセグメントの内側
      const localRange = document.createRange();
      localRange.selectNodeContents(seg);
      localRange.setEnd(boundaryNode, boundaryOffset);
      return segStart + localRange.toString().length;
    }
    if (cmp > 0) {
      // 境界点はこのセグメントより後ろ → 少なくともこのセグメントの末尾までは進んでいる
      best = { segStart, local: (seg.textContent ?? '').length };
    }
  }
  return best ? best.segStart + best.local : 0;
}

export function rangeToOffsets(container: Node, range: Range): { start: number; end: number; text: string } {
  const start = resolvePointOffset(container, range.startContainer, range.startOffset);
  const end = resolvePointOffset(container, range.endContainer, range.endOffset);
  return { start, end, text: range.toString() };
}
