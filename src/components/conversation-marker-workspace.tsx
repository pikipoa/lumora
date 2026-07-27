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
  // React Compilerのメモ化を、このコンポーネントに限って無効化する（2026-07-26）。
  // この画面はSelection APIでDOMの実体から座標を読む都合上、描画結果とstateが完全に
  // 一致していることが正しさの前提になる。メモ化による部分再評価と両立しない。
  'use no memo';

  // このコンポーネントのインスタンスを一意に識別するID（2026-07-26）。
  //
  // 実機の診断で、同一会話のこのコンポーネントが同時に3つマウントされていることが
  // 判明した（messagesInState=86 に対し totalMessageElementsInDom=258＝86×3、
  // elementsWithThisMessageId=3）。expo-routerのStackは前の画面をマウントしたまま
  // 保持するため、検索→ピークシート→フルページと行き来すると同じ会話の画面が積み重なる。
  //
  // 各インスタンスは独立したstate（messages等）を持つ一方、document全体への
  // querySelectorは「DOM順で最初の要素」を返すため、ユーザーが実際に選択した画面では
  // なく背後の別インスタンスの要素を掴みうる（usedElementIsFirstMatch=true）。
  // これがDOM側975文字／state側content 1835文字という食い違いの原因。
  //
  // 以降、DOMアクセスは必ずこのIDでスコープし、自分が描画した要素だけを見る。
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

      // どのメッセージ内の選択かは、JS側のマップ（messageRefs）ではなくDOM自身が持つ
      // data-message-id から決める（2026-07-26）。
      //
      // 以前はmessageRefsを走査して「選択を含む最初のel」を採用していたが、実機ログで
      // messageRefsのあるIDが別のメッセージのDOM要素を指している状態が確認された
      // （DOM側975文字／該当contentは1835文字で、単語自体が別物だった）。ref登録は
      // React Compilerのメモ化と絡んで想定通りに更新されないことがあり、JS側のマップを
      // 唯一の正解にするのは危険。実際に描画されているDOMに書かれたIDが最も確かな情報。
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
   * JS側のマップ（messageRefs）はReact Compilerのメモ化と絡んで別メッセージの要素を
   * 指すことが実機で確認されたため、DOMに書かれたIDを唯一の正解として扱う。
   * messageRefsは他機能（スクロール等）との互換のため残しているが、
   * 「どのメッセージか」の判定には使わない。
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
   * 座標検証ガードが失敗した時だけ実行する診断（2026-07-26）。
   * DOMに描画されているテキストとDBのcontentを直接突き合わせ、
   * 「DOM側が想定と違う」のか「セグメントの開始位置が違う」のかを切り分ける。
   * 失敗時のみ実行するためログは汚れない。
   */
  function diagnoseOffsetMismatch(messageId: string, content: string, start: number, end: number, quotedText: string) {
    if (Platform.OS !== 'web') return;
    const el = getMessageElement(messageId);
    if (!el) {
      // eslint-disable-next-line no-console
      console.error('[marker-debug][診断] メッセージのDOM要素が見つかりません', { messageId });
      return;
    }

    // 同じmessageIdを持つ要素が複数存在しないか（＝このコンポーネントが同時に
    // 複数マウントされていないか）を確認する。フルページとピークシートの二重マウントが
    // 疑われるため（2026-07-26）
    const root = document.querySelector(`[data-workspace-instance="${CSS.escape(instanceId)}"]`);
    const allWithThisId = Array.from(
      (root ?? document).querySelectorAll(`[data-message-id="${CSS.escape(messageId)}"]`),
    ) as HTMLElement[];
    const allMessageEls = Array.from(document.querySelectorAll('[data-message-id]')) as HTMLElement[];
    const instanceCount = document.querySelectorAll('[data-workspace-instance]').length;
    const conversationIdsInDom = Array.from(
      new Set(allMessageEls.map((n) => n.getAttribute('data-conversation-id') ?? '(なし)')),
    );
    // eslint-disable-next-line no-console
    console.error(
      '[marker-debug][診断] インスタンス/DOM重複の確認: ' +
        JSON.stringify(
          {
            thisInstanceConversationId: conversationId,
            thisInstanceId: instanceId,
            workspaceInstancesInDom: instanceCount,
            messagesInState: messages.length,
            stateHasThisMessageId: messages.some((msg) => msg.id === messageId),
            // 自分のインスタンス配下に限った件数（1でなければスコープ処理の不備）
            elementsWithThisMessageId: allWithThisId.length,
            eachElementTextLength: allWithThisId.map((n) => (n.textContent ?? '').length),
            eachElementConversationId: allWithThisId.map((n) => n.getAttribute('data-conversation-id')),
            totalMessageElementsInDom: allMessageEls.length,
            distinctConversationIdsInDom: conversationIdsInDom,
            usedElementIsFirstMatch: allWithThisId[0] === el,
          },
          null,
          2,
        ),
    );

    const domText = el.textContent ?? '';
    let firstDiff = -1;
    const minLen = Math.min(domText.length, content.length);
    for (let i = 0; i < minLen; i++) {
      if (domText[i] !== content[i]) {
        firstDiff = i;
        break;
      }
    }
    if (firstDiff === -1 && domText.length !== content.length) firstDiff = minLen;

    // eslint-disable-next-line no-console
    console.error(
      '[marker-debug][診断] DOMテキスト vs DB content: ' +
        JSON.stringify(
          {
            domTextLength: domText.length,
            contentLength: content.length,
            lengthDiff: domText.length - content.length,
            firstDifferenceIndex: firstDiff,
            domAroundFirstDiff: firstDiff >= 0 ? JSON.stringify(domText.slice(Math.max(0, firstDiff - 30), firstDiff + 30)) : null,
            contentAroundFirstDiff:
              firstDiff >= 0 ? JSON.stringify(content.slice(Math.max(0, firstDiff - 30), firstDiff + 30)) : null,
            // 算出offsetの位置に、DOM側なら何があるか（content側は既にsliceAtOffsetで判明している）
            // レンダー時に使われたm.contentの長さ（DOMに刻んだ値）。stateのcontent.lengthと
            // 一致しなければ「レンダーとstateが別データを見ている」、一致するのに
            // domTextLengthが違うなら「描画時にテキストが落ちている」と切り分けられる
            contentLengthUsedAtRender: el.getAttribute('data-content-length'),
            domTextAtComputedOffsets: JSON.stringify(domText.slice(start, end)),
            // 選択文字列がDOM/contentそれぞれのどこに出現するか（何番目のズレかを見る）
            quotedTextIndexesInContent: (() => {
              const idxs: number[] = [];
              let from = 0;
              for (;;) {
                const i = content.indexOf(quotedText, from);
                if (i === -1 || idxs.length >= 20) break;
                idxs.push(i);
                from = i + 1;
              }
              return idxs;
            })(),
          },
          null,
          2,
        ),
    );

    // 【決定的な比較】いまのstateから計算し直したセグメントと、DOMに実在するセグメントを
    // 直接突き合わせる。computeSegmentsは必ずcontent全体をカバーするので、DOM側の合計が
    // 足りない／startが非単調なら、DOMは単一のcomputeSegments結果ではないことになる。
    const expectedSegments = computeSegments(content, layersByMessage[messageId] ?? []);
    const domSegEls = Array.from(el.querySelectorAll('[data-seg-start]')) as HTMLElement[];
    // eslint-disable-next-line no-console
    console.error(
      '[marker-debug][診断] 期待セグメント vs DOMセグメント: ' +
        JSON.stringify(
          {
            expectedCount: expectedSegments.length,
            domCount: domSegEls.length,
            expectedTotalLength: expectedSegments.reduce((a, s) => a + s.text.length, 0),
            domTotalLength: domSegEls.reduce((a, n) => a + (n.textContent ?? '').length, 0),
            expectedStarts: expectedSegments.map((s) => s.start),
            domStarts: domSegEls.map((n) => Number(n.getAttribute('data-seg-start'))),
            expectedLengths: expectedSegments.map((s) => s.text.length),
            domLengths: domSegEls.map((n) => (n.textContent ?? '').length),
            layersForThisMessage: (layersByMessage[messageId] ?? []).length,
          },
          null,
          2,
        ),
    );

    // 各セグメント要素のdata-seg-startが、実際にcontentのその位置のテキストと一致するか
    const segEls = domSegEls;
    // eslint-disable-next-line no-console
    console.error(`[marker-debug][診断] セグメント要素数: ${segEls.length}`);
    const badSegs: unknown[] = [];
    let domCursor = 0;
    segEls.forEach((segEl, idx) => {
      const attr = segEl.getAttribute('data-seg-start');
      const segStart = Number(attr ?? 'NaN');
      const segText = segEl.textContent ?? '';
      const contentSlice = content.slice(segStart, segStart + segText.length);
      const matches = segText === contentSlice;
      if (!matches || segStart !== domCursor) {
        badSegs.push({
          idx,
          dataSegStartAttr: attr,
          segStart,
          domCursorExpected: domCursor,
          segTextHead: segText.slice(0, 30),
          contentSliceHead: contentSlice.slice(0, 30),
          textMatchesContentAtSegStart: matches,
        });
      }
      domCursor += segText.length;
    });
    // eslint-disable-next-line no-console
    console.error(
      '[marker-debug][診断] 不整合セグメント（最大10件）: ' + JSON.stringify(badSegs.slice(0, 10), null, 2),
    );
    // eslint-disable-next-line no-console
    console.error(
      '[marker-debug][診断] セグメント合計長 vs DOM/content: ' +
        JSON.stringify({ segTotalLength: domCursor, domTextLength: domText.length, contentLength: content.length }),
    );
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

      // 保存直前の座標検証（2026-07-26、position drift対策）：rangeToOffsetsが計算した
      // start_offset/end_offsetが実際のquoted_textと一致しない場合、ズレた位置のまま保存
      // すると表示側で全く別の場所にマーカーが付く不具合になる。一致しなければ保存自体を
      // 中止する（黙って誤った位置を保存しない）。
      const sourceMessage = messages.find((msg) => msg.id === pendingSelection.messageId);
      const sliceAtOffset = sourceMessage?.content.slice(pendingSelection.start, pendingSelection.end) ?? null;
      if (sliceAtOffset !== quotedText) {
        // eslint-disable-next-line no-console
        console.error('[marker-debug] 座標検証NG（更新）：保存を中止しました', {
          quotedText,
          start: pendingSelection.start,
          end: pendingSelection.end,
          sliceAtOffset,
        });
        if (sourceMessage) {
          diagnoseOffsetMismatch(
            pendingSelection.messageId,
            sourceMessage.content,
            pendingSelection.start,
            pendingSelection.end,
            quotedText,
          );
        }
        Alert.alert(
          '保存を中止しました',
          `マーカーの位置がズレて計算されたため保存しませんでした。\n選択テキスト: "${quotedText}"\n位置から取得した文字: "${sliceAtOffset}"`,
        );
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

      // 保存直前の座標検証（2026-07-26、position drift対策）。上の更新分岐と同じ理由。
      const sourceMessage = messages.find((msg) => msg.id === pendingSelection.messageId);
      const sliceAtOffset = sourceMessage?.content.slice(pendingSelection.start, pendingSelection.end) ?? null;
      if (sliceAtOffset !== quotedText) {
        // eslint-disable-next-line no-console
        console.error('[marker-debug] 座標検証NG（新規作成）：保存を中止しました', {
          quotedText,
          start: pendingSelection.start,
          end: pendingSelection.end,
          sliceAtOffset,
        });
        if (sourceMessage) {
          diagnoseOffsetMismatch(
            pendingSelection.messageId,
            sourceMessage.content,
            pendingSelection.start,
            pendingSelection.end,
            quotedText,
          );
        }
        Alert.alert(
          '保存を中止しました',
          `マーカーの位置がズレて計算されたため保存しませんでした。\n選択テキスト: "${quotedText}"\n位置から取得した文字: "${sliceAtOffset}"`,
        );
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
              {/* data-message-id が「どのメッセージか」の唯一の正解。JS側のrefマップは
                  React Compilerのメモ化と絡んで別メッセージを指すことがあったため廃止した
                  （2026-07-26。詳細はonSelectionChangeのコメント） */}
              {/* data-content-length は「このDOMを描画した時に使ったm.contentの長さ」。
                  stateのcontent.lengthと突き合わせることで、レンダーとstateがそもそも
                  別のデータを見ているのか、それとも描画時にテキストが落ちているのかを
                  切り分けられる（2026-07-26の調査用） */}
              <View
                {...({
                  dataSet: { messageId: m.id, conversationId, contentLength: String(m.content.length) },
                } as object)}
              >
                <Text selectable style={[styles.messageText, { color: theme.text }]}>
                  {segments.map((seg, i) => {
                    // 開始位置は純粋関数computeSegmentsが確定させた値を読むだけにする。
                    // 以前はここで `let cursor` を加算しながら求めていたが、React Compiler
                    // 有効下ではrender中の変数書き換えが壊れ、DOMのdata-seg-startが
                    // 単調増加しなくなっていた（詳細：markerLayout.ts TextSegment.start）。
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
