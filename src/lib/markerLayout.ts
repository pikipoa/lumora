/**
 * メッセージ本文中のマーカーハイライトを「区間マージ」で計算する純粋関数群。
 * レイヤー（proposed/confirmedマーカー、将来的なBeacon提案等）を追加しても
 * 同じロジックで複数種のハイライトを共存表示できるように設計している。
 */

export interface MarkerLayer {
  id: string;
  start: number;
  end: number;
  kind: 'proposed' | 'confirmed';
  color: string | null;
}

export interface TextSegment {
  text: string;
  layer: MarkerLayer | null;
  /**
   * このセグメントが本文（content）の何文字目から始まるか。
   *
   * 【なぜ純粋関数側で持つのか（2026-07-26）】以前は呼び出し側（Reactのrender内）で
   * `let cursor = 0` を宣言し、segments.map()の中で加算しながら求めていた。しかし
   * このプロジェクトはReact Compilerが有効（app.json の reactCompiler: true）で、
   * JSXの部分木やコールバックがメモ化され一部だけ再評価されるため、render中に
   * 外側の変数を書き換えるこのパターンは値が壊れる。実際にDOMへ付与された
   * data-seg-startがDOM順で単調増加せず（358 → 369 → 363）、これを土台にした
   * 座標計算が誤った位置を返していた。offsetは副作用のない純粋関数の中で
   * 確定させ、呼び出し側は読み取るだけにする。
   */
  start: number;
  /** このセグメントが本文（content）の何文字目の直前で終わるか（sliceのendと同じ） */
  end: number;
}

export function computeSegments(content: string, layers: MarkerLayer[]): TextSegment[] {
  if (layers.length === 0) return [{ text: content, layer: null, start: 0, end: content.length }];

  const sorted = [...layers].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const layer of sorted) {
    const start = Math.max(layer.start, cursor);
    if (start >= layer.end) continue; // 既に前のレイヤーに消費された区間（重なりはMVPでは先勝ち）
    if (start > cursor) segments.push({ text: content.slice(cursor, start), layer: null, start: cursor, end: start });
    const end = Math.min(layer.end, content.length);
    segments.push({ text: content.slice(start, end), layer, start, end });
    cursor = end;
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), layer: null, start: cursor, end: content.length });
  }
  return segments;
}

/**
 * quoted_textを本文中から探して{start,end}を返す。同一文字列が複数回出現する場合は
 * 最初の一致を採用する（既知の制約。MVPでは十分な精度と判断）。
 */
export function locateQuotedText(content: string, quotedText: string): { start: number; end: number } | null {
  if (!quotedText) return null;
  const idx = content.indexOf(quotedText);
  if (idx === -1) return null;
  return { start: idx, end: idx + quotedText.length };
}
