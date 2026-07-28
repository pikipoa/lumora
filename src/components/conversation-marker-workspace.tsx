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
import { createPortal } from 'react-dom';

import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { rangeToOffsets } from '@/lib/domSelection';
import { computeSegments, extractContext, resolveMarkerPosition, type MarkerLayer } from '@/lib/markerLayout';
import { getRecentRealmIds, markRealmUsed, sortByRecency } from '@/lib/recentRealms';
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
  const [quoteExpanded, setQuoteExpanded] = useState(false);
  /** 色確定後の「Realmを選ぶ」ステップ（v2.1認知フロー。スキップ可）。
   *  保存直後はload()が終わる前に表示するため、表示に必要な情報を持たせる */
  const [realmPicker, setRealmPicker] = useState<{
    markerId: string;
    quotedText: string;
    color: string | null;
  } | null>(null);
  /** 「＋ 新しいRealm」を選んだ時の入力欄 */
  const [newRealmName, setNewRealmName] = useState<string | null>(null);

  // 選択中の候補（まだ確定していない）と、確定までの待機タイマー。
  // イベントハンドラ内から最新値を読む必要があるためstateではなくrefで持つ
  const candidateRef = useRef<PendingSelection | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** シートが開いているか（イベントハンドラから参照するためstateのミラー）。
   *  render中にrefを書き換えるのはReactの規約違反なのでeffectで同期する */
  const sheetOpenRef = useRef(false);
  useEffect(() => {
    sheetOpenRef.current = pendingSelection !== null || realmPicker !== null;
  }, [pendingSelection, realmPicker]);

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
        .eq('conversation_id', conversationId),
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
    setQuoteExpanded(false);
    setRealmPicker(null);
    setNewRealmName(null);
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

  // Step6スパイクの結論：ブラウザ標準Selection APIで範囲を読み取る。
  //
  // 【2026-07-28】引用テキストは確定シート内へ再掲するため、確定後は本文側の選択を
  // 保持しなくてよい（ブラウザ標準の選択メニューも消える）。
  //
  // ただし**選択が終わってから**確定すること。selectionchangeはドラッグ中に何度も
  // 発火するため、最初の発火で確定して選択を解除すると、1文字捉えた時点でシートが開き
  // 範囲を伸ばせなくなる（2026-07-28に実際に作り込んだ不具合）。
  //   - マウス：pointerupが「選択し終わった」の明確な合図なので、そこで確定
  //   - タッチ：長押し選択もハンドル操作も selectionchange が連続で出る。最後の変更から
  //     一定時間動きが無ければ確定する（ハンドルを掴めばタイマーは毎回リセットされる）
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    /** タッチで「選択し終わった」とみなすまでの待ち時間。長押し直後にハンドルを掴む余地を残す */
    const TOUCH_SETTLE_MS = 900;

    const clearTimer = () => {
      if (commitTimerRef.current != null) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };

    /** 保留中の候補を確定してシートを開く */
    const commit = () => {
      clearTimer();
      const candidate = candidateRef.current;
      candidateRef.current = null;
      if (!candidate) return;
      setPendingSelection(candidate);
      setEditingMarkerId(null);
      setSheetColor(null);
      setQuoteExpanded(false);
      // 引用はシート内に再掲するので、本文側の選択はここで解除してよい
      window.getSelection()?.removeAllRanges();
    };

    function onSelectionChange() {
      // シートを開いている間は本文の選択を追わない（シート内テキストの選択等に反応しない）
      if (sheetOpenRef.current) return;

      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        // 選択が解除された＝作りかけの候補も捨てる
        candidateRef.current = null;
        clearTimer();
        return;
      }
      const domRange = sel.getRangeAt(0);

      // どのメッセージ内の選択かは、JS側のマップ（旧messageRefs）ではなくDOM自身が持つ
      // data-message-id から決める（2026-07-26）。選択はDOM上の出来事なので、
      // 「実際に描画されている要素に書かれたID」が最も確かな情報になる。
      // このコンポーネントは同時に複数マウントされうる（下のinstanceIdの説明を参照）ため、
      // JS側のマップを唯一の正解にするのは危うい。
      const anchorNode =
        domRange.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? domRange.commonAncestorContainer.parentElement
          : (domRange.commonAncestorContainer as Element | null);
      const messageEl = anchorNode?.closest?.('[data-message-id]') as HTMLElement | null;
      const messageId = messageEl?.getAttribute('data-message-id') ?? null;
      const selectedInstanceId =
        (anchorNode?.closest?.('[data-workspace-instance]') as HTMLElement | null)?.getAttribute(
          'data-workspace-instance',
        ) ?? null;

      if (!messageEl || !messageId) return;

      // このコンポーネントは同時に複数マウントされる（実機で同一会話3つを確認）。
      // expo-routerのStackが前の画面を保持し、フルページとピークシートも別インスタンス。
      // 全インスタンスがdocumentにselectionchangeリスナーを張り、色ツールバーも
      // document.bodyへポータル描画するため、スコープを絞らないと「ユーザーが選択したのは
      // 別インスタンスの画面なのに、こちらのstate（別の読み込みタイミングのmessages）で
      // 検証・保存される」交差が起こる。
      // 自分が描画した要素の中での選択でなければ、このインスタンスは一切関与しない。
      if (selectedInstanceId !== instanceId) return;

      const { start, end, text } = rangeToOffsets(messageEl, domRange);
      if (!text) return;

      // ここでは確定しない。候補として保持し、選択が落ち着いてから確定する
      candidateRef.current = { messageId, start, end, text };
      clearTimer();
      commitTimerRef.current = setTimeout(commit, TOUCH_SETTLE_MS);
    }

    // マウスは「離した＝選択し終わった」が明確。待たずに確定する。
    // タッチ／ペンは長押し選択の直後にハンドル操作が続きうるので、上のタイマーに任せる
    function onPointerUp(e: PointerEvent) {
      if (e.pointerType !== 'mouse' || sheetOpenRef.current) return;
      // このpointerupの後に最後のselectionchangeが来ることがあるため、1フレーム待つ
      setTimeout(commit, 0);
    }

    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerup', onPointerUp);
      clearTimer();
    };
  }, [conversationId, instanceId]);

  function clearNativeSelection() {
    if (Platform.OS === 'web') window.getSelection()?.removeAllRanges();
  }

  /** 確定シートを閉じ、関連する一時状態を全て捨てる */
  function closeSheet() {
    clearNativeSelection();
    setPendingSelection(null);
    setEditingMarkerId(null);
    setSheetColor(null);
    setQuoteExpanded(false);
    setRealmPicker(null);
    setNewRealmName(null);
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
    setQuoteExpanded(false);
    setRealmPicker(null);
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

  /** 座標検証に失敗した時：ユーザーへ原因を伝え、Sentryにも残す（黙って失敗させない） */
  function reportPositionMismatch(quotedText: string) {
    Sentry.captureMessage('マーカーの選択位置の検証に失敗（ブラウザ拡張機能によるDOM書き換えの疑い）', {
      level: 'warning',
      extra: { quotedTextLength: quotedText.length, conversationId },
    });
    Alert.alert(t.conversation.positionMismatchTitle, t.conversation.positionMismatchBody(quotedText));
  }

  async function recordMarkerHistory(markerId: string, color: string | null, status: string) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    await supabase.from('marker_history').insert({ marker_id: markerId, color, status, user_id: userId });
  }

  async function confirmPendingMarker(color: string) {
    if (!pendingSelection || !conversationId) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

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
      await supabase
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
      const { data: created } = await supabase.from('markers').insert(insertPayload).select('id').single();
      if (created) {
        await recordMarkerHistory(created.id, color, 'confirmed');
        nextRealmPickerId = created.id;
      }
    }

    // 色が決まったらRealm選択ステップへ進む（シートの中身が入れ替わる）。
    // load()の完了を待たずに表示できるよう、引用と色をここで渡しておく
    const quoted = pendingSelection.text || markers.find((m) => m.id === editingMarkerId)?.quoted_text || '';
    clearNativeSelection();
    setPendingSelection(null);
    setEditingMarkerId(null);
    setSheetColor(null);
    setQuoteExpanded(false);
    setNewRealmName(null);
    setRealmPicker(nextRealmPickerId ? { markerId: nextRealmPickerId, quotedText: quoted, color } : null);
    load();
  }

  // マーカーをRealmへ収納する（v2.1：色確定直後 or 既存マーカータップ時）。
  // 割り当てたRealmはローカルの直近使用履歴に記録し、次回以降チップの先頭寄りに出す
  async function assignMarkerToRealm(markerId: string, projectId: string) {
    await supabase.from('markers').update({ project_id: projectId }).eq('id', markerId);
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
    if (!trimmed || !userId) return;
    const { data: created, error } = await supabase
      .from('projects')
      .insert({ name: trimmed, user_id: userId })
      .select('id')
      .single();
    if (error || !created) {
      Alert.alert(t.realms.newRealmFormTitle, error?.message ?? '');
      return;
    }
    await assignMarkerToRealm(markerId, created.id);
  }

  async function rejectMarker(markerId: string) {
    const existing = markers.find((m) => m.id === markerId);
    const alreadyRejected = existing?.status === 'rejected';
    await supabase.from('markers').update({ status: 'rejected' }).eq('id', markerId);
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
  // 3行を超えるかどうかは概算（1行あたりの文字数×3）で判定する。厳密な行数計測より
  // 「長文だけ畳む」という意図が満たせればよい
  const QUOTE_COLLAPSE_THRESHOLD = 90;
  const quoteIsLong = quotedForSheet.length > QUOTE_COLLAPSE_THRESHOLD;

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
              {/* 何にマーカーを引くか（主役）。色を選ぶとここにプレビューが乗る */}
              <Text
                style={[styles.sheetQuote, { color: theme.text }, sheetColorHex && { backgroundColor: sheetColorHex }]}
                numberOfLines={quoteExpanded ? undefined : 3}
                testID="marker-sheet-quote"
              >
                {quotedForSheet}
              </Text>
              {quoteIsLong && (
                <Pressable onPress={() => setQuoteExpanded((v) => !v)} testID="marker-sheet-quote-toggle">
                  <ThemedText type="small" themeColor="textSecondary" style={styles.sheetToggle}>
                    {quoteExpanded ? t.common.collapse : t.common.expand}
                  </ThemedText>
                </Pressable>
              )}

              <View style={styles.sheetSwatchRow}>
                {MARKER_COLORS.map((c) => (
                  <Pressable
                    key={c.key}
                    onPress={() => setSheetColor(c.key)}
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
  const sheetPortal =
    sheet && Platform.OS === 'web' && typeof document !== 'undefined'
      ? createPortal(sheet, document.body)
      : sheet;

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
        {messages.map((m) => {
          const layersForMessage = layersByMessage[m.id] ?? [];
          const segments = computeSegments(m.content, layersForMessage);
          return (
            <ThemedView key={m.id} style={styles.messageRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {m.role === 'user' ? t.conversation.roleUser : t.conversation.roleAssistant}
              </ThemedText>
              {/* data-message-id が「どのメッセージか」の唯一の正解
                  （2026-07-26。詳細はonSelectionChangeのコメント） */}
              <View {...({ dataSet: { messageId: m.id, conversationId } } as object)}>
                <Text selectable style={[styles.messageText, { color: theme.text }]}>
                  {segments.map((seg, i) => {
                    // 開始位置は純粋関数computeSegmentsが確定させた値を読むだけにする
                    // （render中に変数を加算しない。理由：markerLayout.ts TextSegment.start）
                    const segStart = seg.start;
                    // 選択範囲→文字位置の変換（rangeToOffsets）がこの属性を土台に使う
                    const segDiagProps: object = { dataSet: { segStart: String(segStart) } };

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
                          <Text key={i} {...segDiagProps}>
                            {seg.text.slice(0, hitStart)}
                            <Text style={styles.searchMatch} testID="search-match-highlight">
                              {seg.text.slice(hitStart, hitEnd)}
                            </Text>
                            {seg.text.slice(hitEnd)}
                          </Text>
                        );
                      }
                      return (
                        <Text key={i} {...segDiagProps}>
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
                        key={i}
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

      {sheetPortal}
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
  messageRow: { gap: Spacing.half, paddingVertical: Spacing.one },

  // ── マーカー確定シート（2026-07-28）──────────────────────────────
  // 枠線・アイコン・説明文は置かない。引用テキストが最大要素で、色は点、
  // 決定は文字だけ（DESIGN.md 原則3 White Space Is UI / 原則4 Typography First）
  // zIndex:100はdocument.body直下（ポータル先）での値。アプリのルート要素より後ろに
  // 並ぶため実際には順序だけで最前面になるが、将来body直下に別のオーバーレイが
  // 増えた時の比較用に明示しておく（下部タブバーのzIndex:40とは別コンテキスト）
  sheetOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 } as object,
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
  sheetToggle: { paddingVertical: Spacing.one },
  sheetLabel: { marginTop: Spacing.one },
  sheetSwatchRow: { flexDirection: 'row', gap: Spacing.four, paddingVertical: Spacing.two },
  sheetSwatch: { width: 28, height: 28, borderRadius: 14 },
  /** 選択中の色だけリングを付ける。未選択は点のまま（ミニマル） */
  sheetSwatchSelected: { outlineWidth: 2, outlineColor: '#E8ECF5', outlineOffset: 3, outlineStyle: 'solid' } as object,
  /** 行＝文字だけ。枠もアイコンも持たせない */
  sheetRow: { paddingVertical: Spacing.three },
  sheetInput: {
    borderBottomWidth: 1,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
});
