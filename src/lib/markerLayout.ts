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
   * `let cursor = 0` を宣言し、segments.map()の中で加算しながら求めていた。render中に
   * 外側の変数を書き換えるのはReactの規約違反で、このプロジェクトはReact Compilerが
   * 有効なため特に危うい（メモ化で部分的にしか再評価されないと値が壊れる）。
   *
   * なお、当時調査していたマーカー位置ズレの直接の原因はこれではなく、ブラウザ拡張機能に
   * よるDOM書き換えだった（CHANGELOG.md参照）。ただしこのパターン自体が壊れやすいのは
   * 変わらないため、offsetは副作用のない純粋関数の中で確定させ、呼び出し側は
   * 読み取るだけにしている。
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

    // 範囲そのものの妥当性（他のセグメントとの関係を見る前に、単体で成立しているか）
    if (seg.start < 0) {
      violations.push(`startが負の値 (index=${i}, start=${seg.start})`);
    }

    if (seg.end > content.length) {
      violations.push(`endが本文の長さを超えている (index=${i}, end=${seg.end}, contentLength=${content.length})`);
    }

    // start < end を検査することで「end >= start」と「空セグメントを作らない」を同時に満たす
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
      // startの単調増加と、隙間なく連続していることの両方を検査する。前者だけだと
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

      // endの単調増加も独立して検査する。startの連続性が壊れている状況では
      // endの異常が上のチェックだけでは表面化しないことがあるため
      if (seg.end < prev.end) {
        violations.push(`endが単調増加していない (index=${i}, prevEnd=${prev.end}, currentEnd=${seg.end})`);
      }

      if (seg.start < prev.start) {
        violations.push(`startが単調増加していない (index=${i}, prevStart=${prev.start}, currentStart=${seg.start})`);
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
 * 最初の一致を採用する（既知の制約）。
 *
 * 単体で使うと「同じ単語の別の場所」を指してしまうため、新しいコードでは
 * resolveMarkerPosition を使うこと。この関数はその最終段（fallback）として残している。
 */
export function locateQuotedText(content: string, quotedText: string): { start: number; end: number } | null {
  if (!quotedText) return null;
  const idx = content.indexOf(quotedText);
  if (idx === -1) return null;
  return { start: idx, end: idx + quotedText.length };
}

/** マーカー作成時に保存する前後の文脈の長さ（片側） */
export const MARKER_CONTEXT_LENGTH = 40;

/** 本文中のある範囲について、前後の文脈を切り出す */
export function extractContext(
  content: string,
  start: number,
  end: number,
  length: number = MARKER_CONTEXT_LENGTH,
): { before: string; after: string } {
  return {
    before: content.slice(Math.max(0, start - length), start),
    after: content.slice(end, end + length),
  };
}

/** 位置解決に使う、DBに保存されているマーカーの手がかり */
export interface MarkerPositionHint {
  quotedText: string;
  startOffset: number | null;
  endOffset: number | null;
  contextBefore: string | null;
  contextAfter: string | null;
}

export interface ResolvedMarkerPosition {
  start: number;
  end: number;
  /**
   * どこまで確実に復元できたか。
   * - exact   : 保存されたoffsetがそのまま正しい（文脈も一致）
   * - context : offsetは使えなかったが、前後の文脈から出現箇所を特定できた
   * - fallback: 文脈でも決められず、最初の出現箇所を採用した（誤りの可能性あり）
   */
  confidence: 'exact' | 'context' | 'fallback';
}

/** 末尾同士・先頭同士で何文字一致するか（保存時に端が切れている場合を許容するため） */
function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** 本文中の quotedText の全出現位置 */
function allOccurrences(content: string, quotedText: string): number[] {
  const result: number[] = [];
  if (!quotedText) return result;
  let from = 0;
  for (;;) {
    const i = content.indexOf(quotedText, from);
    if (i === -1) break;
    result.push(i);
    from = i + 1;
  }
  return result;
}

/**
 * マーカーの表示位置を3段階で解決する（2026-07-27）。
 *
 * 【なぜ3段階なのか】
 * quoted_textだけで位置を決めると、同じ単語が複数ある本文で必ず最初の一致に
 * 解決されてしまう（「Gemini」が6回出てくる会話で、3つ目を選んでも1つ目に付く）。
 * 一方でoffsetだけに頼ると、本文が編集・再インポートされた時に破綻する。
 *
 * さらに重要なのは、保存時の検証（content.slice(start,end) === quotedText）は
 * 「テキストは同じで出現箇所が違う」ズレを原理的に検出できないこと。同じ文字列なら
 * どの出現箇所でも検証を通ってしまう。前後の文脈を併せて持つことで、この穴を塞ぐ。
 *
 *   1. offsetが正しく、前後の文脈も一致する      → exact
 *   2. 全出現箇所のうち、前後の文脈が最も一致するもの → context
 *   3. どれも決め手がなければ最初の出現箇所        → fallback（誤りの可能性あり）
 */
export function resolveMarkerPosition(content: string, hint: MarkerPositionHint): ResolvedMarkerPosition | null {
  const { quotedText, startOffset, endOffset, contextBefore, contextAfter } = hint;
  if (!quotedText) return null;

  const hasContext = (contextBefore ?? '') !== '' || (contextAfter ?? '') !== '';

  const contextScoreAt = (start: number): number => {
    const actual = extractContext(content, start, start + quotedText.length);
    return (
      commonSuffixLength(actual.before, contextBefore ?? '') + commonPrefixLength(actual.after, contextAfter ?? '')
    );
  };

  // 1) 保存されたoffsetをまず信じる。ただしテキストが一致することと、
  //    文脈を持っているならそれも一致することを条件にする
  if (startOffset != null && endOffset != null && content.slice(startOffset, endOffset) === quotedText) {
    if (!hasContext) return { start: startOffset, end: endOffset, confidence: 'exact' };
    const expected = extractContext(content, startOffset, endOffset);
    const beforeOk = (contextBefore ?? '') === '' || expected.before.endsWith(contextBefore ?? '') || (contextBefore ?? '').endsWith(expected.before);
    const afterOk = (contextAfter ?? '') === '' || expected.after.startsWith(contextAfter ?? '') || (contextAfter ?? '').startsWith(expected.after);
    if (beforeOk && afterOk) return { start: startOffset, end: endOffset, confidence: 'exact' };
    // 文脈が合わない＝本文がずれた、もしくはoffsetが別の出現箇所を指している。2)へ
  }

  const occurrences = allOccurrences(content, quotedText);
  if (occurrences.length === 0) return null;

  // 2) 文脈が最も一致する出現箇所を選ぶ
  if (hasContext && occurrences.length > 1) {
    let bestStart = occurrences[0];
    let bestScore = -1;
    let tie = false;
    for (const start of occurrences) {
      const score = contextScoreAt(start);
      if (score > bestScore) {
        bestScore = score;
        bestStart = start;
        tie = false;
      } else if (score === bestScore) {
        tie = true;
      }
    }
    // 1文字でも決め手があり、かつ同点で並んでいないなら採用する
    if (bestScore > 0 && !tie) {
      return { start: bestStart, end: bestStart + quotedText.length, confidence: 'context' };
    }
  }

  // 3) 決め手なし。最初の出現箇所（従来どおりの挙動）
  const first = occurrences[0];
  return {
    start: first,
    end: first + quotedText.length,
    confidence: occurrences.length === 1 ? 'exact' : 'fallback',
  };
}
