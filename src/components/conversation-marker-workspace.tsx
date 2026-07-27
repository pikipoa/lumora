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

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActivityIndicator, Alert, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { offsetsToRange, rangeToOffsets } from '@/lib/domSelection';
import { computeSegments, locateQuotedText, type MarkerLayer } from '@/lib/markerLayout';
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

/** 選択範囲のビューポート座標。Edit Menu/Selection Toolbar風の浮動色ツールバーの位置決めに使う */
interface ScreenRect {
  top: number;
  left: number;
  width: number;
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

  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [selectionRect, setSelectionRect] = useState<ScreenRect | null>(null);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  // 色確定直後に「Realmを選ぶ」ステップを出す対象マーカー（v2.1認知フロー。スキップ可）
  const [realmPickerMarkerId, setRealmPickerMarkerId] = useState<string | null>(null);
  const { width: windowWidth } = useWindowDimensions();

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
        .select('id, message_id, quoted_text, color, role_tag, project_id, status, start_offset, end_offset')
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
    setPendingSelection(null);
    setSelectionRect(null);
    setEditingMarkerId(null);
    setRealmPickerMarkerId(null);
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
    if (target && !target.project_id) setRealmPickerMarkerId(jumpToMarkerId);
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
  // ドラッグ中はDOMを再構成しない（既存マーカーのレイヤーのみで分割し、選択中の範囲は
  // ブラウザ自身のネイティブ選択表示に任せる）ことで、選択オブジェクトが無効化される
  // レース条件（スパイク検証で発見）を避けている。
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setPendingSelection(null);
        setSelectionRect(null);
        setEditingMarkerId(null);
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

      if (!messageEl || !messageId) {
        setPendingSelection(null);
        setSelectionRect(null);
        setEditingMarkerId(null);
        return;
      }

      // このコンポーネントは同時に複数マウントされる（実機で同一会話3つを確認）。
      // expo-routerのStackが前の画面を保持し、フルページとピークシートも別インスタンス。
      // 全インスタンスがdocumentにselectionchangeリスナーを張り、色ツールバーも
      // document.bodyへポータル描画するため、スコープを絞らないと「ユーザーが選択したのは
      // 別インスタンスの画面なのに、こちらのstate（別の読み込みタイミングのmessages）で
      // 検証・保存される」交差が起こる。
      // 自分が描画した要素の中での選択でなければ、このインスタンスは一切関与しない。
      if (selectedInstanceId !== instanceId) {
        setPendingSelection(null);
        setSelectionRect(null);
        setEditingMarkerId(null);
        return;
      }

