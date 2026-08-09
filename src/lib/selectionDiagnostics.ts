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

/** オートスクロール（イベント登録・step計算・RAFを含む全て）を無効化するか */
export function isAutoScrollDisabled(): boolean {
  return hasFlag('noAutoScroll');
}

/**
 * Mode 1「観測のみ」（2026-08-06）。
 *
 * イベント登録・step計算・RAFループはそのまま動かし、**scrollTopへの書き込みだけ**を
 * 止める。?noAutoScroll=1 は仕組みごと止めるため「オートスクロールの存在」が
 * 必要条件かどうかしか分からないが、こちらは「**実際の書き込み**が必要条件か」を分ける。
 *
 *   症状が消える … 書き込み、または書き込みが誘発するブラウザ挙動が原因
 *   症状が残る   … イベント層・状態更新・ネイティブ選択側が原因
 *   スクロールは動かないのに選択だけ飛ぶ … スクロール非依存の枝が実証される
 */
export function isObserveOnlyMode(): boolean {
  return hasFlag('observeOnly');
}

/**
 * Mode 2「計測読み取りなし」（2026-08-07）。
 *
 * 【なぜ必要になったか】
 * `?noAutoScroll=1` は効果全体をreturnで飛ばすため、`?observeOnly=1` との差は
 * 「scrollTopを書いたかどうか」だけではない。observeOnlyでは次の3層が動いたままだった：
 *   L1 イベント登録（selectionchange＋停止系）
 *   L2 RAFループ（60fps）
 *   L3 **毎フレームのRange生成 + getBoundingClientRect**（focus/anchorの2境界、
 *      潰れた場合の取り直しを含めて最大6 Range/フレーム ≒ 360 Range/秒）
 *
 * よって「observeOnlyでも症状が残る」から言えるのは「書き込みは必要条件ではない」までで、
 * 「アプリ側の要因が消えた」ではない。このフラグはL1・L2を残したままL3だけを止め、
 * **ネイティブがハンドルを追跡している最中の強制レイアウト読み取り**が関与するかを分ける。
 *
 *   症状が消える … L3が関与。読み取り頻度を落とす等、Lumora側で対処できる
 *   症状が残る   … L1かL2、または真にネイティブ側。次はL1とL2を割る
 */
export function isRectReadDisabled(): boolean {
  return hasFlag('noRectRead');
}

/**
 * L1b の切り分け（2026-08-07）。
 *
 * 【ここまでで消えたもの】
 * L2（RAF稼働量）とL3（tick内のrect読み取り）は、症状と相関しないことが実機で確定した
 *   observeOnly … anchorが画面外だと step===0 で tick は即停止する＝L2はほぼ動かない → 飛ぶ
 *   noRectRead  … L3を止めてRAFは回り続ける＝L2は最大に動く                     → 飛ぶ
 * L1a（selectionchangeリスナーが登録されていること自体）も消えた。確定ロジック側の効果が
 * 常時 selectionchange を登録しており、それは noAutoScroll=1（正常）でも登録されたままのため。
 * オートスクロール効果が新規に足すイベント種別（pointercancel / lostpointercapture /
 * touchcancel / visibilitychange / pagehide）のハンドラは cancelAnimationFrame のみで、
 * 選択を壊す余地がない。
 *
 * 【残ったもの】
 * onSelectionChangeForScroll の**本体が実行されること**（L1b）。中身は安価なDOM走査と、
 * findScrollableAncestor による getComputedStyle / scrollHeight / clientHeight の読み取り
 * ——後者は getBoundingClientRect と同じく**強制レイアウト**を発生させる。
 *
 * 症状は「anchorが画面外の状態でハンドルに触れる」だけで単発で起き、スクロール位置は
 * 変化せずRange境界だけが移動する。よって見るべきは、選択イベントの最中に走る同期レイアウト。
 */

/** ハンドラ本体を丸ごと実行しない（リスナー登録は残す）。L1b全体の有無を見る */
export function isScrollHandlerDisabled(): boolean {
  return hasFlag('noScrollHandler');
}

