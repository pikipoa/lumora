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
}

export function computeSegments(content: string, layers: MarkerLayer[]): TextSegment[] {
  if (layers.length === 0) return [{ text: content, layer: null }];

  const sorted = [...layers].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const layer of sorted) {
    const start = Math.max(layer.start, cursor);
    if (start >= layer.end) continue; // 既に前のレイヤーに消費された区間（重なりはMVPでは先勝ち）
    if (start > cursor) segments.push({ text: content.slice(cursor, start), layer: null });
    const end = Math.min(layer.end, content.length);
    segments.push({ text: content.slice(start, end), layer });
    cursor = end;
  }
  if (cursor < content.length) segments.push({ text: content.slice(cursor), layer: null });
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
