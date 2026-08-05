/**
 * 選択・マーカー作成の切り分け用フラグと計測（2026-08-05・一時的な診断コード）。
 *
 * 【なぜ必要か】
 * 「掴み直すと選択が壊れる／繰り返すとオートスクロールが効かなくなる」という症状に対し、
 * 対症療法を2回外した。原因がアプリ側の状態管理なのか、ブラウザのネイティブな選択挙動
 * なのかを、**推測ではなく実験で切り分ける**ために入れた。
 *
 * 【使い方】URLのクエリで切り替える。ビルドを分けないのは、ON/OFFの比較に
 * ビルド差という余計な変数を持ち込まないため。
 *   ?noAutoScroll=1  … オートスクロール（scrollTopの書き換え）を完全に止める
 *   ?selDebug=1      … 選択の計測をSentryへ送る
 *
 * 【この文書の寿命】原因が確定したら**削除する**。恒久的な機能ではない。
 */

function hasFlag(name: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URLSearchParams(window.location.search).get(name) === '1';
  } catch {
    return false;
  }
}

/** オートスクロール（scrollTopの書き換え）を無効化するか */
export function isAutoScrollDisabled(): boolean {
  return hasFlag('noAutoScroll');
}

/** 選択の計測を有効にするか */
export function isSelectionDebugEnabled(): boolean {
  return hasFlag('selDebug');
}

/**
 * 1回の選択ジェスチャーの計測。**本文は一切保持しない**——長さと回数と真偽値のみ。
 * PII方針（src/lib/sentry.ts）を診断コードでも崩さない。
 */
export interface SelectionTrace {
  /** 計測を始めた時刻 */
  startedAt: number;
  /** selectionchangeが発火した回数 */
  selectionChangeCount: number;
  /** touchmoveが発火した回数（ハンドル操作中はページへ配信されない想定の検証） */
  touchMoveCount: number;
  /** scrollTopを実際に書き換えた回数 */
  scrollWriteCount: number;
  /** pointerup/touchendを受け取った回数（＝指を離した回数） */
  releaseCount: number;
  /** 指を離した後にselectionchangeが来た回数（ブラウザ側の「勝手な再計算」の検出） */
  changeAfterReleaseCount: number;
  /** 直近のanchorOffset/focusOffset（位置の絶対値ではなく、壊れ方の観測用） */
  lastAnchorOffset: number;
  lastFocusOffset: number;
  /** 選択文字数の最大値と最新値 */
  maxLength: number;
  lastLength: number;
  /** anchorOffsetが0へ落ちた回数（「上のハンドルが最上部まで飛ぶ」症状の検出） */
  anchorCollapsedToZeroCount: number;

  // --- 仮説①（DOM削除でRangeの境界点が親へせり上がる）の検証用 ---
  /** anchorNodeがテキストノードでなくなった回数。要素ノードへ変わっていたら①の直接証拠 */
  anchorBecameElementCount: number;
  /** anchorNode.isConnected が false だった回数（＝DOMから切り離されたノードを指している） */
  anchorDisconnectedCount: number;
  /** 直近のanchorNodeのnodeName（TEXTなら正常、DIV等ならせり上がっている） */
  lastAnchorNodeName: string;
  /** 直近のanchorNodeが data-message-id の内側にあったか（外なら本文の外へ出ている） */
  lastAnchorInsideMessage: boolean;
}

export function createTrace(): SelectionTrace {
  return {
    startedAt: Date.now(),
    selectionChangeCount: 0,
    touchMoveCount: 0,
    scrollWriteCount: 0,
    releaseCount: 0,
    changeAfterReleaseCount: 0,
    lastAnchorOffset: -1,
    lastFocusOffset: -1,
    maxLength: 0,
    lastLength: 0,
    anchorCollapsedToZeroCount: 0,
    anchorBecameElementCount: 0,
    anchorDisconnectedCount: 0,
    lastAnchorNodeName: '',
    lastAnchorInsideMessage: true,
  };
}