/**
 * findScrollableAncestor（＝祖先を遡る getComputedStyle / scrollHeight 読み取り）を
 * マウント後の初回1度だけに減らす。ハンドラ本体の他の部分は動かしたまま、
 * **強制レイアウトだけ**を選択イベントの経路から外す
 */
export function isScrollerSearchCached(): boolean {
  return hasFlag('cacheScroller');
}

/**
 * 実験B「走査のみ」（2026-08-07）。
 *
 * `?cacheScroller=1`（A/C）は、臨界イベントで findScrollableAncestor を**呼ばない**。
 * これが正常になっても、「祖先走査そのもの」と「レイアウト強制読み取り」のどちらが
 * 効いたのかは分からない。このフラグは走査を実行したままレイアウト読み取りだけを外し、
 * 1変数だけ違う3点の階段を作る。
 *
 *   通常              走査あり／読み取りあり
 *   ?walkOnly=1       走査あり／読み取り**なし**
 *   ?cacheScroller=1  走査なし／読み取りなし
 *
 * 【落とし穴を避ける設計】走査の戻り値は捨て、コンテナはキャッシュ済みのものを使う。
 * ここでnullを採用するとオートスクロールごと止まり、?noAutoScroll=1 と区別できなくなる。
 */
export function isScrollerWalkOnly(): boolean {
  return hasFlag('walkOnly');
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

  /**
   * anchorが「どこまで」飛んだかの分類（2026-08-06）。
   * 1段せり上がっただけ（DOM削除のカスケード）なのか、文書ルートまで完全に失われたのか
   * で機序が変わるため、推測せず値で分ける。
   *   'text-in-message'   … 正常（本文内のテキストノード）
   *   'element-in-message'… 本文内だが要素ノード（1段せり上がった）
   *   'in-workspace'      … 本文の外だがワークスペース内
   *   'document-root'     … BODY/HTML（完全に失われて初期値に落ちた）
   *   'detached'          … isConnected=false（DOMから切り離されている）
   *   'other'             … 上記以外
   */
  lastAnchorPlacement: string;
  /** anchorがdocument-rootまで飛んだ回数（最も重い症状の直接カウント） */
  anchorAtDocumentRootCount: number;

  // --- オートスクロールの実挙動（2026-08-06追加） ---
  // 「anchorは壊れていないが、focusがanchorを追い越して文書先頭まで回り込んだ」という
  // 見立てを検証する。この場合anchorの分類は正常（text-in-message）を返すため、
  // 分類だけ見ていると偽陰性になる。scrollTopとstepの実値で判定する。
  /** autoScrollが返したstepの最小値（負なら上方向。符号の異常を直接見る） */
  minStep: number;
  /** autoScrollが返したstepの最大値 */
  maxStep: number;
  /** スクロール中に観測したscrollTopの最小値（0まで落ちていれば先頭まで巻き戻っている） */
  minScrollTop: number;
  /** 最後に観測したscrollTop */
  lastScrollTop: number;
  /** scrollTopが0に到達した回数 */
  scrollTopReachedZeroCount: number;
  /** clampに渡したanchorTopの最新の生値（undefinedなら-99999） */
  lastAnchorTop: number;
  /**
   * focusがanchorを追い越した回数（＝Rangeのstart側がfocusになった）。
   * 「見えている左ハンドルは、もはやanchorではなくfocus」を数値で確かめる
   */
  focusOvertookAnchorCount: number;

  /**
   * この選択で何回目のドラッグか（2026-08-06）。指を離すたびに増える。
   * 「掴み直しが必要」は未説明の唯一の条件なので、1回目と2回目以降で
   * focusOvertookAnchorCount に差が出るかを見られるようにする。
   * データが出てから足すと、再現をもう一度お願いすることになるため先に入れる。
   */
  dragSessionIndex: number;
  /** ドラッグ2回目以降に限った追い越し回数（掴み直し特有かどうかの判別） */
  focusOvertookAfterRegrabCount: number;

  /**
   * anchorNode / focusNode の指紋（2026-08-08）。
   *
   * 【なぜ必要になったか】
   * `len`（＝sel.toString().length）が、右ハンドルをタップして左ハンドルが文書先頭へ
   * ワープして見える前後の4時点すべてで不変だった（実機・272文字）。Rangeが変化すれば
   * selectionchangeが必ず発火し、計測ブロックはハンドラ先頭にあるため必ずlenが更新される。
   * よって**Rangeのテキスト内容は動いていない**。
   *
   * 残る問いは「同じ長さのまま、境界のノードやオフセットが入れ替わっていないか」。
   * それを見るには長さでは足りず、**どのノードの何文字目か**が要る。
   * 本文は一切保持しない——data-message-idの末尾4文字と、メッセージ内のテキストノードの
   * 通し番号だけを持つ（PII方針：src/lib/sentry.ts）。
   */
  lastAnchorFp: string;
  lastFocusFp: string;

  /**
   * 正規化されたRangeの境界（2026-08-08）。
   *
   * 【なぜanchor/focusだけでは足りないか】
   * 実機で、右ハンドルをタップした直後に anchor だけが `other`（＝ワークスペースの外）へ
   * 移った一方、`sel.toString().length` は 272 のまま変わらなかった。anchor/focus が
   * Rangeを定義するなら、この2つは同時に成り立たない。
   *
   * ネイティブの選択ハンドルは anchor/focus から描画され、`toString()` と Lumora の
   * マーカー処理（getRangeAt(0)）は Range を見る。両者が乖離しているなら、
   * 「ハンドルだけが上に見えるのに、選ばれている文字数は正しい」が説明できる。
   * それを確かめるには、**同じ1回のパスで両方を記録する**しかない。
   */
  lastRangeStartFp: string;
  lastRangeStartOffset: number;
  lastRangeEndFp: string;
  lastRangeEndOffset: number;
  /**
   * anchorがRangeのstartでもendでもない状態（＝乖離）だったか。
   * 目視で4つの値を突き合わせる代わりに、コードで判定して1語で出す
   */
  lastBoundaryDiverged: boolean;
  /** 乖離を観測した累計回数 */
  boundaryDivergedCount: number;
  /**
   * 右ハンドル（focus）が下方向へ動いていた時に限った、anchorの異常回数。
   * 実機で確認された非対称（右を下へ引いた時だけ壊れる）を数値で裏付ける
   */
  anchorBrokeWhileFocusMovingDownCount: number;
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
    lastAnchorPlacement: '',
    anchorAtDocumentRootCount: 0,
    anchorBrokeWhileFocusMovingDownCount: 0,
    minStep: 0,
    maxStep: 0,
    minScrollTop: Number.MAX_SAFE_INTEGER,
    lastScrollTop: -1,
    scrollTopReachedZeroCount: 0,
    lastAnchorTop: -99999,
    focusOvertookAnchorCount: 0,
    dragSessionIndex: 1,
    focusOvertookAfterRegrabCount: 0,
    lastAnchorFp: '-',
    lastFocusFp: '-',
    lastRangeStartFp: '-',
    lastRangeStartOffset: -1,
    lastRangeEndFp: '-',
    lastRangeEndOffset: -1,
    lastBoundaryDiverged: false,
    boundaryDivergedCount: 0,
  };
}

