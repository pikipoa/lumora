/**
 * 会話本文の表示＋マーカー作成（Selection API連携）＋Realm選択の共通ワークスペース。
 *
 * 【検索結果ピーク機能（2026-07-12）】S6フルページ（conversation/[id]/index.tsx）から
 * 抽出した。S6フルページと検索結果からのボトムシート（conversation-peek-sheet.tsx）の
 * 両方がこのコンポーネントを使う。Selection API連携はStep6技術スパイクの結論に基づく
 * 注意深く調整済みのコード（mousedownのpreventDefaultによる選択保持バグ修正など）なので、
 * 2箇所に分岐させず1箇所にまとめている。詳細：
 * C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-12 検索結果からのマーカー作成UX改善（ピーク/ボトムシート化）」
 *
 * メモ機能は含まない（呼び出し側の責務。S6フルページのみが持つ）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// Phase1はWeb版のみのためstatic importで足りる（react-dom自体はreact-native-webの依存として
// 既に入っている）。ネイティブ版に着手する際は、この1行のためだけに.web.tsxへ分割するか
// requireへ落とすかを判断すること
import { useIsFocused } from 'expo-router';
import { createPortal } from 'react-dom';

import {
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { TAB_BAR_HEIGHT } from '@/components/bottom-tab-bar';
import { ThemedText } from '@/components/themed-text';
import {
  computeAutoScrollStep,
  findScrollableAncestor,
  getSelectionAnchorRect,
  getSelectionFocusRect,
} from '@/lib/selectionAutoScroll';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { rangeToOffsets } from '@/lib/domSelection';
import { computeSegments, extractContext, resolveMarkerPosition, type MarkerLayer } from '@/lib/markerLayout';
import { getRecentRealmIds, markRealmUsed, sortByRecency } from '@/lib/recentRealms';
import {
  classifyAnchorPlacement,
  createTrace,
  formatTraceForScreen,
  isAutoScrollDisabled,
  isObserveOnlyMode,
  isRectReadDisabled,
  isScrollerSearchCached,
  isScrollHandlerDisabled,
  isSelectionDebugEnabled,
  type SelectionTrace,
} from '@/lib/selectionDiagnostics';
import { Sentry } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

const MARKER_COLORS = [
  { key: 'pink', hex: '#FF4FA3' },
  { key: 'green', hex: '#3DDC84' },
  { key: 'yellow', hex: '#FFD23D' },
  { key: 'blue', hex: '#3D9CFF' },
  { key: 'red', hex: '#FF4D4D' },
] as const;

interface ConversationDetail {
  id: string;
  title: string;
  source: string;
  created_at: string | null;
  imported_at: string;
  project_id: string | null;
  projects: { name: string } | null;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  seq: number;
}

interface MarkerRow {
  id: string;
  message_id: string;
  quoted_text: string;
  color: string | null;
  role_tag: string | null;
  project_id: string | null;
  status: 'proposed' | 'confirmed' | 'rejected';
  start_offset: number | null;
  end_offset: number | null;
  context_before: string | null;
  context_after: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

interface PendingSelection {
  messageId: string;
  start: number;
  end: number;
  text: string;
}

/**
 * シート内に出す失敗理由の識別子（2026-07-28）。
 * 文字列メッセージではなくコードで持つ理由：Sentry・将来のAnalytics・多言語化で
 * 同じ識別子を使い回せるため。文言への変換はUI側（`t.conversation.sheetError`）で行う。
 * 原因を推測して1つに決めつけず、実際に通った経路をそのまま名前にしている。
 */
type SheetErrorCode =
  | 'selection_lost'
  | 'auth_required'
  | 'position_mismatch'
  | 'realm_create_failed'
  // DBへの書き込みが失敗した経路（2026-07-31追加）。それまで結果を確認しておらず、
  // 失敗しても画面に何も出なかった。空実装のAlertと同じ「静かに失敗する」形だった
  | 'save_failed'
  | 'remove_failed'
  | 'realm_assign_failed';

interface Props {
  conversationId: string;
  jumpToMarkerId?: string | null;
  searchTerm?: string | null;
  compact?: boolean;
  onLoaded?: (conversation: { id: string } | null) => void;
}

