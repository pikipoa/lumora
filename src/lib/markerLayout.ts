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

/**
 * 同じ文字位置を複数のマーカーが覆う時、どちらを表示するかを決める。
 * **最小区間が勝つ**（DESIGN.md「マーカーの重なり — 表示優先順位」）。
 *
 * 長い引用の中の特定語に別の色を引く、という使い方が実在するため、狭い方＝より具体的な
 * 指定とみなす。同幅なら created_at → id で一意に決める（同値キーには必ず一意な
 * タイブレーカーを付ける。search-spec.md 3-6と同じ理由）。
 */
interface ClampedLayer {
  /** 元のレイヤーをそのまま保持する。セグメントにはこれを入れる（クランプしたコピーではなく）。
   *  呼び出し側が layer.start / layer.end を編集時の範囲として使うため */
  layer: MarkerLayer;
  start: number;
  end: number;
}

function isNarrower(a: ClampedLayer, b: ClampedLayer): boolean {
  const widthA = a.end - a.start;
  const widthB = b.end - b.start;
  if (widthA !== widthB) return widthA < widthB;
  // 呼び出し側が created_at 順に並べて渡す前提。ここでは id で最終的な一意性を担保する
  return a.layer.id < b.layer.id;
}

export function computeSegments(content: string, layers: MarkerLayer[]): TextSegment[] {
  // 長さ0のセグメントは情報を持たず、不変条件（start < end）も満たさないので作らない
  if (content.length === 0) return [];
  if (layers.length === 0) return [{ text: content, layer: null, start: 0, end: content.length }];

  // 本文の範囲へクランプし、空になったレイヤーは捨てる。
  // レイヤー自体は元のオブジェクトのまま保持する（コピーを返すと、呼び出し側が
  // layer.start / layer.end を編集時の範囲として使っているため挙動が変わる）
  const clamped: ClampedLayer[] = layers
    .map((l) => ({ layer: l, start: Math.max(0, l.start), end: Math.min(l.end, content.length) }))
    .filter((c) => c.start < c.end);
  if (clamped.length === 0) return [{ text: content, layer: null, start: 0, end: content.length }];

  // すべての境界（開始・終了）で本文を切り分け、各区間の代表レイヤーを決める。
  // 「開始位置順に先勝ち」だと、外側のレイヤーが常に先に始まるため**内側が必ず落ちる**。
  // 実データで4件、長い引用の中の語に引いたマーカーが画面から消えていた（2026-07-31）
  const boundaries = [...new Set([0, content.length, ...clamped.flatMap((c) => [c.start, c.end])])]
    .filter((b) => b >= 0 && b <= content.length)
    .sort((a, b) => a - b);

  const segments: TextSegment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (start >= end) continue;
    let best: ClampedLayer | null = null;
    for (const c of clamped) {
      if (c.start > start || c.end < end) continue; // この区間を覆っていない
      if (best === null || isNarrower(c, best)) best = c;
    }
    const winner = best?.layer ?? null;
    // 同じレイヤー（nullを含む）が続くなら1つのセグメントにまとめる。
    // 境界で機械的に切ると、同じ色のセグメントが不必要に分割されるため
    const prev = segments[segments.length - 1];
    if (prev && prev.layer === winner) {
      prev.end = end;
      prev.text = content.slice(prev.start, end);
    } else {
      segments.push({ text: content.slice(start, end), layer: winner, start, end });
    }
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

/**
 * 位置をどこまで確実に復元できたか。
 * - exact     : offsetがそのまま正しい（文脈も一致）／本文中に1箇所しかない
 * - context   : offsetは使えなかったが、前後の文脈から出現箇所を特定できた
 * - text_only : 文字列は見つかったが複数箇所あり、決め手がない（最初の一致を採用）
 * - missing   : 本文中に見つからない
 *
 * UIでの扱い（2026-07-27方針）：exact/contextは自動復元でユーザー操作に影響しないため
 * 画面には何も出さない。通知を出すのは本当に曖昧な text_only と missing だけにする。
 * 「推測で復元しました」を常時出すと通常利用で通知が増えすぎるため。
 */
export type MarkerMatchType = 'exact' | 'context' | 'text_only' | 'missing';

export interface ResolvedMarkerPosition {
  start: number;
  end: number;
  matchType: Exclude<MarkerMatchType, 'missing'>;
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
 *   3. 複数箇所あるが決め手がない             → text_only（最初の一致。誤りの可能性あり）
 *   本文中に見つからなければ null を返す（＝missing）
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
    if (!hasContext) return { start: startOffset, end: endOffset, matchType: 'exact' };
    const expected = extractContext(content, startOffset, endOffset);
    const beforeOk =
      (contextBefore ?? '') === '' ||
      expected.before.endsWith(contextBefore ?? '') ||
      (contextBefore ?? '').endsWith(expected.before);
    const afterOk =
      (contextAfter ?? '') === '' ||
      expected.after.startsWith(contextAfter ?? '') ||
      (contextAfter ?? '').startsWith(expected.after);
    if (beforeOk && afterOk) return { start: startOffset, end: endOffset, matchType: 'exact' };
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
      return { start: bestStart, end: bestStart + quotedText.length, matchType: 'context' };
    }
  }

  // 3) 決め手なし。最初の出現箇所（従来どおりの挙動）。
  //    ただし本文中に1箇所しかないなら曖昧さは無いのでexactとして扱う
  const first = occurrences[0];
  return {
    start: first,
    end: first + quotedText.length,
    matchType: occurrences.length === 1 ? 'exact' : 'text_only',
  };
}