      const { start, end, text } = rangeToOffsets(messageEl, domRange);
      setPendingSelection({ messageId, start, end, text });
      const rect = domRange.getBoundingClientRect();
      setSelectionRect({ top: rect.top, left: rect.left, width: rect.width });
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [conversationId, instanceId]);

  function clearNativeSelection() {
    if (Platform.OS === 'web') window.getSelection()?.removeAllRanges();
  }

  /**
   * メッセージのDOM要素を data-message-id で引く（2026-07-26）。
   * 必ず自分のインスタンス配下だけを探す（このコンポーネントは同時に複数マウント
   * されうるため。instanceIdの宣言箇所を参照）。
   */
  function getMessageElement(messageId: string): HTMLElement | null {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
    // 必ず自分のインスタンス配下だけを探す。同じ会話のこのコンポーネントは同時に複数
    // マウントされうるため（実機で3つ確認）、document全体だと他インスタンスの要素を掴む
    const root = document.querySelector(`[data-workspace-instance="${CSS.escape(instanceId)}"]`);
    if (!root) return null;
    return root.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`) as HTMLElement | null;
  }

  // Web: このボタンへのmousedownでブラウザがテキスト選択を解除してしまい、selectionchange→
  // pendingSelectionがnullになった状態でonPressが呼ばれて「範囲が消えて何も起きない」ように
  // 見えるバグがあった。mousedownの既定動作（選択解除）を止めることで、選択を保持したまま
  // クリックできるようにする（PressablePropsの型にonMouseDownが無いためobjectとして渡す）。
  const preventSelectionLoss: object =
    Platform.OS === 'web' ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } : {};

  // 既存マーカーをタップ→そのマーカーの現在の範囲をブラウザのネイティブ選択として復元する。
  function startEditingMarker(messageId: string, layer: MarkerLayer) {
    setEditingMarkerId(layer.id);
    setPendingSelection({ messageId, start: layer.start, end: layer.end, text: '' });
    if (Platform.OS !== 'web') return;
    const view = getMessageElement(messageId);
    if (!view) return;
    const range = offsetsToRange(view, layer.start, layer.end);
    if (!range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    const rect = range.getBoundingClientRect();
    setSelectionRect({ top: rect.top, left: rect.left, width: rect.width });
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
      await supabase
        .from('markers')
        .update({
          quoted_text: quotedText,
          color,
          status: 'confirmed',
          start_offset: pendingSelection.start,
          end_offset: pendingSelection.end,
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
      };
      const { data: created } = await supabase.from('markers').insert(insertPayload).select('id').single();
      if (created) {
        await recordMarkerHistory(created.id, color, 'confirmed');
        nextRealmPickerId = created.id;
      }
    }
    clearNativeSelection();
    setPendingSelection(null);
    setSelectionRect(null);
    setEditingMarkerId(null);
    setRealmPickerMarkerId(nextRealmPickerId);
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
    clearNativeSelection();
    setPendingSelection(null);
    setSelectionRect(null);
    setEditingMarkerId(null);
    setRealmPickerMarkerId(null);
    load();
  }

  async function rejectMarker(markerId: string) {
    const existing = markers.find((m) => m.id === markerId);
    const alreadyRejected = existing?.status === 'rejected';
    await supabase.from('markers').update({ status: 'rejected' }).eq('id', markerId);
    if (!alreadyRejected) await recordMarkerHistory(markerId, null, 'rejected');
    clearNativeSelection();
    setPendingSelection(null);
    setSelectionRect(null);
    setEditingMarkerId(null);
    load();
  }

  const layersByMessage = useMemo(() => {
    const map: Record<string, MarkerLayer[]> = {};
    for (const marker of markers) {
      if (marker.status === 'rejected') continue;
      const message = messages.find((m) => m.id === marker.message_id);
      if (!message) continue;
      // 位置は保存済みのstart_offset/end_offsetを優先する。同一文字列が本文中に複数回
      // 出現するとlocateQuotedTextは常に最初の一致に解決してしまい、既存マーカーとの
      // 重なり判定で新しいマーカーの区間が消える不具合があった（2026-07-26修正）。
      // start_offset/end_offsetがnullの既存マーカー（マイグレーション前に作成）は
      // 従来通りlocateQuotedTextへフォールバックする。
      const located =
        marker.start_offset != null && marker.end_offset != null
          ? { start: marker.start_offset, end: marker.end_offset }
          : locateQuotedText(message.content, marker.quoted_text);
      if (!located) continue;
      const layer: MarkerLayer = {
        id: marker.id,
        start: located.start,
        end: located.end,
        kind: marker.status === 'confirmed' ? 'confirmed' : 'proposed',
        color: marker.color,
      };
      (map[marker.message_id] ??= []).push(layer);
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

  const realmPickerMarker = markers.find((m) => m.id === realmPickerMarkerId) ?? null;

  const colorToolbarContent =
    pendingSelection && selectionRect ? (
      <View
        style={[
          styles.floatingToolbar,
          {
            top: Math.max(Spacing.two, selectionRect.top - 44),
            left: Math.min(
              Math.max(Spacing.two, selectionRect.left + selectionRect.width / 2 - 115),
              windowWidth - 230 - Spacing.two,
            ),
          },
        ]}
        testID="marker-color-toolbar"
      >
        <ThemedView type="backgroundElement" style={styles.toolbarInner}>
          {MARKER_COLORS.map((c) => (
            <Pressable
              key={c.key}
              style={[styles.swatchSmall, { backgroundColor: c.hex }]}
              {...preventSelectionLoss}
              onPress={() => confirmPendingMarker(c.key)}
              testID={`marker-color-${c.key}`}
            />
          ))}
          {editingMarker && (
            <Pressable
              style={styles.toolbarReject}
              {...preventSelectionLoss}
              onPress={() => rejectMarker(editingMarker.id)}
              testID="reject-marker-button"
            >
              <ThemedText type="small">✕</ThemedText>
            </Pressable>
          )}
        </ThemedView>
      </View>
    ) : null;

  const colorToolbar =
    colorToolbarContent && Platform.OS === 'web' && typeof document !== 'undefined'
      ? createPortal(colorToolbarContent, document.body)
      : colorToolbarContent;

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

      {/* Edit Menu/Selection Toolbar風：選択範囲のすぐ近くに浮かぶ、色だけの最小ツールバー。
          説明文やキャンセルボタンは持たない（選択を解いて他をタップすれば自然にキャンセルになる）。
          検索結果のボトムシート（conversation-peek-sheet.tsx）はスライドインアニメーションのため
          祖先要素に恒常的なtransformが残る。position:'fixed'はtransformを持つ祖先があると
          ビューポートではなくその祖先基準になってしまうCSSの仕様があり、ツールバーが選択位置と
          無関係な場所にずれる不具合の原因になっていた。document.bodyへポータルで直接描画することで
          祖先のtransformの影響を受けないようにする */}
      {colorToolbar}

      {/* 既存マーカーがRealm未割当なら、色を選び直さなくてもこの場で収納できる（整理待ちからのジャンプ先） */}
      {pendingSelection && editingMarker && !editingMarker.project_id && projects.length > 0 && (
        <ThemedView type="backgroundElement" style={styles.actionBar}>
          <ThemedText type="small" themeColor="textSecondary">
            {t.conversation.assignPrompt}
          </ThemedText>
          <ThemedView style={styles.tagWrap}>
            {sortedProjects.map((p) => (
              <Pressable
                key={p.id}
                style={[styles.chip, { borderColor: theme.backgroundSelected }]}
                {...preventSelectionLoss}
                onPress={() => assignMarkerToRealm(editingMarker.id, p.id)}
                testID={`assign-realm-${p.id}`}
              >
                <ThemedText type="small">{p.name}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        </ThemedView>
      )}

      {/* v2.1認知フロー：色確定の直後に「Realmを選ぶ」ステップ（スキップ可）。
          チップの並び順は「あとで」を先頭、続けて直近使用したRealm順 */}
      {!pendingSelection && realmPickerMarker && (
        <ThemedView type="backgroundElement" style={styles.actionBar} testID="realm-picker-bar">
          <ThemedText type="small">
            {t.conversation.realmPickerPrompt((realmPickerMarker.quoted_text ?? '').slice(0, 30))}
          </ThemedText>
          <ThemedView style={styles.tagWrap}>
            <Pressable
              style={[styles.smallButtonOutline, { borderColor: theme.backgroundSelected }]}
              onPress={() => setRealmPickerMarkerId(null)}
              testID="realm-picker-later"
            >
              <ThemedText type="small">{t.common.later}</ThemedText>
            </Pressable>
            {sortedProjects.map((p) => (
              <Pressable
                key={p.id}
                style={[styles.chip, { borderColor: theme.backgroundSelected }]}
                onPress={() => assignMarkerToRealm(realmPickerMarker.id, p.id)}
                testID={`realm-picker-${p.id}`}
              >
                <ThemedText type="small">{p.name}</ThemedText>
              </Pressable>
            ))}
            {projects.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {t.conversation.noRealmsHint}
              </ThemedText>
            )}
          </ThemedView>
        </ThemedView>
      )}
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
  actionBar: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#208AEF',
  },
  floatingToolbar: { position: 'fixed', zIndex: 50 } as object,
  toolbarInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: 20,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  swatchSmall: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: '#00000022' },
  toolbarReject: { paddingHorizontal: Spacing.one },
  messageRow: { gap: Spacing.half, paddingVertical: Spacing.one },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  smallButtonOutline: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    alignSelf: 'flex-start',
  },
});
