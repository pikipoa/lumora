/**
 * 選択中のオートスクロール（2026-08-01）。
 *
 * 【解決する問題】
 * 本文は`ScrollView`（Web上では`overflow:auto`のdiv）の中に描画される。ブラウザ標準の
 * 「選択中に端まで来たらスクロールする」挙動は、document自体には効くが、ネストした
 * スクロールコンテナ、特にモバイルの選択ハンドル操作では働かないことが多い。
 * その結果「1画面に収まる範囲しか選べない」という制約が生まれていた（実機報告）。
 *
 * 【なぜbody側を直さないか】
 * Expoの既定テンプレートが`body { overflow: hidden }`を出力しており、Lumoraの全画面が
 * ネストしたScrollViewでスクロールする前提で組まれている（下タブバーの`position:fixed`等）。
 * bodyのスクロール方式を変えるのはアプリ全体に影響する変更になるため採らない。
 *
 * 【安全性の方針】
 * この仕組みはマーカーの作成・確定ロジックに一切触れない。行うのは
 * `container.scrollTop`の更新のみで、失敗しても「スクロールしない」で済み、
 * 既存の動作を壊さない。暴走を防ぐガードは`startEdgeAutoScroll`側に集約する。
 */

/** 端からこの距離（px）以内に選択の先端が来たらスクロールを始める */
export const EDGE_THRESHOLD_PX = 48;
/**
 * 1フレームあたりの最大スクロール量（px）。端に近いほど速くなる。
 *
 * 60fpsで動くため、この値×60が1秒あたりの最大スクロール量になる。
 * 当初12（≒720px/秒）にしていたが実機で「速すぎる」と判明したため4（≒240px/秒）へ下げた
 * （2026-08-02）。行の高さがおよそ24pxなので、毎秒10行程度の速さにあたる。
 */
export const MAX_STEP_PX = 4;

export interface EdgeScrollInput {
  /** 選択の「動いている側の先端」の矩形（ビューポート座標） */
  focusTop: number;
  focusBottom: number;
  /** スクロールコンテナの可視領域（ビューポート座標） */
  containerTop: number;
  containerBottom: number;
  /** これ以上その方向へスクロールできるか */
  canScrollUp: boolean;
  canScrollDown: boolean;
}

/**
 * 選択の先端がコンテナの端に近いとき、何pxスクロールすべきかを返す純粋関数。
 * 負＝上へ、正＝下へ、0＝スクロール不要。
 *
 * DOMに触れないので単体テストできる。この関数を分けているのは、
 * 「端の判定」という最も間違えやすい部分を検証可能にするため。
 */
export function computeAutoScrollStep(
  input: EdgeScrollInput,
  threshold: number = EDGE_THRESHOLD_PX,
  maxStep: number = MAX_STEP_PX,
): number {
  const { focusTop, focusBottom, containerTop, containerBottom, canScrollUp, canScrollDown } = input;

  const distanceFromTop = focusTop - containerTop;
  const distanceFromBottom = containerBottom - focusBottom;

  // 上端が優先。上下どちらも閾値内になるのはコンテナが極端に低い場合で、
  // その時は上へ寄せた方が「読み進めている位置」を見失いにくい
  if (distanceFromTop < threshold && canScrollUp) {
    // 端を越えて外側にある場合（負の距離）は最大速度
    const depth = Math.max(0, Math.min(threshold, threshold - distanceFromTop));
    return -Math.ceil((depth / threshold) * maxStep);
  }
  if (distanceFromBottom < threshold && canScrollDown) {
    const depth = Math.max(0, Math.min(threshold, threshold - distanceFromBottom));
    return Math.ceil((depth / threshold) * maxStep);
  }
  return 0;
}

/**
 * 実際にスクロールするコンテナ（`overflow-y: auto|scroll`かつ内容がはみ出しているもの）を
 * 祖先方向へ探す。見つからなければnull。
 */
export function findScrollableAncestor(start: Element | null): HTMLElement | null {
  let el: Element | null = start;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      const overflowY = window.getComputedStyle(el).overflowY;
      const scrollable = overflowY === 'auto' || overflowY === 'scroll';
      // +1 は小数点の丸め対策（内容がぴったり収まっている場合を除外する）
      if (scrollable && el.scrollHeight > el.clientHeight + 1) return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * 選択の「動いている側の先端」の矩形を返す。
 * focusNode/focusOffsetは、ユーザーがドラッグしている側の端を指す。
 */
export function getSelectionFocusRect(sel: Selection): DOMRect | null {
  if (!sel.focusNode || sel.rangeCount === 0) return null;
  const caret = document.createRange();
  try {
    caret.setStart(sel.focusNode, sel.focusOffset);
    caret.setEnd(sel.focusNode, sel.focusOffset);
  } catch {
    return null;
  }
  const rect = caret.getBoundingClientRect();
  if (rect.height > 0) return rect;
  // 行の折り返し位置などで潰れた矩形になることがある。その場合は選択全体で代用する
  const whole = sel.getRangeAt(0).getBoundingClientRect();
  return whole.height > 0 ? whole : null;
}
