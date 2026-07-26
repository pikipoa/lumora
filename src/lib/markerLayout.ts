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

/**
 * セグメント列が満たすべき不変条件を検査し、違反の一覧を返す純粋関数（2026-07-26追加）。
 * 違反が無ければ空配列。
 *
 * マーカー位置ズレの不具合では、壊れた開始位置が誰にも気づかれないまま
 * DOM → 座標計算 → DB保存まで流れてしまい、発見が大きく遅れた。不変条件を
 * 明示的に検査しておけば、同種のバグは壊れた瞬間に分かる。
 *
 * console.assertを直接呼ばずに違反リストを返す形にしているのは、
 * 「検査が壊れた入力を本当に検出できるか」自体をテストできるようにするため
 * （検出しない番人はいない番人より危険なため）。
 */
export function findSegmentInvariantViolations(content: string, segments: TextSegment[]): string[] {
  const violations: string[] = [];

  if (segments.length === 0) {
    if (content.length !== 0) {
      violations.push(`セグメントが空なのに本文が空でない (contentLength=${content.length})`);
    }
    return violations;
  }

  if (segments[0].start !== 0) {
    violations.push(`先頭セグメントが0から始まっていない (firstStart=${segments[0].start})`);
  }

  const last = segments[segments.length - 1];
  if (last.end !== content.length) {
    violations.push(`末尾セグメントが本文の終端で終わっていない (lastEnd=${last.end}, contentLength=${content.length})`);
  }

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (!(seg.start < seg.end)) {
      violations.push(`空または逆順のセグメント (index=${i}, start=${seg.start}, end=${seg.end})`);
    }

    if (seg.text !== content.slice(seg.start, seg.end)) {
      violations.push(
        `textがcontent.slice(start,end)と不一致 (index=${i}, start=${seg.start}, end=${seg.end}, ` +
          `text=${JSON.stringify(seg.text)}, slice=${JSON.stringify(content.slice(seg.start, seg.end))})`,
      );
    }

    if (i > 0) {
      const prev = segments[i - 1];
      // 単調増加と、隙間なく連続していることの両方を検査する。前者だけだと
      // 「飛んでいる（＝本文の一部が欠落している）」ケースを見逃す
      if (seg.start < prev.end) {
        violations.push(
          `順序が壊れている：開始位置が前へ戻った (index=${i}, prevEnd=${prev.end}, currentStart=${seg.start})`,
        );
      } else if (seg.start !== prev.end) {
        violations.push(
          `連続していない：隙間がある (index=${i}, prevEnd=${prev.end}, currentStart=${seg.start}, gap=${seg.start - prev.end})`,
        );
      }
    }
  }

  return violations;
}

export function computeSegments(content: string, layers: MarkerLayer[]): TextSegment[] {
  // 長さ0のセグメントは情報を持たず、不変条件（start < end）も満たさないので作らない
  if (content.length === 0) return [];
  if (layers.length === 0) return [{ text: content, layer: null, start: 0, end: content.length }];

  const sorted = [...layers].sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const layer of sorted) {
    const start = Math.max(layer.start, cursor);
    if (start >= layer.end) continue; // 既に前のレイヤーに消費された区間（重なりはMVPでは先勝ち）
    const end = Math.min(layer.end, content.length);
    if (start >= end) continue; // 本文の範囲外にはみ出したレイヤー（クランプ後に空になる）
    if (start > cursor) segments.push({ text: content.slice(cursor, start), layer: null, start: cursor, end: start });
    segments.push({ text: content.slice(start, end), layer, start, end });
    cursor = end;
  }
  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), layer: null, start: cursor, end: content.length });
  }

  // 開発時のみ自己検査する（本番ビルドでは__DEV__がfalseになり一切実行されない）
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    for (const violation of findSegmentInvariantViolations(content, segments)) {
      console.assert(false, `[markerLayout] セグメントの不変条件に違反: ${violation}`);
    }
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