/**
 * 選択の境界ノードの指紋を返す（2026-08-08）。**本文は一切読まない。**
 *
 * 形式：`<data-message-idの末尾4文字>#<メッセージ内のテキストノード通し番号>`
 *   例）`3f2a#2`
 * 本文の外にいる場合は classifyAnchorPlacement の分類をそのまま返す（`document-root` 等）。
 * 要素ノードを指している場合は番号が `e` になる——DOM削除で境界点が親へせり上がった時の印。
 *
 * TreeWalkerによるDOM走査のみで、`getComputedStyle`も`getBoundingClientRect`も呼ばない。
 * レイアウトを強制しないため、保留中のレイアウト仮説を汚さずに測れる。
 */
export function fingerprintBoundary(node: Node | null): string {
  if (!node) return '-';
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  const msg = el?.closest?.('[data-message-id]') as HTMLElement | null;
  if (!msg) return classifyAnchorPlacement(node);

  const id = (msg.getAttribute('data-message-id') ?? '').slice(-4);
  if (node.nodeType !== Node.TEXT_NODE) return `${id}#e`;

  const walker = document.createTreeWalker(msg, NodeFilter.SHOW_TEXT);
  let i = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === node) return `${id}#${i}`;
    i++;
  }
  // メッセージ配下に見つからない＝DOMから切り離されている可能性
  return `${id}#?`;
}

