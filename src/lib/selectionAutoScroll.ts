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

/**
 * アンカー側のハンドルを画面内に残すための余白（px）。
 *
 * 【なぜ必要か・2026-08-05の切り分け実験で確定】
 * オートスクロールをOFFにすると10回繰り返しても壊れず、ONだと
 * 「**ハンドルが画面外に消えると（選択の起点が）上部に飛ぶ**」ことが実機で確認された。
 * ブラウザは画面外へ出たハンドルの位置を追跡できなくなり、選択のアンカーを先頭へ
 * 「回復」させてしまう。つまり原因は速度でも状態管理でもなく、
 * **アンカー側のハンドルが画面外へ出るまでスクロールしてしまうこと**だった。
 *
 * この余白の分だけアンカーを画面内に残す。ハンドルの図形は指の位置より下に描画される
 * ため、テキストの矩形ぴったりではなく少し余裕を持たせる。
 */
export const ANCHOR_KEEP_VISIBLE_PX = 44;

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
  /**
   * 選択の「動かない側（アンカー）」の矩形（ビューポート座標）。
   * これが画面外へ出るとブラウザが選択を壊すため、出さない範囲までしかスクロールしない。
   * 取得できない場合はundefinedでよい（その場合は従来どおり制限しない）。
   */
  anchorTop?: number;
  anchorBottom?: number;
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
  const {
    focusTop,
    focusBottom,
    containerTop,
    containerBottom,
    canScrollUp,
    canScrollDown,
    anchorTop,
    anchorBottom,
  } = input;

  const accelerationRatio = Math.max(0, Math.min(1, msAtEdge / accelerationDurationMs));
  const maxStep = baseStep + (acceleratedStep - baseStep) * accelerationRatio;

  const distanceFromTop = focusTop - containerTop;
  const distanceFromBottom = containerBottom - focusBottom;

  /**
   * アンカーを画面内に残せる範囲へスクロール量を切り詰める（2026-08-05）。
   * 下へスクロールするとアンカーは上へ動くので、アンカーの上端が
   * containerTop + ANCHOR_KEEP_VISIBLE_PX を割り込む手前で止める（上方向はその逆）。
   * これを超えるとブラウザがアンカーを見失い、選択の起点が先頭へ飛ぶ。
   */
  const clampToKeepAnchorVisible = (step: number): number => {
    if (anchorTop === undefined || anchorBottom === undefined) return step;
    if (step > 0) {
      // 下へスクロール＝アンカーは上へ移動する。上端の余白を使い切るまで
      const room = anchorTop - (containerTop + ANCHOR_KEEP_VISIBLE_PX);
      return Math.max(0, Math.min(step, Math.floor(room)));
    }
    if (step < 0) {
      // 上へスクロール＝アンカーは下へ移動する。下端の余白を使い切るまで。
      // `+ 0` は -0 を 0 に正規化するため（-0でも比較は通るが、返り値に混ぜない）
      const room = containerBottom - ANCHOR_KEEP_VISIBLE_PX - anchorBottom;
      return Math.min(0, Math.max(step, -Math.floor(room))) + 0;
    }
    return 0;
  };

  // 上端が優先。上下どちらも閾値内になるのはコンテナが極端に低い場合で、
  // その時は上へ寄せた方が「読み進めている位置」を見失いにくい
  if (distanceFromTop < threshold && canScrollUp) {
    // 端を越えて外側にある場合（負の距離）は最大速度
    const depth = Math.max(0, Math.min(threshold, threshold - distanceFromTop));
    return clampToKeepAnchorVisible(-Math.ceil((depth / threshold) * maxStep));
  }
  if (distanceFromBottom < threshold && canScrollDown) {
    const depth = Math.max(0, Math.min(threshold, threshold - distanceFromBottom));
    return clampToKeepAnchorVisible(Math.ceil((depth / threshold) * maxStep));
  }
  return 0;
}

