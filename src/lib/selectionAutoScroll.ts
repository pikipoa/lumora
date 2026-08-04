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
 *
 * 【2026-08-05・固定速度をやめた理由】
 * 4のままだと、900文字のような長文では端まで数秒以上スクロールし続ける必要がある。
 * モバイルの選択ハンドルはドラッグ中に指を離すと**伸長ではなく新しい選択の開始**と
 * 解釈されることがあり、実機で「掴み直した」結果、後半の一部だけが保存される欠損に
 * つながった（診断の結果、保存文字列はブラウザの生のselectionそのものであり、座標計算の
 * バグではないことをコードで確認済み）。
 *
 * 単一の固定速度では「速すぎる」（初回の指摘）と「遅すぎる」（今回）を同時に満たせない。
 * そこで**端に留まっている時間**を加速の入力に加えた。掴んだ直後はこの値（穏やか）で始まり、
 * 留まり続けるほど`MAX_STEP_PX_ACCELERATED`まで加速する。短い選択は従来どおり穏やかなまま、
 * 長い選択は途中で指を離さずに端まで到達できるようにする。
 */
export const MAX_STEP_PX = 4;
/** 端に留まり続けた場合の上限速度（px/フレーム）。MAX_STEP_PXの5倍＝約1200px/秒 */
export const MAX_STEP_PX_ACCELERATED = 20;
/** この時間（ms）留まり続けると、加速が上限に達する */
export const ACCELERATION_DURATION_MS = 1200;

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
 *
 * `msAtEdge`（2026-08-05追加）：端に留まり続けている時間。0なら`baseStep`（穏やか）から
 * 始まり、`accelerationDurationMs`かけて`acceleratedStep`まで線形に加速する。
 * 掴んだ直後の速度は変えず（「速すぎる」という初回の指摘への配慮）、長く留まる場合だけ
 * 速くする——長文選択で端まで数秒以上待たされ、指を離して掴み直す（＝選択が新しく
 * 始まってしまう）ことを避けるため。
 */
export function computeAutoScrollStep(
  input: EdgeScrollInput,
  msAtEdge: number = 0,
  threshold: number = EDGE_THRESHOLD_PX,
  baseStep: number = MAX_STEP_PX,
  acceleratedStep: number = MAX_STEP_PX_ACCELERATED,
  accelerationDurationMs: number = ACCELERATION_DURATION_MS,
): number {
  const { focusTop, focusBottom, containerTop, containerBottom, canScrollUp, canScrollDown } = input;

  const accelerationRatio = Math.max(0, Math.min(1, msAtEdge / accelerationDurationMs));
  const maxStep = baseStep + (acceleratedStep - baseStep) * accelerationRatio;

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