export function ConversationMarkerWorkspace({ conversationId, jumpToMarkerId, searchTerm, compact, onLoaded }: Props) {
  // このコンポーネントのインスタンスを一意に識別するID（2026-07-26）。
  //
  // 実機の診断で、同一会話のこのコンポーネントが同時に3つマウントされていることが
  // 判明した（messagesInState=86 に対し totalMessageElementsInDom=258＝86×3）。
  // expo-routerのStackは前の画面をマウントしたまま保持するため、検索→ピークシート→
  // フルページと行き来すると同じ会話の画面が積み重なる。
  //
  // 各インスタンスは独立したstate（messages等）を持ち、全インスタンスがdocumentへ
  // selectionchangeリスナーを張る。document全体へのquerySelectorは「DOM順で最初の
  // 要素」を返すため、スコープを絞らないと背後の別インスタンスの要素を掴みうる。
  // DOMアクセスは必ずこのIDでスコープし、自分が描画した要素だけを見る。
  const [instanceId] = useState(() => `wsi-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`);

  const theme = useTheme();
  /** この画面が今フォーカス（前面）にあるか（2026-08-05）。
   *
   *  expo-routerのStackは前の画面をアンマウントせず保持する（同一会話が複数マウント
   *  される件と同じ性質、instanceIdの説明を参照）。会話画面からホームへ移動しても
   *  このコンポーネントは裏で生き続けるため、document.bodyへ直接ポータルしている
   *  確定バー・シートは、画面の前後関係と無関係に表示され続けてしまう
   *  （実機報告：「マーカーで選択したまま、トップページボタンを押すと、この範囲に
   *  マーカーのバーが消えずに残る」）。ポータルの表示はこのフラグでも必ずゲートする。 */
  const isFocused = useIsFocused();
  const [jumpedMarkerId, setJumpedMarkerId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [loading, setLoading] = useState(true);

  // ── マーカー確定シートの状態（2026-07-28）────────────────────────────────
  // 選択範囲を捉えたら、その場でブラウザの選択を解除し、引用テキストをシート内へ
  // 再掲する。本文側の選択を保持しないため、ブラウザ標準の選択メニュー（コピー/共有）
  // と衝突しない。位置合わせも不要になる（DESIGN.mdレビュー承認済み）。
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  /** 色ステップで選択中の色。決定するまでは確定しない（プレビュー用） */
  const [sheetColor, setSheetColor] = useState<string | null>(null);
  /** 長い引用の折りたたみ。3行を超える場合のみトグルを出す */
  /** 色確定後の「Realmを選ぶ」ステップ（v2.1認知フロー。スキップ可）。
   *  保存直後はload()が終わる前に表示するため、表示に必要な情報を持たせる */
  const [realmPicker, setRealmPicker] = useState<{
    markerId: string;
    quotedText: string;
    color: string | null;
  } | null>(null);
  /** 「＋ 新しいRealm」を選んだ時の入力欄 */
  const [newRealmName, setNewRealmName] = useState<string | null>(null);
  /** シート内に1行だけ出す失敗理由。**コードで持ち、文言はUI側（i18n）で解決する**
   *  （2026-07-28）。Sentry・将来のAnalytics・多言語化で同じ識別子を使えるようにするため。
   *  react-native-webの`Alert`は空実装（`static alert() {}`）で、これまで保存失敗を
   *  一度も画面に出せていなかった。原因が何であれ黙って操作を捨てないための受け皿 */
  const [sheetErrorCode, setSheetErrorCode] = useState<SheetErrorCode | null>(null);

  // 選択中の候補（まだ確定していない）。
  // イベントハンドラ内から最新値を読む必要があるためstateではなくrefで持つ
  const candidateRef = useRef<PendingSelection | null>(null);
  /** 診断用：この選択ジェスチャー中に候補が到達した最大の文字数（2026-08-03）。
   *
   *  実機報告：「長文はマーカーができなくて、勝手に短くなったものが採用される」。
   *  保存前ガード（isSelectionPositionValid）はcontent.slice(start,end)===quoted_textの
   *  内部整合性しか見ないため、候補自体が「短いが矛盾の無い値」になっていれば素通りする
   *  ——ガードでは検出できない種類の欠損。推測で直す前に、ドラッグ中に候補が
   *  「一度大きくなってから縮む」のか「そもそも大きくならない」のかを区別する。
   *  本文は送らず、文字数だけをSentryへ記録する */
  const maxCandidateLengthRef = useRef(0);
  /** 切り分け用の計測（2026-08-05・一時的）。?selDebug=1 の時だけ動く。本文は保持しない */
  const traceRef = useRef<SelectionTrace | null>(null);
  /** 直近で指を離した時刻。「離した後にブラウザが勝手に選択を変えたか」の判定に使う */
  const lastReleaseAtRef = useRef(0);
  /** 計測の画面表示（?selDebug=1のみ）。送信をコミット経路に依存させると、
   *  壊れた回に限って送れない可能性があるため、スクリーンショットで判定できるようにする */
  const [traceReadout, setTraceReadout] = useState('');
  /** タッチ時に「この範囲にマーカー」バーを出すかどうか（2026-08-02）。
   *  refと違って再描画が要るのでstateで持つ。中身はrefと同じ候補 */
  const [touchCandidate, setTouchCandidate] = useState<PendingSelection | null>(null);
  /** 選択が複数のメッセージにまたがっているか（2026-08-03）。
   *  markerはmessage_idを1つしか持てないため、この状態ではマーカーを作れない。
   *  黙って部分保存せず、確定バーの代わりに理由を出す */
  const [crossMessage, setCrossMessage] = useState(false);
  /** スクロール中はバーを隠す（2026-08-02）。
   *  読んでいる最中に固定のバーが視界へ残り続けると邪魔になるため、動いている間は消し、
   *  止まったら戻す。**表示の制御だけ**で、候補（candidateRef）には一切触れない。 */
  const [scrolling, setScrolling] = useState(false);
  /** 確定バーのフェード。消える時は速く、現れる時は少しゆっくり（「スッと現れる」ため）。
   *  Animated.Valueは1回だけ作って使い回す（conversation-peek-sheet.tsxと同じ書き方） */
  const [markBarOpacity] = useState(() => new Animated.Value(0));
  /** 直近の pointerdown が mouse だったか（selectionchange 自体にはポインタ種別が
   *  含まれないため、pointerdown で先に記録しておく）。2026-08-01修正：以前は
   *  pointerType を見ずに selectionchange のたびに900msタイマーを一律でセットしており、
   *  マウスで長文をドラッグ選択中に少し止まる（オートスクロール待ち・持ち直し等）だけで
   *  ボタンを離す前にタイマーが発火し、志半ばで確定してしまっていた */
  const lastPointerWasMouseRef = useRef(false);
  /** シートが開いているか（イベントハンドラから参照するためstateのミラー）。
   *  render中にrefを書き換えるのはReactの規約違反なのでeffectで同期する */
  const sheetOpenRef = useRef(false);
  useEffect(() => {
    sheetOpenRef.current = pendingSelection !== null || realmPicker !== null;
  }, [pendingSelection, realmPicker]);

  /** 選択確定時に「同じ範囲の既存マーカー」を探すための橋渡し（2026-07-31）。
   *  selectionchangeのハンドラはuseEffect内のクロージャなので、最新のlayersByMessageと
   *  startEditingMarkerを直接は見られない。refで最新版を渡す */
  const layersRef = useRef<Record<string, MarkerLayer[]>>({});
  const startEditingMarkerRef = useRef<((messageId: string, layer: MarkerLayer) => void) | null>(null);

  // Realmチップの並び順（あとで→直近使用順）用。ユーザーIDが分かってから読み込む
  const [userId, setUserId] = useState<string | null>(null);
  const [recentRealmIds, setRecentRealmIds] = useState<string[]>([]);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setUserId(uid);
      if (uid) getRecentRealmIds(uid).then(setRecentRealmIds);
    });
  }, []);
  const sortedProjects = useMemo(() => sortByRecency(projects, recentRealmIds), [projects, recentRealmIds]);

  const load = useCallback(async () => {
    if (!conversationId) return;
    const [{ data: conv }, { data: msgs }, { data: mks }, { data: proj }] = await Promise.all([
      supabase
        .from('conversations')
        .select('id, title, source, created_at, imported_at, project_id, projects(name)')
        .eq('id', conversationId)
        .single(),
      supabase.from('messages').select('id, role, content, seq').eq('conversation_id', conversationId).order('seq'),
      supabase
        .from('markers')
        .select(
          'id, message_id, quoted_text, color, role_tag, project_id, status, start_offset, end_offset, context_before, context_after',
        )
        .eq('conversation_id', conversationId)
        // 並び順を固定する（2026-07-31）。computeSegmentsは区間の重なりを先勝ちで解決
        // するため、取得順が変わると「どちらのマーカーが描画されるか」がロードごとに
        // 変わりうる。作成順＋idのタイブレーカーで一意に決まるようにする
        // （search-spec.md 3-6と同じ考え方：同値キーには必ず一意なタイブレーカーを付ける）
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase.from('projects').select('id, name').order('created_at', { ascending: false }),
    ]);

    const nextConversation = (conv as unknown as ConversationDetail) ?? null;
    setConversation(nextConversation);
    setMessages(msgs ?? []);
    setMarkers(mks ?? []);
    setProjects(proj ?? []);
    setLoading(false);
    onLoaded?.(nextConversation);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // 会話が切り替わったら、前の会話の本文・マーカーを即座に捨てる（2026-07-26）。
  // 残っていると、新しい会話のIDと前の会話の本文が同時に画面に存在する瞬間が生まれ、
  // Selection APIで読んだ座標を誤ったcontentに対して検証してしまう。
  // loading表示に戻すことで、読み込み完了までマーカー操作自体を成立させない。
  useEffect(() => {
    setConversation(null);
    setMessages([]);
    setMarkers([]);
    // closeSheet()を呼ばずに個別のsetterを並べているのは、closeSheetが毎レンダー
    // 再生成される関数で、依存配列に入れると会話が変わっていなくても毎回走るため。
    // setterは安定しているので依存配列に含める必要がない
    setPendingSelection(null);
    setEditingMarkerId(null);
    setSheetColor(null);
    setRealmPicker(null);
    setNewRealmName(null);
    setSheetErrorCode(null);
    // 前の会話で選びかけていた候補を、新しい会話へ持ち越さない
    candidateRef.current = null;
    maxCandidateLengthRef.current = 0;
    setTouchCandidate(null);
    setCrossMessage(false);
    setLoading(true);
  }, [conversationId]);

  useEffect(() => {
    load();
  }, [load]);

  // 整理待ち等からの遷移：該当マーカーへスクロールし、一時的にハイライトする
  useEffect(() => {
    if (!jumpToMarkerId || loading || Platform.OS !== 'web') return;
    const el = document.querySelector(`[data-testid="marker-segment-${jumpToMarkerId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setJumpedMarkerId(jumpToMarkerId);
    const timer = setTimeout(() => setJumpedMarkerId(null), 2500);
    return () => clearTimeout(timer);
  }, [jumpToMarkerId, loading]);

  // 整理待ち等からの遷移で着地したマーカーがRealm未割当なら、その場でRealm選択ステップを
  // 自動的に開く（2026-07-24、ピキさんUXフィードバック）。従来は再度テキストを選び直して
  // 色を選び直さないとRealm選択肢が出ず、「マーカーを確認しに来ても何をしていいか
  // わからない」導線のギャップになっていた。読み込み完了時に一度だけ判定する
  // （markersを依存に含めると、Realm割当後のリロードのたびにスクロールし直してしまう）
  useEffect(() => {
    if (!jumpToMarkerId || loading) return;
    const target = markers.find((m) => m.id === jumpToMarkerId);
    if (target && !target.project_id) {
      setRealmPicker({ markerId: target.id, quotedText: target.quoted_text, color: target.color });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpToMarkerId, loading]);

  // 検索結果からのピーク：検索語を含む最初のメッセージを特定し、そこへスクロールする。
  // search_conversationsは会話単位のヒットしか返さないため、メッセージ本文はここで
  // 改めてクライアント側スキャンする（RPC/スキーマは変更しない）
  const searchMatch = useMemo(() => {
    if (!searchTerm) return null;
    const term = searchTerm.toLowerCase();
    for (const m of messages) {
      const idx = m.content.toLowerCase().indexOf(term);
      if (idx !== -1) return { messageId: m.id, start: idx, end: idx + searchTerm.length };
    }
    return null;
  }, [messages, searchTerm]);

  useEffect(() => {
    if (!searchMatch || loading || Platform.OS !== 'web') return;
    // ボトムシートの場合、マウント直後はスライドイン中（translateYアニメーション）のため、
    // アニメーション（260ms）が収まってから実行する。
    // メッセージ本文全体（View全体）ではなく、赤下線のヒット箇所そのものへスクロールする
    // （メッセージが長文の場合、メッセージ全体を中央寄せするとヒット位置が画面外にずれるため）
    const timer = setTimeout(() => {
      const el = document.querySelector('[data-testid="search-match-highlight"]');
      el?.scrollIntoView({ block: 'center', behavior: 'auto' });
    }, 350);
    return () => clearTimeout(timer);
  }, [searchMatch, loading]);

  /**
   * 保留中の候補を確定して色選択シートを開く。
   * マウス（pointerup）とタッチ（バーのタップ）の両方から呼ばれるため、
   * effectの外に置いてrefで橋渡しする（2026-08-02）。
   */
  function commitCandidate() {
    const candidate = candidateRef.current;
    candidateRef.current = null;
    setTouchCandidate(null);

    // 診断（2026-08-03）：確定した長さが、ドラッグ中に一度でも到達した最大長より
    // 明確に短ければ、「一度大きくなってから縮んだ」ことの証拠としてSentryへ記録する。
    // 本文は送らない。差が無ければ記録しない（正常なケースを埋めないため）
    const maxSeen = maxCandidateLengthRef.current;
    maxCandidateLengthRef.current = 0;
    if (candidate && maxSeen - candidate.text.length > 5) {
      Sentry.captureMessage('マーカー候補が確定時に縮んでいた（診断）', {
        level: 'warning',
        extra: { maxSeenLength: maxSeen, finalLength: candidate.text.length, messageId: candidate.messageId },
      });
    }

    // 切り分け用の計測（2026-08-05・一時的）。?selDebug=1 の時、1回の選択操作の全体像を
    // まとめて1件送る。**成否に関わらず必ず送る**——「正常な回」との比較が要るため。
    // 本文は一切含まない（長さ・回数・オフセットのみ）
    const trace = traceRef.current;
    traceRef.current = null;
    lastReleaseAtRef.current = 0;
    if (isSelectionDebugEnabled() && trace) {
      Sentry.captureMessage('選択操作の計測（診断）', {
        level: 'info',
        extra: {
          autoScrollDisabled: isAutoScrollDisabled(),
          durationMs: Date.now() - trace.startedAt,
          selectionChangeCount: trace.selectionChangeCount,
          touchMoveCount: trace.touchMoveCount,
          scrollWriteCount: trace.scrollWriteCount,
          releaseCount: trace.releaseCount,
          changeAfterReleaseCount: trace.changeAfterReleaseCount,
          anchorCollapsedToZeroCount: trace.anchorCollapsedToZeroCount,
          // 仮説①（DOM削除による境界点のせり上がり）の判定材料
          anchorBecameElementCount: trace.anchorBecameElementCount,
          anchorDisconnectedCount: trace.anchorDisconnectedCount,
          lastAnchorNodeName: trace.lastAnchorNodeName,
          lastAnchorInsideMessage: trace.lastAnchorInsideMessage,
          // 「1段せり上がった」か「文書ルートまで失われた」かの判別
          lastAnchorPlacement: trace.lastAnchorPlacement,
          anchorAtDocumentRootCount: trace.anchorAtDocumentRootCount,
          anchorBrokeWhileFocusMovingDownCount: trace.anchorBrokeWhileFocusMovingDownCount,
          // オートスクロールの実挙動（stepの符号・scrollTopの推移・追い越しの有無）
          minStep: trace.minStep,
          maxStepObserved: trace.maxStep,
          minScrollTop: trace.minScrollTop === Number.MAX_SAFE_INTEGER ? -1 : trace.minScrollTop,
          lastScrollTop: trace.lastScrollTop,
          scrollTopReachedZeroCount: trace.scrollTopReachedZeroCount,
          lastAnchorTop: trace.lastAnchorTop,
          focusOvertookAnchorCount: trace.focusOvertookAnchorCount,
          dragSessionIndex: trace.dragSessionIndex,
          focusOvertookAfterRegrabCount: trace.focusOvertookAfterRegrabCount,
          lastAnchorOffset: trace.lastAnchorOffset,
          lastFocusOffset: trace.lastFocusOffset,
          traceMaxLength: trace.maxLength,
          traceLastLength: trace.lastLength,
          committedLength: candidate?.text.length ?? 0,
        },
      });
    }

    if (!candidate) return;
    // 引用はシート内に再掲するので、本文側の選択はここで解除してよい
    if (Platform.OS === 'web') window.getSelection()?.removeAllRanges();

    // 既存マーカーとまったく同じ範囲を選び直した場合は、2件目を作らずに
    // **そのマーカーの編集として開く**（2026-07-31、DESIGN.md「マーカーの重なり」）。
    // 同じ範囲を選び直す行為は、ほぼ確実に「この場所のマーカーを変えたい」という意思であり、
    // 2件目を作ると片方が表示規則で隠れて「編集も削除も効かない」状態になる
    const existing = (layersRef.current[candidate.messageId] ?? []).find(
      (l) => l.start === candidate.start && l.end === candidate.end,
    );
    if (existing && startEditingMarkerRef.current) {
      startEditingMarkerRef.current(candidate.messageId, existing);
      return;
    }

    setPendingSelection(candidate);
    setEditingMarkerId(null);
    setSheetColor(null);
    setSheetErrorCode(null);
  }
  const commitCandidateRef = useRef(commitCandidate);
  useEffect(() => {
    commitCandidateRef.current = commitCandidate;
  });

  // Step6スパイクの結論：ブラウザ標準Selection APIで範囲を読み取る。
  //
  // 【2026-07-28】引用テキストは確定シート内へ再掲するため、確定後は本文側の選択を
  // 保持しなくてよい（ブラウザ標準の選択メニューも消える）。
  //
  // ただし**選択が終わってから**確定すること。selectionchangeはドラッグ中に何度も
  // 発火するため、最初の発火で確定して選択を解除すると、1文字捉えた時点でシートが開き
  // 範囲を伸ばせなくなる（2026-07-28に実際に作り込んだ不具合）。
  //
  // 【2026-08-01修正】上のコメントは「マウスはpointerupで確定する」と書いていたが、
  // 実装はselectionchangeのたびにポインタ種別を見ずに900msタイマーを一律でセットして
  // いた。長文をマウスでドラッグ選択中、オートスクロール待ちや持ち直しで900ms以上
  // 選択が動かない瞬間があると、ボタンをまだ押したままなのにタイマーが先に発火し、
  // 志半ばで確定してしまっていた（実機報告：「PCはスクロールされるが途中で色選択に
  // なる」）。マウスではこのタイマーを一切使わず、pointerupだけで確定するよう分離した。
  //
  // 【2026-08-02・タッチの確定方法を変更】時間による自動確定を**廃止**した。
  //
  // 原因：**選択ハンドルのドラッグはブラウザ自身のUI操作であり、touchstart/touchendが
  // ページへ配信されない。** そのため「指が触れている間は確定しない」というガードが
  // ハンドル操作中には効かず、ゆっくり操作するほど誤爆した（実機報告：「ゆっくり下に
  // 進もうと指の動きが少ないと色選択になる」）。
  //
  // タッチには「選択し終わった」を示す信号が存在しない。待ち時間を延ばしても、ゆっくり
  // 操作する人ほど誤爆するため原理的に解決しない。**推測をやめ、ユーザーの明示的な操作で
  // 確定する**方式へ変えた。選択がある間は画面下部にバーを出し、タップで確定する。
  //   - マウス：pointerupで確定（信頼できる信号があるため従来どおり）
  //   - タッチ：「この範囲にマーカー」バーのタップで確定
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    /**
     * 候補を持たない状態にする（クリア）。「凍結させるより消す方が安全」という
     * 方針の実体（2026-08-05）。以前はここを個別の早期returnごとにコピーしていたが、
     * 一部の早期return（selectedInstanceId不一致・text空）に書き忘れがあり、
     * そこを通ると候補も表示中の文字数も更新されないまま止まる欠損が残っていた
     * （実機報告：「掴み直した後、バーの数字は止まる」）。以後は
     * 「有効な候補を作れた時だけ更新し、それ以外は必ずこれを呼ぶ」の一本にする。
     */
    function clearCandidate() {
      candidateRef.current = null;
      maxCandidateLengthRef.current = 0;
      setTouchCandidate(null);
    }

    function onSelectionChange() {
      // シートを開いている間は本文の選択を追わない（シート内テキストの選択等に反応しない）
      if (sheetOpenRef.current) return;

      const sel = window.getSelection();

      // 切り分け用の計測（2026-08-05・一時的）。本文は一切見ない
      if (isSelectionDebugEnabled() && sel) {
        const tr = (traceRef.current ??= createTrace());
        tr.selectionChangeCount++;
        if (lastReleaseAtRef.current > 0 && Date.now() - lastReleaseAtRef.current < 2000) {
          // 指を離した後に来た変化＝ブラウザ側が勝手に選択を作り直している証拠になりうる
          tr.changeAfterReleaseCount++;
        }
        const prevAnchor = tr.lastAnchorOffset;
        const prevFocusOffset = tr.lastFocusOffset;
        tr.lastAnchorOffset = sel.anchorOffset;
        tr.lastFocusOffset = sel.focusOffset;
        if (prevAnchor > 0 && sel.anchorOffset === 0) tr.anchorCollapsedToZeroCount++;

        // 仮説①（DOM削除でRangeの境界点が親へせり上がる）の直接検証。
        // 境界点を含むノードが削除されると、DOM仕様により境界点は
        // 「親ノード＋そのノードのindex」へ移動する。連鎖すれば本文コンテナ直下＝先頭に着地する。
        // anchorNodeがテキストノードでなくなっていれば、それが起きた証拠になる
        const an = sel.anchorNode;
        if (an) {
          tr.lastAnchorNodeName = an.nodeType === Node.TEXT_NODE ? '#text' : an.nodeName;
          if (an.nodeType !== Node.TEXT_NODE) tr.anchorBecameElementCount++;
          if (!an.isConnected) tr.anchorDisconnectedCount++;
          const anEl = an.nodeType === Node.TEXT_NODE ? an.parentElement : (an as Element);
          tr.lastAnchorInsideMessage = !!anEl?.closest?.('[data-message-id]');

          // 「1段せり上がった」のか「文書ルートまで完全に失われた」のかを値で分ける
          const placement = classifyAnchorPlacement(an);
          tr.lastAnchorPlacement = placement;
          if (placement === 'document-root') tr.anchorAtDocumentRootCount++;

          // 実機で確認された非対称（右ハンドルを下へ引いた時だけ壊れる）の裏付け。
          // focusOffsetが増えている＝右へ／下へ伸ばしている最中とみなす
          const anchorIsBroken = placement !== 'text-in-message';
          const focusMovingForward = sel.focusOffset > prevFocusOffset;
          if (anchorIsBroken && focusMovingForward) tr.anchorBrokeWhileFocusMovingDownCount++;

          // focusがanchorを追い越したか（Rangeのstart側がfocusになった）。
          // 「見えている左ハンドルは、もはやanchorではなくfocus」の検証。
          // compareDocumentPositionで文書順を直接比べる（DOM_POSITION_PRECEDING=2）
          let overtook = false;
          if (sel.focusNode && sel.focusNode !== an) {
            overtook =
              (an.compareDocumentPosition(sel.focusNode) & Node.DOCUMENT_POSITION_PRECEDING) !== 0;
          } else if (sel.focusNode === an && sel.focusOffset < sel.anchorOffset) {
            // 同一ノード内での追い越し
            overtook = true;
          }
          if (overtook) {
            tr.focusOvertookAnchorCount++;
            // 「掴み直しが必要」という未説明の条件を切り分ける。2回目以降だけで起きるなら
            // それが機序の核心になる
            if (tr.dragSessionIndex > 1) tr.focusOvertookAfterRegrabCount++;
          }
        }
        const len = sel.toString().length;
        tr.lastLength = len;
        tr.maxLength = Math.max(tr.maxLength, len);
        // 画面へ即時反映する（Sentry・コミット経路に依存せず判定できるように）
        setTraceReadout(formatTraceForScreen(tr));
      }

      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        // 選択が解除された＝作りかけの候補も捨てる。バーも下げる
        clearCandidate();
        setCrossMessage(false);
        return;
      }
      const domRange = sel.getRangeAt(0);

      // このワークスペース内で始まった選択かどうかを、まず1回だけ判定する（2026-08-05）。
      // 判定にはstartContainer（選択の起点＝動かない側）を使う——commonAncestorContainerで
      // 判定すると、選択が伸びて共通祖先が本文の外へ出た瞬間に「担当外」と誤判定される
      // （オートスクロールのスコープ判定を anchor 基準にしたのと同じ理由。
      // 「選択が下部タブバーへ逃げて詰まる問題」参照）。
      // 無関係な場所の選択（他インスタンス・シート内など）には一切反応しない——
      // ここがfalseの場合だけは、候補に触れずそのまま抜けてよい（自分の担当ではないため）。
      const startEl =
        domRange.startContainer.nodeType === Node.TEXT_NODE
          ? domRange.startContainer.parentElement
          : (domRange.startContainer as Element | null);
      const startedInThisWorkspace =
        (startEl?.closest?.('[data-workspace-instance]') as HTMLElement | null)?.getAttribute(
          'data-workspace-instance',
        ) === instanceId;
      if (!startedInThisWorkspace) return;

      // ここから先、この選択は自分の担当である。**有効な候補を作れた時だけ更新し、
      // それ以外の経路は必ずclearCandidate()を通す**——凍結を二度と作らない。

      // どのメッセージ内の選択かは、JS側のマップ（旧messageRefs）ではなくDOM自身が持つ
      // data-message-id から決める（2026-07-26）。選択はDOM上の出来事なので、
      // 「実際に描画されている要素に書かれたID」が最も確かな情報になる。
      const anchorNode =
        domRange.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? domRange.commonAncestorContainer.parentElement
          : (domRange.commonAncestorContainer as Element | null);
      const messageEl = anchorNode?.closest?.('[data-message-id]') as HTMLElement | null;
      const messageId = messageEl?.getAttribute('data-message-id') ?? null;

      // 選択が1つのメッセージを越えた、またはmessageElが解決できない場合（2026-08-03）。
      // markerはmessage_idを1つしか持てないため、複数メッセージにまたがるマーカーは
      // データモデル上作れない。
      //
      // 「メッセージをまたいだ」と自信を持って言えるのは、開始点にメッセージの手がかりが
      // あった場合だけ。それ以外は原因不明として、誤った理由を出さない
      // （役割ラベルに選択が触れた場合など。messageRoleLabelのuserSelect:'none'で
      // 主要因は塞いだが、念のためここでも凍結させない）。
      if (!messageEl || !messageId) {
        clearCandidate();
        setCrossMessage(!!startEl?.closest?.('[data-message-id]'));
        return;
      }
      setCrossMessage(false);

      const selectedInstanceId =
        (anchorNode?.closest?.('[data-workspace-instance]') as HTMLElement | null)?.getAttribute(
          'data-workspace-instance',
        ) ?? null;
      // このコンポーネントは同時に複数マウントされる（実機で同一会話3つを確認）。
      // expo-routerのStackが前の画面を保持し、フルページとピークシートも別インスタンス。
      // startedInThisWorkspaceは「選択がどこで始まったか」、これは「選択が今どこに
      // 属するか」——選択が進むうちに別インスタンスの領域へ実際に移った場合は、
      // もう自分の担当ではないので候補を手放す
      if (selectedInstanceId !== instanceId) {
        clearCandidate();
        return;
      }

      const { start, end, text } = rangeToOffsets(messageEl, domRange);
      if (!text) {
        clearCandidate();
        return;
      }

      // 候補として保持する。ここでは確定しない
      const candidate = { messageId, start, end, text };
      candidateRef.current = candidate;
      maxCandidateLengthRef.current = Math.max(maxCandidateLengthRef.current, text.length);

      // マウスは pointerup で確定するのでバーは出さない。
      // タッチ／ペンは「この範囲にマーカー」バーを出し、タップされるまで待つ
      if (!lastPointerWasMouseRef.current) setTouchCandidate(candidate);
    }

    // selectionchange自体にはポインタ種別が含まれないため、pointerdownで先に記録しておく
    function onPointerDown(e: PointerEvent) {
      lastPointerWasMouseRef.current = e.pointerType === 'mouse';
    }

    // マウスは「離した＝選択し終わった」が明確なので、そのまま確定する
    function onPointerUp(e: PointerEvent) {
      if (e.pointerType !== 'mouse' || sheetOpenRef.current) return;
      // このpointerupの後に最後のselectionchangeが来ることがあるため、1フレーム待つ
      setTimeout(() => commitCandidateRef.current(), 0);
    }

    // 計測のみ（2026-08-05・一時的）。挙動には影響しない
    function onAnyRelease() {
      if (!isSelectionDebugEnabled()) return;
      lastReleaseAtRef.current = Date.now();
      const tr = (traceRef.current ??= createTrace());
      tr.releaseCount++;
      // 指を離した＝次に触れば「掴み直し」。ドラッグ回数を進める
      tr.dragSessionIndex++;
      // 画面表示を更新する（描画のためstateへ写す）
      setTraceReadout(formatTraceForScreen(tr));
    }
    function onAnyTouchMove() {
      if (!isSelectionDebugEnabled()) return;
      (traceRef.current ??= createTrace()).touchMoveCount++;
    }

    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointerup', onAnyRelease);
    document.addEventListener('touchend', onAnyRelease);
    document.addEventListener('touchmove', onAnyTouchMove);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointerup', onAnyRelease);
      document.removeEventListener('touchend', onAnyRelease);
      document.removeEventListener('touchmove', onAnyTouchMove);
    };
  }, [conversationId, instanceId]);

  // 選択中のオートスクロール（2026-08-01）。
  //
  // 【上の確定ロジックとは完全に independent】
  // この効果が行うのは`container.scrollTop`の更新だけで、候補（candidateRef）にも
  // 確定タイマーにも一切触れない。したがって最悪の場合でも「スクロールしない」で済み、
  // マーカーの作成・確定が壊れることはない。
  //
  // 【なぜ必要か】
  // 本文はScrollView（overflow:autoのdiv）の中にある。ブラウザ標準の「選択中に端まで来たら
  // スクロールする」挙動は、ネストしたスクロールコンテナ、特にモバイルの選択ハンドル操作では
  // 働かないことが多く、「1画面に収まる範囲しか選べない」制約になっていた（実機報告）。
  //
  // 【暴走防止】
  // rAFで回すのは「指を離すまでスクロールし続ける」ために必要だが、止まらなくなると危険。
  // 次のいずれかで必ず停止する：ポインタを離した／選択が解除された／シートが開いた／
  // これ以上スクロールできない／実際にscrollTopが動かなくなった／絶対上限（8秒）。
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    // 切り分け実験（2026-08-05）：?noAutoScroll=1 のときは一切スクロールさせない。
    // 「掴み直すと選択が壊れる／繰り返すと効かなくなる」の原因が、選択中にscrollTopを
    // プログラムから書き換えることにあるのかを、同一ビルドのまま比較するためのスイッチ
    if (isAutoScrollDisabled()) return;

    /** 万一どの停止条件も効かなかった場合の最後の砦 */
    const MAX_DURATION_MS = 8000;

    let rafId: number | null = null;
    let startedAt = 0;
    let target: HTMLElement | null = null;

    const stop = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      rafId = null;
      target = null;
    };

    const tick = () => {
      rafId = null;
      const container = target;
      if (!container) return;
      if (sheetOpenRef.current) return stop();
      if (Date.now() - startedAt > MAX_DURATION_MS) return stop();

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return stop();

      // Mode 2「計測読み取りなし」（2026-08-07）：イベント登録とRAFは回したまま、
      // 毎フレームのRange生成・getBoundingClientRectだけを止める。
      // ネイティブがハンドルを追跡している最中の強制レイアウト読み取りが関与するかを分ける
      // （詳細：src/lib/selectionDiagnostics.ts の isRectReadDisabled）
      if (isRectReadDisabled()) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const rect = getSelectionFocusRect(sel);
      if (!rect) return stop();
      // アンカー（動かない側）が画面外へ出るとブラウザが選択を壊すため、
      // その手前でスクロールを止める材料として渡す（2026-08-05の実験で確定）
      const anchorRect = getSelectionAnchorRect(sel);

      const box = container.getBoundingClientRect();
      // startedAtは「連続してスクロールし続けている時間」を表す（端から離れるたびにstop()で
      // リセットされ、再び端に来た時だけ新しく始まる。2026-08-05）。これを加速の入力にする——
      // 長文選択で端に長く留まるほど速くなり、指を離さず端まで到達できるようにする
      const msAtEdge = Date.now() - startedAt;
      const step = computeAutoScrollStep(
        {
          focusTop: rect.top,
          focusBottom: rect.bottom,
          containerTop: box.top,
          containerBottom: box.bottom,
          canScrollUp: container.scrollTop > 0,
          canScrollDown: container.scrollTop + container.clientHeight < container.scrollHeight - 1,
          anchorTop: anchorRect?.top,
          anchorBottom: anchorRect?.bottom,
        },
        msAtEdge,
      );
      // 計測（2026-08-06）：stepの符号とscrollTopの推移を実値で記録する。
      // 「anchorは壊れず、focusがanchorを追い越して文書先頭まで回り込む」という筋では
      // anchorの分類は正常を返すため、分類だけでは偽陰性になる
      if (isSelectionDebugEnabled()) {
        const tr = (traceRef.current ??= createTrace());
        tr.minStep = Math.min(tr.minStep, step);
        tr.maxStep = Math.max(tr.maxStep, step);
        tr.lastAnchorTop = anchorRect ? Math.round(anchorRect.top) : -99999;
        const st = container.scrollTop;
        tr.minScrollTop = Math.min(tr.minScrollTop, st);
        tr.lastScrollTop = st;
        if (st === 0) tr.scrollTopReachedZeroCount++;
      }

      if (step === 0) return stop();

      const before = container.scrollTop;
      // Mode 1「観測のみ」（2026-08-06）：ここだけを止める。イベント登録・step計算・RAFは
      // そのまま動かし、「実際の書き込み」が症状の必要条件かどうかを分ける
      if (!isObserveOnlyMode()) container.scrollTop = before + step;
      if (isSelectionDebugEnabled()) (traceRef.current ??= createTrace()).scrollWriteCount++;
      // 実際に動かなかった＝端に到達している。回し続けない。
      // ただし観測のみモードでは書いていないので当然動かない——ここで止めると
      // ループが1フレームで終わってしまい「そのまま動かす」実験にならない
      if (!isObserveOnlyMode() && container.scrollTop === before) return stop();

      rafId = requestAnimationFrame(tick);
    };

    /**
     * findScrollableAncestor をマウント後1度だけに減らす実験用のキャッシュ（2026-08-07）。
     * `?cacheScroller=1` のときだけ使う。詳細は selectionDiagnostics.ts の isScrollerSearchCached
     */
    let cachedScroller: HTMLElement | null = null;

    function onSelectionChangeForScroll() {
      // L1bの切り分け（2026-08-07）：登録は残したまま本体だけを実行しない
      if (isScrollHandlerDisabled()) return;
      if (sheetOpenRef.current) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return stop();

      // 判定には共通祖先ではなく**anchor（選択の起点＝動かない側）**を使う（2026-08-02修正）。
      // 共通祖先で見ると、動いている端が本文の外（下部タブバー等）へ一瞬でも出た瞬間に
      // 「担当外の選択」と判断してスクロールが止まり、そこで選択が詰まる。
      // anchorはユーザーが選び始めた場所なので本文の中に留まり続け、判定が安定する。
      const anchor =
        sel.anchorNode?.nodeType === Node.TEXT_NODE
          ? sel.anchorNode.parentElement
          : (sel.anchorNode as Element | null);

      // 自分が描画した本文の中で始まった選択でなければ関与しない（スコープ規則は確定側と同じ）
      const owner = (anchor?.closest?.('[data-workspace-instance]') as HTMLElement | null)?.getAttribute(
        'data-workspace-instance',
      );
      if (owner !== instanceId) return stop();

      // `?cacheScroller=1`：祖先を遡る getComputedStyle / scrollHeight の読み取り（＝強制レイアウト）を
      // 選択イベントの経路から外し、初回1度だけに減らす。ハンドラの他の部分は動かしたまま
      const container = isScrollerSearchCached()
        ? (cachedScroller ??= findScrollableAncestor(anchor))
        : findScrollableAncestor(anchor);
      if (!container) return stop();

      target = container;
      if (rafId == null) {
        startedAt = Date.now();
        rafId = requestAnimationFrame(tick);
      }
    }

    // 停止経路。二重起動は `if (rafId == null)` で防いでいるが、停止の取りこぼしは
    // 「指を離したのに回り続ける」を生むため、離脱系のイベントも塞いでおく（2026-08-06追加）。
    // lostpointercapture … ドラッグ中にポインタ捕捉を奪われた場合
    // visibilitychange / pagehide … タブ切替・バックグラウンド化でイベントが途絶える場合
    document.addEventListener('selectionchange', onSelectionChangeForScroll);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
    document.addEventListener('lostpointercapture', stop);
    document.addEventListener('touchend', stop);
    document.addEventListener('touchcancel', stop);
    document.addEventListener('visibilitychange', stop);
    window.addEventListener('pagehide', stop);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChangeForScroll);
      document.removeEventListener('pointerup', stop);
      document.removeEventListener('pointercancel', stop);
      document.removeEventListener('lostpointercapture', stop);
      document.removeEventListener('touchend', stop);
      document.removeEventListener('touchcancel', stop);
      document.removeEventListener('visibilitychange', stop);
      window.removeEventListener('pagehide', stop);
      stop();
    };
  }, [instanceId]);

  // スクロール中は確定バーを隠す（2026-08-02）。
  //
  // **表示の制御だけを行う。** 候補（candidateRef）にも確定ロジックにも触れないため、
  // この効果が誤動作しても「バーが出たまま／出ないまま」になるだけで、マーカーの作成は壊れない。
  //
  // スクロールの停止を知る標準的な信号は無いので、最後のscrollイベントから一定時間
  // 動きが無ければ「止まった」とみなす。この待ち時間は表示の演出にすぎず、
  // 確定タイミングとは無関係である（確定は常にユーザーのタップによる）。
  //
  // captureフェーズで拾うのは、本文がネストしたScrollView内にあり、scrollイベントが
  // 親要素へバブリングしないため（documentで直接listenしても届かない）。
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    /** 最後のスクロールからこの時間だけ動きが無ければ「止まった」とみなす */
    const SCROLL_IDLE_MS = 180;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const onScroll = () => {
      setScrolling(true);
      if (idleTimer != null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => setScrolling(false), SCROLL_IDLE_MS);
    };

    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('scroll', onScroll, true);
      if (idleTimer != null) clearTimeout(idleTimer);
    };
  }, []);

  // 確定バーのフェード。DESIGN.md原則5「Motion Has Meaning」に沿い、状態変化を
  // 伝えるためだけに使う。消える時は即座に（読む邪魔をしない）、現れる時は少し余韻を
  // 持たせる（「スッと現れる」）
  const sheetIsOpen = !!pendingSelection || !!realmPicker;
  const showMarkBar = !!touchCandidate && !sheetIsOpen && !scrolling;
  // またがっている間は確定バーの代わりに理由を出す。位置とフェードは同じものを使う
  const showCrossMessage = crossMessage && !sheetIsOpen && !scrolling;
  useEffect(() => {
    const visible = showMarkBar || showCrossMessage;
    Animated.timing(markBarOpacity, {
      toValue: visible ? 1 : 0,
      duration: visible ? 160 : 90,
      useNativeDriver: true,
    }).start();
  }, [showMarkBar, showCrossMessage, markBarOpacity]);

  function clearNativeSelection() {
    if (Platform.OS === 'web') window.getSelection()?.removeAllRanges();
  }

  /** 確定シートを閉じ、関連する一時状態を全て捨てる */
  function closeSheet() {
    clearNativeSelection();
    setPendingSelection(null);
    setEditingMarkerId(null);
    setSheetColor(null);
    setRealmPicker(null);
    setNewRealmName(null);
    setSheetErrorCode(null);
    // 保留中の候補とバーも片付ける（選択を解除するので、残しておく意味がない）
    candidateRef.current = null;
    maxCandidateLengthRef.current = 0;
    setTouchCandidate(null);
    setCrossMessage(false);
  }

  /**
   * 既存マーカーをタップ→確定シートを開く（2026-07-28）。
   * 以前はブラウザのネイティブ選択として範囲を復元していたが、引用はシート内へ
   * 再掲するので復元は不要になった（offsetsToRangeも使わない）。
   */
  function startEditingMarker(messageId: string, layer: MarkerLayer) {
    const marker = markers.find((m) => m.id === layer.id);
    if (!marker) return;
    clearNativeSelection();
    setEditingMarkerId(layer.id);
    setPendingSelection({ messageId, start: layer.start, end: layer.end, text: marker.quoted_text });
    setSheetColor(marker.color);
    setRealmPicker(null);
    setSheetErrorCode(null);
  }

  /**
   * 保存直前の座標検証（2026-07-26）。
   *
   * Selection APIから求めたstart/endが、実際にその位置のテキストと一致するかを確認する。
   * 一致しないまま保存すると、表示時に本文の全く別の場所へマーカーが付いてしまう。
   *
   * 実地調査の結果、不一致の原因は翻訳・文章校正などのブラウザ拡張機能による
   * ページ書き換えだった（Reactの描画は正しく、拡張機能がDOMのテキストを言い換え・
   * 改行削除・要素の重複や並び替えをしていた）。拡張機能はこちらから制御できないため、
   * 検出して保存を止め、ユーザーに原因を伝えるのが唯一の正しい対処になる。
   * 詳細な調査経緯はCHANGELOG.md参照。
   */
  function isSelectionPositionValid(
    sourceMessage: MessageRow | undefined,
    start: number,
    end: number,
    quotedText: string,
  ): boolean {
    if (!sourceMessage) return false;
    return sourceMessage.content.slice(start, end) === quotedText;
  }

  /**
   * 開発時のみ：マーカーを保存する直前の内容をログに出す（2026-07-27）。
   * 表示時のログ（layersByMessage内）と突き合わせると、保存↔表示のどこでズレたかが
   * 一目で分かる。本番ビルドでは__DEV__がfalseになり一切実行されない。
   */
  function logMarkerSave(
    kind: 'insert' | 'update',
    payload: { quotedText: string; startOffset: number; endOffset: number; before: string; after: string },
  ) {
    if (typeof __DEV__ === 'undefined' || !__DEV__) return;
    // eslint-disable-next-line no-console
    console.log(`[marker] 保存(${kind}): ` + JSON.stringify(payload, null, 2));
  }

  /** 座標検証に失敗した時：ユーザーへ原因を伝え、Sentryにも残す（黙って失敗させない）。
   *  以前は`Alert.alert`で通知していたが、react-native-webの`Alert`は空実装
   *  （`static alert() {}`）で**一度も画面に出ていなかった**。シート内の1行へ変更した
   *  （2026-07-28）。Sentryへの記録は従来どおり残す */
  function reportPositionMismatch(quotedText: string) {
    Sentry.captureMessage('マーカーの選択位置の検証に失敗（ブラウザ拡張機能によるDOM書き換えの疑い）', {
      level: 'warning',
      extra: { quotedTextLength: quotedText.length, conversationId },
    });
    setSheetErrorCode('position_mismatch');
  }

  async function recordMarkerHistory(markerId: string, color: string | null, status: string) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    await supabase.from('marker_history').insert({ marker_id: markerId, color, status, user_id: userId });
  }

  async function confirmPendingMarker(color: string) {
    // 以下3つの経路は、いずれも「押しても何も起きない」という同じ症状になる。
    // どれを通ったかをコードで残し、シート内に理由を1行出す（2026-07-28）
    if (!pendingSelection || !conversationId) {
      setSheetErrorCode('selection_lost');
      return;
    }
    setSheetErrorCode(null);
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) {
      setSheetErrorCode('auth_required');
      return;
    }

    // v2.1認知フロー：確定した直後、そのマーカーがRealm未割当なら「Realmを選ぶ」ステップへ進む
    let nextRealmPickerId: string | null = null;

    if (editingMarkerId) {
      const existing = markers.find((m) => m.id === editingMarkerId);
      const quotedText = pendingSelection.text || existing?.quoted_text;
      if (!quotedText) return;

      // 保存直前の座標検証（2026-07-26）。詳細はCHANGELOG.md参照
      const sourceMessage = messages.find((msg) => msg.id === pendingSelection.messageId);
      if (!isSelectionPositionValid(sourceMessage, pendingSelection.start, pendingSelection.end, quotedText)) {
        reportPositionMismatch(quotedText);
        return;
      }

      // 範囲・色・状態のいずれも変化していない場合は履歴を残さない（無駄な追記を避ける）
      const unchanged =
        existing && existing.quoted_text === quotedText && existing.color === color && existing.status === 'confirmed';
      // 前後の文脈も保存する。offsetだけでは「同じ文字列の別の出現箇所」を区別できず、
      // 本文が編集された時にも追従できないため（2026-07-27。markerLayout.ts参照）
      const ctx = extractContext(sourceMessage!.content, pendingSelection.start, pendingSelection.end);
      logMarkerSave('update', {
        quotedText,
        startOffset: pendingSelection.start,
        endOffset: pendingSelection.end,
        before: ctx.before,
        after: ctx.after,
      });
      const { error: updateError } = await supabase
        .from('markers')
        .update({
          quoted_text: quotedText,
          color,
          status: 'confirmed',
          start_offset: pendingSelection.start,
          end_offset: pendingSelection.end,
          context_before: ctx.before,
          context_after: ctx.after,
        })
        .eq('id', editingMarkerId);
      if (updateError) {
        Sentry.captureMessage('マーカーの更新に失敗', {
          level: 'warning',
          extra: { message: updateError.message, code: updateError.code },
        });
        setSheetErrorCode('save_failed');
        return;
      }
      if (!unchanged) await recordMarkerHistory(editingMarkerId, color, 'confirmed');
      if (existing && !existing.project_id) nextRealmPickerId = editingMarkerId;
    } else {
      const quotedText = pendingSelection.text;

      // 保存直前の座標検証（2026-07-26）。上の更新分岐と同じ理由
      const sourceMessage = messages.find((msg) => msg.id === pendingSelection.messageId);
      if (!isSelectionPositionValid(sourceMessage, pendingSelection.start, pendingSelection.end, quotedText)) {
        reportPositionMismatch(quotedText);
        return;
      }

      // 前後の文脈も保存する（2026-07-27）。offsetだけでは「同じ文字列の別の出現箇所」を
      // 区別できず、保存時の検証もそれを検出できない（どちらも文字列は一致するため）
      const ctx = extractContext(sourceMessage!.content, pendingSelection.start, pendingSelection.end);
      logMarkerSave('insert', {
        quotedText,
        startOffset: pendingSelection.start,
        endOffset: pendingSelection.end,
        before: ctx.before,
        after: ctx.after,
      });
      const insertPayload = {
        conversation_id: conversationId,
        message_id: pendingSelection.messageId,
        quoted_text: quotedText,
        color,
        status: 'confirmed',
        proposed_by: 'human',
        user_id: userId,
        start_offset: pendingSelection.start,
        end_offset: pendingSelection.end,
        context_before: ctx.before,
        context_after: ctx.after,
      };
      const { data: created, error: insertError } = await supabase
        .from('markers')
        .insert(insertPayload)
        .select('id')
        .single();
      if (insertError || !created) {
        Sentry.captureMessage('マーカーの作成に失敗', {
          level: 'warning',
          extra: { message: insertError?.message, code: insertError?.code },
        });
        setSheetErrorCode('save_failed');
        return;
      }
      await recordMarkerHistory(created.id, color, 'confirmed');
      nextRealmPickerId = created.id;
    }

    // 色が決まったらRealm選択ステップへ進む（シートの中身が入れ替わる）。
    // load()の完了を待たずに表示できるよう、引用と色をここで渡しておく
    const quoted = pendingSelection.text || markers.find((m) => m.id === editingMarkerId)?.quoted_text || '';
    clearNativeSelection();
    setPendingSelection(null);
    setEditingMarkerId(null);
    setSheetColor(null);
    setNewRealmName(null);
    setRealmPicker(nextRealmPickerId ? { markerId: nextRealmPickerId, quotedText: quoted, color } : null);
    load();
  }

  // マーカーをRealmへ収納する（v2.1：色確定直後 or 既存マーカータップ時）。
  // 割り当てたRealmはローカルの直近使用履歴に記録し、次回以降チップの先頭寄りに出す
  async function assignMarkerToRealm(markerId: string, projectId: string) {
    const { error } = await supabase.from('markers').update({ project_id: projectId }).eq('id', markerId);
    if (error) {
      Sentry.captureMessage('Realmへの収納に失敗', {
        level: 'warning',
        extra: { message: error.message, code: error.code },
      });
      setSheetErrorCode('realm_assign_failed');
      return;
    }
    if (userId) {
      await markRealmUsed(userId, projectId);
      setRecentRealmIds(await getRecentRealmIds(userId));
    }
    closeSheet();
    load();
  }

  /**
   * 「＋ 新しいRealm」：その場でRealmを作って収納する（2026-07-28）。
   * 「この知識に合うRealmがまだ無い」と気づくのはまさにこの瞬間なので、
   * 別画面へ移動せずに済ませられるようにする。
   */
  async function createRealmAndAssign(markerId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!userId) {
      setSheetErrorCode('auth_required');
      return;
    }
    setSheetErrorCode(null);
    const { data: created, error } = await supabase
      .from('projects')
      .insert({ name: trimmed, user_id: userId })
      .select('id')
      .single();
    if (error || !created) {
      // 元は空実装のAlert.alertでDBのエラーメッセージを出そうとしていた（2026-07-28修正）
      Sentry.captureMessage('Realmの作成に失敗', { level: 'warning', extra: { message: error?.message } });
      setSheetErrorCode('realm_create_failed');
      return;
    }
    await assignMarkerToRealm(markerId, created.id);
  }

  async function rejectMarker(markerId: string) {
    const existing = markers.find((m) => m.id === markerId);
    const alreadyRejected = existing?.status === 'rejected';
    const { error } = await supabase.from('markers').update({ status: 'rejected' }).eq('id', markerId);
    if (error) {
      // 以前はerrorを見ておらず、失敗しても画面に何も出なかった（2026-07-31修正）
      Sentry.captureMessage('マーカーを外せなかった', {
        level: 'warning',
        extra: { message: error.message, code: error.code, markerId },
      });
      setSheetErrorCode('remove_failed');
      return;
    }
    if (!alreadyRejected) await recordMarkerHistory(markerId, null, 'rejected');
    closeSheet();
    load();
  }

  const layersByMessage = useMemo(() => {
    const map: Record<string, MarkerLayer[]> = {};
    // 開発時のみ：保存↔表示のズレを追えるように、解決結果を1回のログにまとめて出す。
    // 常時表示のUI通知は増えすぎるため出さない（exact/contextは自動復元でユーザー操作に
    // 影響しない）。本番ビルドでは__DEV__がfalseになり一切実行されない
    const resolutionLog: { markerId: string; resolvedStart: number | null; matchType: string }[] = [];
    for (const marker of markers) {
      if (marker.status === 'rejected') continue;
      const message = messages.find((m) => m.id === marker.message_id);
      if (!message) continue;
      // 位置は3段階で解決する（2026-07-27。markerLayout.ts resolveMarkerPosition参照）：
      //   1. 保存されたoffsetが正しく、前後の文脈も一致 → そのまま使う
      //   2. offsetが使えない／別の出現箇所を指している → 文脈から特定する
      //   3. 決め手がなければ最初の出現箇所（従来の挙動。誤りの可能性あり）
      // offsetだけに頼ると「同じ文字列の別の出現箇所」と本文の編集に対応できない。
      const located = resolveMarkerPosition(message.content, {
        quotedText: marker.quoted_text,
        startOffset: marker.start_offset,
        endOffset: marker.end_offset,
        contextBefore: marker.context_before,
        contextAfter: marker.context_after,
      });
      if (!located) {
        resolutionLog.push({ markerId: marker.id, resolvedStart: null, matchType: 'missing' });
        continue;
      }
      resolutionLog.push({ markerId: marker.id, resolvedStart: located.start, matchType: located.matchType });
      const layer: MarkerLayer = {
        id: marker.id,
        start: located.start,
        end: located.end,
        kind: marker.status === 'confirmed' ? 'confirmed' : 'proposed',
        color: marker.color,
      };
      (map[marker.message_id] ??= []).push(layer);
    }

    if (typeof __DEV__ !== 'undefined' && __DEV__ && resolutionLog.length > 0) {
      const counts = resolutionLog.reduce<Record<string, number>>((acc, r) => {
        acc[r.matchType] = (acc[r.matchType] ?? 0) + 1;
        return acc;
      }, {});
      // 要注意（自動復元できていない）ものだけ個別に出す。exactは件数だけで十分
      const needsAttention = resolutionLog.filter((r) => r.matchType === 'text_only' || r.matchType === 'missing');
      // eslint-disable-next-line no-console
      console.log('[marker] 表示時の位置解決: ' + JSON.stringify({ counts, needsAttention }, null, 2));
    }

    return map;
  }, [markers, messages]);

  // selectionchangeのハンドラから最新の値を参照できるようにする（上のref宣言の説明を参照）
  useEffect(() => {
    layersRef.current = layersByMessage;
    startEditingMarkerRef.current = startEditingMarker;
  });

  const editingMarker = markers.find((m) => m.id === editingMarkerId) ?? null;

  if (loading) {
    return <ActivityIndicator style={{ marginTop: Spacing.five }} />;
  }

  if (!conversation) {
    return <ThemedText style={styles.note}>{t.conversation.notFound}</ThemedText>;
  }

  // ── マーカー確定シート（2026-07-28、DESIGN.mdレビュー承認済み）──────────────
  // 引用テキストをシート内に再掲することで、本文側の選択を保持せずに済む。
  // その結果ブラウザ標準の選択メニューと衝突せず、位置合わせも不要になった。
  // 縦の並びがそのまま思考の順序：「何に」→「どの色で」→「決める」。
  const quotedForSheet = pendingSelection?.text ?? '';
  const sheetColorHex = sheetColor ? MARKER_COLORS.find((c) => c.key === sheetColor)?.hex : undefined;
  const realmPickerColorHex = realmPicker?.color
    ? MARKER_COLORS.find((c) => c.key === realmPicker.color)?.hex
    : undefined;

  const sheet =
    pendingSelection || realmPicker ? (
      <View style={styles.sheetOverlay} testID="marker-sheet">
        {/* スクリム：本文を黒の半透明で沈め、意識をシートへ向ける */}
        <Pressable style={styles.sheetScrim} onPress={closeSheet} testID="marker-sheet-scrim" />
        <ThemedView type="backgroundElement" style={styles.sheetPanel}>
          {realmPicker ? (
            <>
              {/* 決めた色のまま引用を残す（何にマーカーを引いたかを保持する） */}
              <Text
                style={[styles.sheetQuote, { color: theme.text }, realmPickerColorHex && { backgroundColor: realmPickerColorHex }]}
                numberOfLines={2}
              >
                {realmPicker.quotedText}
              </Text>
              <ThemedText type="small" themeColor="textSecondary" style={styles.sheetLabel}>
                {t.conversation.realmStepTitle}
              </ThemedText>
              {newRealmName === null ? (
                <>
                  {sortedProjects.map((p) => (
                    <Pressable
                      key={p.id}
                      style={styles.sheetRow}
                      onPress={() => assignMarkerToRealm(realmPicker.markerId, p.id)}
                      testID={`realm-picker-${p.id}`}
                    >
                      <ThemedText>{p.name}</ThemedText>
                    </Pressable>
                  ))}
                  <Pressable style={styles.sheetRow} onPress={() => setNewRealmName('')} testID="realm-picker-new">
                    <ThemedText themeColor="textSecondary">{t.conversation.newRealmOption}</ThemedText>
                  </Pressable>
                  <Pressable style={styles.sheetRow} onPress={closeSheet} testID="realm-picker-later">
                    <ThemedText themeColor="textSecondary">{t.common.later}</ThemedText>
                  </Pressable>
                </>
              ) : (
                <>
                  <TextInput
                    value={newRealmName}
                    onChangeText={setNewRealmName}
                    placeholder={t.realms.namePlaceholder}
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.sheetInput, { color: theme.text, borderColor: theme.backgroundSelected }]}
                    autoFocus
                    onSubmitEditing={() => createRealmAndAssign(realmPicker.markerId, newRealmName)}
                    testID="new-realm-input"
                  />
                  <Pressable
                    style={styles.sheetRow}
                    onPress={() => createRealmAndAssign(realmPicker.markerId, newRealmName)}
                    testID="new-realm-create"
                  >
                    <ThemedText>{t.conversation.createRealmAndAssign}</ThemedText>
                  </Pressable>
                  <Pressable style={styles.sheetRow} onPress={() => setNewRealmName(null)}>
                    <ThemedText themeColor="textSecondary">{t.common.back}</ThemedText>
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <>
              {/* 何にマーカーを引くか（主役）。色を選ぶとここにプレビューが乗る。
                  **必ず全文を表示する**（2026-08-03）。以前は3行で畳んでトグルを出していたが、
                  200字程度の選択ではほとんどが隠れ、「何を保存しようとしているのか」を
                  確認せずに色を決めることになっていた。マーカーはこのアプリの中心機能であり、
                  確定前に全文を確認できないのは折りたたみの仕様ではなく欠損である。
                  長文で確定ボタンが画面外へ押し出されないよう、引用部分だけをスクロールさせる */}
              <ScrollView style={styles.sheetQuoteScroll} testID="marker-sheet-quote-scroll">
                <Text
                  style={[styles.sheetQuote, { color: theme.text }, sheetColorHex && { backgroundColor: sheetColorHex }]}
                  testID="marker-sheet-quote"
                >
                  {quotedForSheet}
                </Text>
              </ScrollView>
              <ThemedText type="small" themeColor="textSecondary" testID="marker-sheet-quote-length">
                {t.conversation.quoteLength(quotedForSheet.length)}
              </ThemedText>

              <View style={styles.sheetSwatchRow}>
                {MARKER_COLORS.map((c) => (
                  <Pressable
                    key={c.key}
                    onPress={() => {
                      // 色を選び直す＝やり直しの意思表示なので、前回の失敗理由は消す
                      setSheetColor(c.key);
                      setSheetErrorCode(null);
                    }}
                    style={[
                      styles.sheetSwatch,
                      { backgroundColor: c.hex },
                      sheetColor === c.key && styles.sheetSwatchSelected,
                    ]}
                    testID={`marker-color-${c.key}`}
                  />
                ))}
              </View>

              {/* 決定は引用の直下。色が決まるまでは出さない（何を決めるかが一意） */}
              {sheetColor && (
                <Pressable
                  style={styles.sheetRow}
                  onPress={() => confirmPendingMarker(sheetColor)}
                  testID="marker-sheet-confirm"
                >
                  <ThemedText>{t.conversation.confirmColor}</ThemedText>
                </Pressable>
              )}
              {editingMarker && (
                <Pressable
                  style={styles.sheetRow}
                  onPress={() => rejectMarker(editingMarker.id)}
                  testID="reject-marker-button"
                >
                  <ThemedText themeColor="textSecondary">{t.conversation.removeMarker}</ThemedText>
                </Pressable>
              )}
            </>
          )}
          {/* 失敗の伝え方はDESIGN.md原則9に従う：まず配慮、次にすぐできる行動、
              理由は必要な時だけ2行目に小さく添える。アイコン・枠線・背景色は付けない
              （主役は引用テキストのまま）。色ステップ・Realmステップの両方で同じ位置に出す */}
          {sheetErrorCode && (
            <View testID={`marker-sheet-error-${sheetErrorCode}`}>
              <ThemedText type="small">{t.conversation.sheetError[sheetErrorCode].message}</ThemedText>
              {t.conversation.sheetError[sheetErrorCode].note && (
                <ThemedText type="small" themeColor="textSecondary" style={styles.sheetErrorNote}>
                  {t.conversation.sheetError[sheetErrorCode].note}
                </ThemedText>
              )}
            </View>
          )}
        </ThemedView>
      </View>
    ) : null;

  // シートはdocument.body直下へポータルする（2026-07-28、実機の不具合修正）。
  // ポータルしないと、シートは<Stack>配下に描画される一方で下部タブバーは
  // <Stack>の後ろの兄弟として置かれるため（app/_layout.tsx）、スタックコンテキストが
  // 分かれてシートのzIndex:100とタブバーのzIndex:40が比較されない。結果、
  // 画面下端から0〜72pxをタブバーが覆い、その帯にある決定ボタン（下端32〜84px）が
  // 52pxのうち40px隠れて押せなくなっていた。
  // body直下へ出すとアプリのルート要素より後ろに並ぶので、確実に最前面になる。
  // 副次的な効果として、モーダル表示中にタブバーを押して別画面へ離脱できる穴も塞がる
  // （タブバーの位置はスクリムが受け取り、シートを閉じる操作になる）。
  // web以外は従来どおりsheetをそのまま描画する（ポータル不要）。
  // webはisFocusedでもゲートする——前面の画面の時にしかbody直下へ出さない
  const sheetPortal =
    Platform.OS !== 'web'
      ? sheet
      : sheet && typeof document !== 'undefined' && isFocused
        ? createPortal(sheet, document.body)
        : null;

  // タッチでの確定バー（2026-08-02）。選択がある間だけ出し、タップで色選択へ進む。
  // 時間による自動確定を廃止したため、これが唯一の確定手段になる（マウスはpointerup）。
  // シートを開いている間は出さない（確定済みなので用が無い）。
  // **スクロール中も出さない**——読んでいる最中に固定のバーが視界へ残ると邪魔になるため。
  // 候補そのものは保持し続けるので、スクロールが止まればそのまま戻る。
  // シートと同じくbody直下へポータルする——本文はScrollViewの中にあり、その中に置くと
  // スクロールに合わせて動いてしまうため（sheetOverlayの説明も参照）
  const touchBar = showCrossMessage ? (
    // 複数の発言にまたがっている間は作成できないので、確定バーの代わりに理由を出す。
    // 黙って部分保存していた頃の欠損（965文字選んで150文字保存）への対処
    <Animated.View style={[styles.markBar, { opacity: markBarOpacity }]} testID="cross-message-notice">
      <ThemedView type="backgroundElement" style={styles.markBarNotice}>
        <ThemedText type="small">{t.conversation.crossMessage}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t.conversation.crossMessageNote}
        </ThemedText>
      </ThemedView>
    </Animated.View>
  ) : showMarkBar ? (
    <Animated.View style={[styles.markBar, { opacity: markBarOpacity }]} testID="mark-selection-bar">
      <Pressable
        onPress={() => commitCandidateRef.current()}
        style={[styles.markBarButton, { backgroundColor: theme.text }]}
        testID="mark-selection-button"
      >
        <ThemedText style={[styles.markBarLabel, { color: theme.background }]}>
          {t.conversation.markSelection(touchCandidate?.text.length ?? 0)}
        </ThemedText>
      </Pressable>
    </Animated.View>
  ) : null;

  // 計測の画面表示（?selDebug=1のみ・一時的）。画面最上部に固定し、選択が壊れた状態でも
  // 必ず読めるようにする。userSelect:'none'で本文の選択に巻き込まれないようにする
  const debugReadout =
    isSelectionDebugEnabled() && traceReadout ? (
      <View style={styles.debugReadout} testID="selection-debug-readout">
        <ThemedText style={styles.debugReadoutText}>{traceReadout}</ThemedText>
      </View>
    ) : null;

  const debugReadoutPortal =
    Platform.OS !== 'web'
      ? debugReadout
      : debugReadout && typeof document !== 'undefined' && isFocused
        ? createPortal(debugReadout, document.body)
        : null;

  // sheetPortalと同じ理由でisFocusedもゲートする
  const touchBarPortal =
    Platform.OS !== 'web'
      ? touchBar
      : touchBar && typeof document !== 'undefined' && isFocused
        ? createPortal(touchBar, document.body)
        : null;

  return (
    <>
      <ThemedText type="small" themeColor="textSecondary">
        {new Date(conversation.created_at ?? conversation.imported_at).toLocaleDateString('ja-JP')} ・{' '}
        {t.sources[conversation.source] ?? conversation.source} ・{' '}
        {conversation.projects?.name ?? t.conversation.unassigned}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {conversation.title}
      </ThemedText>

      {/* 本文（マーカーハイライト＋範囲選択） */}
      {/* data-workspace-instance がこのインスタンスの境界。DOMを見る処理は必ずこの配下に
          限定する（同一会話のこのコンポーネントが同時に複数マウントされるため。
          詳細はinstanceIdの宣言箇所のコメント） */}
      <ThemedView
        type="backgroundElement"
        style={[styles.section, compact && styles.sectionCompact]}
        {...({ dataSet: { workspaceInstance: instanceId } } as object)}
      >
        <ThemedText type="smallBold">{t.conversation.bodyTitle}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t.conversation.bodyHint}
        </ThemedText>
        {messages.map((m, i) => {
          const layersForMessage = layersByMessage[m.id] ?? [];
          const segments = computeSegments(m.content, layersForMessage);
          return (
            <ThemedView
              key={m.id}
              style={[
                styles.messageRow,
                // 最初の発言には引かない（直上のbodyHintと二重の区切りになるため）
                i > 0 && { borderTopColor: theme.backgroundSelected },
              ]}
            >
              <ThemedText type="smallBold" themeColor="textSecondary" style={styles.messageRoleLabel}>
                {m.role === 'user' ? t.conversation.roleUser : t.conversation.roleAssistant}
              </ThemedText>
              {/* data-message-id が「どのメッセージか」の唯一の正解
                  （2026-07-26。詳細はonSelectionChangeのコメント） */}
              <View {...({ dataSet: { messageId: m.id, conversationId } } as object)}>
                <Text selectable style={[styles.messageText, { color: theme.text }]}>
                  {segments.map((seg) => {
                    // 開始位置は純粋関数computeSegmentsが確定させた値を読むだけにする
                    // （render中に変数を加算しない。理由：markerLayout.ts TextSegment.start）
                    const segStart = seg.start;
                    // 選択範囲→文字位置の変換（rangeToOffsets）がこの属性を土台に使う
                    const segDiagProps: object = { dataSet: { segStart: String(segStart) } };
                    // keyは配列インデックスではなく**本文中の位置**にする（2026-08-05）。
                    //
                    // 【この変更は「左ハンドルが飛ぶ」バグの原因ではない（2026-08-06訂正）】
                    // 当初これを原因と考えたが、必要条件が2つとも成立しないことを後から確認した：
                    //   - computeSegmentsの入力は m.content と layersByMessage（依存は
                    //     [markers, messages]）のみで、**選択中の状態は一切入らない**。
                    //     したがって選択中にセグメント構成は変わらず、key={i}でも
                    //     テキストノードは削除されない
                    //   - setScrolling(true)は連続スクロール中ずっと同じ値なのでReactが
                    //     bailoutする。「毎フレーム再レンダリング」も誤りだった
                    // 原因は未特定のまま。この変更は、マーカーが増減した時（＝実際に
                    // セグメント構成が変わる時）に無駄な再マウントを避けるという、
                    // それ自体として妥当な改善として残す。
                    //
                    // なおcomputeSegmentsの不変条件（隙間なく連続・開始位置が単調増加）に
                    // よりstart-endの組は一意で、keyとして安全
                    const segKey = `${segStart}-${seg.end}`;

                    if (!seg.layer) {
                      // 検索語ハイライト：マーカーが無い区間の中に検索ヒットがあれば、
                      // その部分だけ赤下線で分割描画する（マーカー済み区間は対象外＝十分な簡略化）
                      if (
                        searchMatch &&
                        searchMatch.messageId === m.id &&
                        searchMatch.start < segStart + seg.text.length &&
                        searchMatch.end > segStart
                      ) {
                        const hitStart = Math.max(0, searchMatch.start - segStart);
                        const hitEnd = Math.min(seg.text.length, searchMatch.end - segStart);
                        return (
                          <Text key={segKey} {...segDiagProps}>
                            {seg.text.slice(0, hitStart)}
                            <Text style={styles.searchMatch} testID="search-match-highlight">
                              {seg.text.slice(hitStart, hitEnd)}
                            </Text>
                            {seg.text.slice(hitEnd)}
                          </Text>
                        );
                      }
                      return (
                        <Text key={segKey} {...segDiagProps}>
                          {seg.text}
                        </Text>
                      );
                    }

                    const isProposed = seg.layer.kind === 'proposed';
                    const bg = seg.layer.color
                      ? MARKER_COLORS.find((c) => c.key === seg.layer!.color)?.hex
                      : '#FFD23D88';
                    return (
                      <Text
                        key={segKey}
                        {...segDiagProps}
                        onPress={() => startEditingMarker(m.id, seg.layer!)}
                        style={[
                          { backgroundColor: bg },
                          isProposed && styles.markerProposed,
                          seg.layer.id === editingMarkerId && styles.markerSelected,
                          seg.layer.id === jumpedMarkerId && styles.markerSelected,
                        ]}
                        testID={`marker-segment-${seg.layer.id}`}
                      >
                        {seg.text}
                      </Text>
                    );
                  })}
                </Text>
              </View>
            </ThemedView>
          );
        })}
      </ThemedView>

      {touchBarPortal}
      {sheetPortal}
      {debugReadoutPortal}
    </>
  );
}

const styles = StyleSheet.create({
  note: { opacity: 0.7, padding: Spacing.four },
  section: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  sectionCompact: { padding: Spacing.two, gap: Spacing.one },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  messageText: { fontSize: 16, lineHeight: 24 },
  markerProposed: { borderBottomWidth: 2, borderBottomColor: '#999', borderStyle: 'dashed' },
  markerSelected: { outlineWidth: 2, outlineColor: '#208AEF', outlineStyle: 'solid' } as object,
  searchMatch: { textDecorationLine: 'underline', textDecorationColor: '#FF4D4D', textDecorationStyle: 'solid' } as object,
  // 発言どうしの境界を、枠やカードではなく余白と罫線だけで示す（2026-08-03）。
  // DESIGN.mdのAvoid「カードだらけ／枠だらけ」に触れないため、線は1本・薄い色のみ。
  // 発言をまたいで選択すると保存できない（onSelectionChangeのcrossMessage参照）ため、
  // 区切りを視認しやすくして、そもそもまたぎにくくするのが狙い
  messageRow: {
    gap: Spacing.half,
    paddingVertical: Spacing.three,
    borderTopWidth: 1,
  },
  // 役割ラベル（あなた／AI）はdata-message-idを持つラッパーの**外側の兄弟**（2026-08-05）。
  // 明示しない限りRNWのTextはブラウザ既定（選択可能）のままなので、ここに選択の端が
  // 触れると共通祖先がdata-message-idの外（messageRow）まで持ち上がり、メッセージが
  // 解決できなくなる。掴み直しの指がラベル付近に触れやすいこと（8/3の余白拡大で
  // ラベル周辺の当たり判定も広がった）と符合する（実機報告：「掴み直した後、
  // バーの数字は止まる」）。タブバー・ヘッダーと同じ原則（操作/メタ情報要素は
  // 選択対象にしない）をここにも適用する
  messageRoleLabel: { marginBottom: Spacing.half, userSelect: 'none' } as object,

  // ── マーカー確定シート（2026-07-28）──────────────────────────────
  // 枠線・アイコン・説明文は置かない。引用テキストが最大要素で、色は点、
  // 決定は文字だけ（DESIGN.md 原則3 White Space Is UI / 原則4 Typography First）
  // zIndex:100はdocument.body直下（ポータル先）での値。アプリのルート要素より後ろに
  // 並ぶため実際には順序だけで最前面になるが、将来body直下に別のオーバーレイが
  // 増えた時の比較用に明示しておく（下部タブバーのzIndex:40とは別コンテキスト）
  sheetOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 } as object,

  // ── タッチでの確定バー（2026-08-02）─────────────────────────────
  // 下部タブバー（高さ72・zIndex:40）の上に重ねる。シート（zIndex:100）よりは下。
  // userSelect:'none' は必須——このバー自体が選択に巻き込まれると、選択がスコープ外へ
  // 出て候補が壊れる（ヘッダー・タブバーで実際に起きた症状。bottom-tab-bar.tsx参照）
  markBar: {
    position: 'fixed',
    left: 0,
    right: 0,
    bottom: TAB_BAR_HEIGHT + Spacing.three,
    alignItems: 'center',
    zIndex: 90,
    userSelect: 'none',
  } as object,
  markBarButton: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
    borderRadius: 999,
  },
  markBarLabel: { fontWeight: '600' },
  // 計測の画面表示（?selDebug=1のみ・一時的）。原因確定後に削除する
  debugReadout: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#000000CC',
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    zIndex: 200,
    userSelect: 'none',
  } as object,
  debugReadoutText: { color: '#FFFFFF', fontSize: 11 },
  /** またがっている旨の案内。確定ボタンと同じ位置に出すが、押すものではないので角丸は控えめ */
  markBarNotice: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.two,
    gap: Spacing.one,
    maxWidth: '90%',
  } as object,
  /** スクリム：黒の半透明。ライト/ダークどちらでも本文を沈める */
  sheetScrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000A6' } as object,
  sheetPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '80%',
    paddingTop: Spacing.five,
    paddingBottom: Spacing.five,
    paddingHorizontal: Spacing.four,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    gap: Spacing.three,
  } as object,
  /** 引用テキスト＝主役。色を選ぶとここに背景色が乗る（プレビュー） */
  sheetQuote: { fontSize: 17, lineHeight: 26 },
  /** 引用は常に全文表示するが、長文でも色・決定が画面外へ押し出されないよう
   *  ここだけスクロールさせる。上限はパネル（maxHeight:80%）の中で引用に割く分 */
  sheetQuoteScroll: { maxHeight: 260 },
  sheetLabel: { marginTop: Spacing.one },
  sheetSwatchRow: { flexDirection: 'row', gap: Spacing.four, paddingVertical: Spacing.two },
  sheetSwatch: { width: 28, height: 28, borderRadius: 14 },
  /** 選択中の色だけリングを付ける。未選択は点のまま（ミニマル） */
  sheetSwatchSelected: { outlineWidth: 2, outlineColor: '#E8ECF5', outlineOffset: 3, outlineStyle: 'solid' } as object,
  /** 行＝文字だけ。枠もアイコンも持たせない */
  sheetRow: { paddingVertical: Spacing.three },
  /** 理由の行。1行目（配慮＋行動）より一段下げて、読む順序を目でも作る */
  sheetErrorNote: { marginTop: Spacing.one },
  sheetInput: {
    borderBottomWidth: 1,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
});