/**
 * 画面へ直接出す1行サマリ（2026-08-06）。
 *
 * 送信をコミット経路に依存させると、**壊れた回に限って送れない**（選択が飛んだ状態で
 * シートが開かない／確定が失敗する等）。スクリーンショット1枚で判定できるよう、
 * Sentryにもコミットにも依存しない表示を用意する。
 */
export function formatTraceForScreen(t: SelectionTrace): string {
  // 1行目＝この瞬間の要約。`#`はselectionchangeの発火回数——時点をまたいで増えていなければ、
  // 表示されている値は「新たに測った値」ではなく前の時点のまま（＝イベントが来ていない）。
  // `DIVERGED`は、anchorがRangeのstartでもendでもない状態＝ハンドル側とRange側の乖離
  const summary = [
    `#${t.selectionChangeCount}`,
    `len=${t.lastLength}`,
    `div=${t.boundaryDivergedCount}`,
    t.lastBoundaryDiverged ? 'DIVERGED' : 'ok',
  ].join(' ');
  // 2行目＝ハンドルが従う側（anchor/focus）
  const af = `a=${t.lastAnchorFp}:${t.lastAnchorOffset} f=${t.lastFocusFp}:${t.lastFocusOffset}`;
  // 3行目＝toString()とLumoraのマーカー処理が従う側（正規化されたRange）
  const se = `s=${t.lastRangeStartFp}:${t.lastRangeStartOffset} e=${t.lastRangeEndFp}:${t.lastRangeEndOffset}`;
  // 2行目＝累積の観測値
  const aggregate = [
    `drag#${t.dragSessionIndex}`,
    `over=${t.focusOvertookAnchorCount}`,
    `overRe=${t.focusOvertookAfterRegrabCount}`,
    `st0=${t.scrollTopReachedZeroCount}`,
    `minSt=${t.minScrollTop === Number.MAX_SAFE_INTEGER ? '-' : t.minScrollTop}`,
    `step=${t.minStep}/${t.maxStep}`,
    `anch=${t.lastAnchorPlacement || '-'}`,
  ].join(' ');
  return `${summary}\n${af}\n${se}\n${aggregate}`;
}

// ---------------------------------------------------------------------------
// イベントログ（2026-08-09）
//
// 【なぜ集計ではなく時系列が必要になったか】
// 「左ハンドルが画面外の状態で右ハンドルをタップすると、左ハンドルが文書TOPへ移動する」が
// **Lumora以外の外部サイトでも、同じブラウザで再現した**（実機報告）。かつ別のブラウザでは
// 再現しない。この時点で問うべきは「Lumoraのどのコードか」ではなく
// 「そのタップの瞬間、ブラウザのSelectionそのものが変わっているのか」になる。
//
// それを見るには、最新値の集計では足りない。**1イベントごとのスナップショットを並べる**必要がある。
//
// 【誰が動かしたかを直接割る仕組み】
// selectionchange を Lumora の全ハンドラより**前**（`sc<`）と**後**（`sc>`）の2箇所で記録する。
//   `sc<` の時点で既に壊れている … ブラウザが変更した
//   `sc<` は正常で `sc>` が壊れている … Lumoraのハンドラが変更した
//
// 【本文は記録しない】長さ・オフセット・座標・ノードの通し番号のみ（PII方針）。
// ---------------------------------------------------------------------------