/**
 * 実際にスクロールするコンテナ（`overflow-y: auto|scroll`かつ内容がはみ出しているもの）を
 * 祖先方向へ探す。見つからなければnull。
 *
 * `skipLayoutReads`（2026-08-07・切り分け実験B専用）：祖先の走査は同じように行うが、
 * `getComputedStyle`と`scrollHeight`/`clientHeight`——**同期レイアウトを強制する読み取り**
 * ——だけを実行しない。「この関数を選択イベント中に呼ぶこと自体」と「レイアウト強制読み取り」の
 * どちらが症状の必要条件かを分けるために使う。常にnullを返す（＝走査のためだけに呼ぶ）。
 * 呼び出し側はキャッシュ済みのコンテナを使うこと——ここでnullを採用してしまうと
 * オートスクロールごと停止し、「効果まるごと停止」の実験と区別がつかなくなる。
 */
export function findScrollableAncestor(
  start: Element | null,
  skipLayoutReads = false,
): HTMLElement | null {
  let el: Element | null = start;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el instanceof HTMLElement && !skipLayoutReads) {
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
 *
 * 【2026-08-05修正：「選択全体で代用」を廃止した】
 * 以前は先端の矩形が潰れた（高さ0）場合、選択範囲**全体**の矩形で代用していた。
 * これが暴走の原因だった：複数行にまたがる選択では、選択全体の下端は「今指がある位置」
 * ではなく「アンカーから最も遠い場所」を指す。これがコンテナの下端よりずっと下にあると、
 * computeAutoScrollStepは「大きく外側にはみ出している」と判定して常に最大速度を返す。
 * 先端の矩形は、スクロール中に行の折り返し位置へ来た瞬間に頻発して潰れるため、
 * 「潰れる→全体で代用→最大速度→大きく動く→また潰れる」という自己増幅ループになり、
 * 一気に最下部まで進んでしまっていた（実機報告：「画面したまで行くとガタガタして
 * 一気に下まで進む」）。
 *
 * 代わりに、1文字分ずらした位置で矩形を取り直す。それでも取れなければnullを返し、
 * 呼び出し側（tick）はその1フレームを何もせずに止める——**暴走するくらいなら
 * 何もしない方が安全**という方針（安全性の方針、ファイル冒頭のコメント参照）。
 */
export function getSelectionFocusRect(sel: Selection): DOMRect | null {
  if (!sel.focusNode || sel.rangeCount === 0) return null;
  return rectAtBoundary(sel.focusNode, sel.focusOffset);
}

/**
 * 選択の「動かない側（アンカー）」の矩形を返す。
 * これが画面外へ出るとブラウザが選択を壊すため、スクロール量の制限に使う
 * （2026-08-05の切り分け実験で確定。ANCHOR_KEEP_VISIBLE_PXのコメント参照）。
 */
export function getSelectionAnchorRect(sel: Selection): DOMRect | null {
  if (!sel.anchorNode || sel.rangeCount === 0) return null;
  return rectAtBoundary(sel.anchorNode, sel.anchorOffset);
}

/**
 * 境界点（node, offset）の矩形を返す。潰れていた場合は1文字分ずらして取り直す。
 * **選択全体の矩形では代用しない**——複数行の選択では「今その端がある位置」ではなく
 * 「最も遠い場所」を指してしまい、誤った距離判定から暴走を招く（2026-08-05に修正済み）。
 */
function rectAtBoundary(node: Node, offset: number): DOMRect | null {
  const tryRectAt = (n: Node, o: number): DOMRect | null => {
    const caret = document.createRange();
    try {
      caret.setStart(n, o);
      caret.setEnd(n, o);
    } catch {
      return null;
    }
    const rect = caret.getBoundingClientRect();
    return rect.height > 0 ? rect : null;
  };

  const exact = tryRectAt(node, offset);
  if (exact) return exact;

  if (offset > 0) {
    const before = tryRectAt(node, offset - 1);
    if (before) return before;
  }
  const len = node.textContent?.length ?? 0;
  if (offset < len) {
    const after = tryRectAt(node, offset + 1);
    if (after) return after;
  }
  return null;
}