/** 画面に出す行数。手で読める量に抑える */
const EVENT_LOG_VISIBLE = 6;
/** クリップボードへ渡す保持件数 */
const EVENT_LOG_MAX = 40;

const eventLog: string[] = [];
let eventSeq = 0;

/**
 * 境界点（node, offset）の**折りたたんだ**矩形を返す。
 * 注意：`getBoundingClientRect`はレイアウトを強制する。`?selDebug=1`のときしか呼ばれないが、
 * 計測そのものが対象へ影響する可能性は残る（外部サイトでも再現した以上、影響は小さいと考える）。
 */
function collapsedRectAt(node: Node, offset: number): DOMRect | null {
  try {
    const r = document.createRange();
    r.setStart(node, offset);
    r.setEnd(node, offset);
    return r.getBoundingClientRect();
  } catch {
    return null;
  }
}

/** 境界1つ分の記述。`<指紋>:<offset>/t<画面Y>` ＋ 画面外なら `!OFF` */
function describeBoundary(node: Node | null, offset: number): string {
  if (!node) return '-';
  const fp = fingerprintBoundary(node);
  const kind = node.nodeType === Node.TEXT_NODE ? '' : `(${node.nodeName})`;
  const rect = collapsedRectAt(node, offset);
  if (!rect) return `${fp}:${offset}/t?${kind}`;
  const top = Math.round(rect.top);
  // ビューポートの外か。これが CASE A（内）と CASE B（外）のラベルになる
  const off = rect.bottom < 0 || rect.top > window.innerHeight;
  return `${fp}:${offset}/t${top}${off ? '!OFF' : ''}${kind}`;
}

/**
 * 今この瞬間の選択を1行にして記録する。`kind`はイベント種別
 * （`sc<` `sc>` `pd` `pu` `ts` `te`）。`extra`にはLumoraが保持している候補などを渡す。
 * 返り値は画面表示用（直近数件）。
 */
export function logSelectionEvent(kind: string, extra = ''): string {
  if (typeof window === 'undefined') return '';
  const sel = window.getSelection();
  const y = Math.round(window.scrollY);
  eventSeq++;
  let line: string;
  if (!sel) {
    line = `${eventSeq} ${kind} y${y} nosel`;
  } else {
    line = [
      `${eventSeq} ${kind}`,
      `y${y}`,
      `rc${sel.rangeCount}`,
      `L${sel.toString().length}`,
      `a=${describeBoundary(sel.anchorNode, sel.anchorOffset)}`,
      `f=${describeBoundary(sel.focusNode, sel.focusOffset)}`,
      extra,
    ]
      .filter(Boolean)
      .join(' ');
  }
  eventLog.push(line);
  if (eventLog.length > EVENT_LOG_MAX) eventLog.shift();
  return eventLog.slice(-EVENT_LOG_VISIBLE).join('\n');
}

/** 保持している全件。クリップボードへ渡す用 */
export function getFullEventLog(): string {
  return eventLog.join('\n');
}

/** 記録を捨てる。CASE AとCASE Bを別々に取るために使う */
export function clearEventLog(): void {
  eventLog.length = 0;
  eventSeq = 0;
}

/**
 * anchorがどこにいるかを分類する（2026-08-06）。
 * 「1段せり上がった」のか「文書ルートまで完全に失われた」のかで機序が変わるため、
 * 推測せず値で分ける。DOMに触れるのでこの関数はユニットテスト対象外。
 */
export function classifyAnchorPlacement(node: Node | null): string {
  if (!node) return 'none';
  if (!node.isConnected) return 'detached';
  const name = node.nodeName;
  if (name === 'BODY' || name === 'HTML' || node.nodeType === Node.DOCUMENT_NODE) {
    return 'document-root';
  }
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  if (!el?.closest) return 'other';
  if (el.closest('[data-message-id]')) {
    return node.nodeType === Node.TEXT_NODE ? 'text-in-message' : 'element-in-message';
  }
  if (el.closest('[data-workspace-instance]')) return 'in-workspace';
  return 'other';
}
