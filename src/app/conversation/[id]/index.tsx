/**
 * S6 会話詳細（Chronicle本体）。横断検索（S8）から辿り着き、本文を選択してマーカーを作る主戦場。
 *
 * 【v2.1 認知OSへの改訂（2026-07-12）】人間の認知順序（マーカー→Realm選択→AI分析）に
 * UIを合わせた。色タップでマーカー確定した直後、アクションバーが「Realmを選ぶ」ステップに
 * 変わる（スキップ可）。未割当マーカーは既存ハイライトをタップすればいつでも割当できる。
 * 会話全体タグエリア（ConversationTag）はUIから削除した（Tagは常時表示しない原則。
 * テーブル自体は残る）。詳細：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-12 v2.1 認知OSへの改訂」、5オブジェクト定義はdocs/data-model.md「0. 設計思想」。
 *
 * マーカーの範囲選択はStep6技術スパイクの結論（ブラウザ標準Selection/Range API）に基づく。
 * Web版はTextを`selectable`にしてブラウザのSelection APIを直接使う。ネイティブ版は
 * 同じロジックをWebView内JSとして動かす設計（Step7-a検証・data-model.md参照）で、
 * 本画面のロジック自体はプラットフォーム非依存の`markerLayout.ts`に共通化している。
 *
 * ハイライトはconfirmedマーカーを「区間マージ」で複数レイヤーとして重ね描画する
 * 設計にしており、将来Beacon等の追加レイヤーが増えても同じ仕組みで表示できる。
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n';
import { offsetsToRange, rangeToOffsets } from '@/lib/domSelection';
import { computeSegments, locateQuotedText, type MarkerLayer } from '@/lib/markerLayout';
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

interface MemoRow {
  id: string;
  body: string;
}

export default function ConversationDetailScreen() {
  const { id, markerId: jumpToMarkerId } = useLocalSearchParams<{ id: string; markerId?: string }>();
  const router = useRouter();
  const [jumpedMarkerId, setJumpedMarkerId] = useState<string | null>(null);

  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [memo, setMemo] = useState<MemoRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [memoDraft, setMemoDraft] = useState('');
  const [memoSaved, setMemoSaved] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  // 色確定直後に「Realmを選ぶ」ステップを出す対象マーカー（v2.1認知フロー。スキップ可）
  const [realmPickerMarkerId, setRealmPickerMarkerId] = useState<string | null>(null);
  const messageRefs = useRef<Record<string, View | null>>({});

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: conv }, { data: msgs }, { data: mks }, { data: proj }, { data: memos }] =
      await Promise.all([
        supabase
          .from('conversations')
          .select('id, title, source, created_at, imported_at, project_id, projects(name)')
          .eq('id', id)
          .single(),
        supabase.from('messages').select('id, role, content, seq').eq('conversation_id', id).order('seq'),
        supabase
          .from('markers')
          .select('id, message_id, quoted_text, color, role_tag, project_id, status')
          .eq('conversation_id', id),
        supabase.from('projects').select('id, name').order('created_at', { ascending: false }),
        supabase.from('memos').select('id, body').eq('target_type', 'conversation').eq('target_id', id).maybeSingle(),
      ]);

    setConversation((conv as unknown as ConversationDetail) ?? null);
    setMessages(msgs ?? []);
    setMarkers(mks ?? []);
    setProjects(proj ?? []);
    setMemo(memos ?? null);
    setMemoDraft(memos?.body ?? '');
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // S9「重要部分だけ表示」からの遷移：該当マーカーへスクロールし、一時的にハイライトする
  useEffect(() => {
    if (!jumpToMarkerId || loading || Platform.OS !== 'web') return;
    const el = document.querySelector(`[data-testid="marker-segment-${jumpToMarkerId}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setJumpedMarkerId(jumpToMarkerId);
    const timer = setTimeout(() => setJumpedMarkerId(null), 2500);
    return () => clearTimeout(timer);
  }, [jumpToMarkerId, loading]);

  // Step6スパイクの結論：ブラウザ標準Selection APIで範囲を読み取る。
  // ドラッグ中はDOMを再構成しない（既存マーカーのレイヤーのみで分割し、選択中の範囲は
  // ブラウザ自身のネイティブ選択表示に任せる）ことで、選択オブジェクトが無効化される
  // レース条件（スパイク検証で発見）を避けている。
  // editingMarkerIdは「タップで編集開始したマーカー」を保持し、selectionchangeが来ても
  // クリアしない（同じマーカーの範囲をドラッグで微調整している間、編集対象を保ち続けるため）。
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setPendingSelection(null);
        setEditingMarkerId(null);
        return;
      }
      const domRange = sel.getRangeAt(0);
      for (const [messageId, view] of Object.entries(messageRefs.current)) {
        const el = view as unknown as HTMLElement | null;
        if (!el || !el.contains(domRange.commonAncestorContainer)) continue;
        const { start, end, text } = rangeToOffsets(el, domRange);
        setPendingSelection({ messageId, start, end, text });
        return;
      }
      setPendingSelection(null);
      setEditingMarkerId(null);
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, []);

  function clearNativeSelection() {
    if (Platform.OS === 'web') window.getSelection()?.removeAllRanges();
  }

  // Web: このボタンへのmousedownでブラウザがテキスト選択を解除してしまい、selectionchange→
  // pendingSelectionがnullになった状態でonPressが呼ばれて「範囲が消えて何も起きない」ように
  // 見えるバグがあった。mousedownの既定動作（選択解除）を止めることで、選択を保持したまま
  // クリックできるようにする（PressablePropsの型にonMouseDownが無いためobjectとして渡す）。
  const preventSelectionLoss: object =
    Platform.OS === 'web' ? { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } : {};

  // 既存マーカーをタップ→そのマーカーの現在の範囲をブラウザのネイティブ選択として復元する。
  // これにより表示されるドラッグハンドルで、そのまま範囲を左右に微調整できる（「引いた後の範囲変更」）。
  function startEditingMarker(messageId: string, layer: MarkerLayer) {
    setEditingMarkerId(layer.id);
    setPendingSelection({ messageId, start: layer.start, end: layer.end, text: '' });
    if (Platform.OS !== 'web') return;
    const view = messageRefs.current[messageId] as unknown as HTMLElement | null;
    if (!view) return;
    const range = offsetsToRange(view, layer.start, layer.end);
    if (!range) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  async function recordMarkerHistory(markerId: string, color: string | null, status: string) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    await supabase.from('marker_history').insert({ marker_id: markerId, color, status, user_id: userId });
  }

  async function confirmPendingMarker(color: string) {
    if (!pendingSelection || !id) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    // v2.1認知フロー：確定した直後、そのマーカーがRealm未割当なら「Realmを選ぶ」ステップへ進む
    let nextRealmPickerId: string | null = null;

    if (editingMarkerId) {
      const existing = markers.find((m) => m.id === editingMarkerId);
      const quotedText = pendingSelection.text || existing?.quoted_text;
      if (!quotedText) return;
      // 範囲・色・状態のいずれも変化していない場合は履歴を残さない（無駄な追記を避ける）
      const unchanged =
        existing && existing.quoted_text === quotedText && existing.color === color && existing.status === 'confirmed';
      await supabase
        .from('markers')
        .update({ quoted_text: quotedText, color, status: 'confirmed' })
        .eq('id', editingMarkerId);
      if (!unchanged) await recordMarkerHistory(editingMarkerId, color, 'confirmed');
      if (existing && !existing.project_id) nextRealmPickerId = editingMarkerId;
    } else {
      const { data: created } = await supabase
        .from('markers')
        .insert({
          conversation_id: id,
          message_id: pendingSelection.messageId,
          quoted_text: pendingSelection.text,
          color,
          status: 'confirmed',
          proposed_by: 'human',
          user_id: userId,
        })
        .select('id')
        .single();
      if (created) {
        await recordMarkerHistory(created.id, color, 'confirmed');
        nextRealmPickerId = created.id;
      }
    }
    clearNativeSelection();
    setPendingSelection(null);
    setEditingMarkerId(null);
    setRealmPickerMarkerId(nextRealmPickerId);
    load();
  }

  // マーカーをRealmへ収納する（v2.1：色確定直後 or 既存マーカータップ時）
  async function assignMarkerToRealm(markerId: string, projectId: string) {
    await supabase.from('markers').update({ project_id: projectId }).eq('id', markerId);
    clearNativeSelection();
    setPendingSelection(null);
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
    setEditingMarkerId(null);
    load();
  }

  function cancelPendingMarker() {
    clearNativeSelection();
    setPendingSelection(null);
    setEditingMarkerId(null);
  }

  async function saveMemo() {
    if (!id) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    if (memo) {
      await supabase.from('memos').update({ body: memoDraft, updated_at: new Date().toISOString() }).eq('id', memo.id);
    } else if (memoDraft.trim()) {
      await supabase
        .from('memos')
        .insert({ target_type: 'conversation', target_id: id, body: memoDraft, user_id: userId });
    } else {
      return; // 空のまま保存しても何もすることが無いので、フィードバックも出さない
    }
    await load();
    setMemoSaved(true);
    setTimeout(() => setMemoSaved(false), 2000);
  }

  const layersByMessage = useMemo(() => {
    const map: Record<string, MarkerLayer[]> = {};
    for (const marker of markers) {
      if (marker.status === 'rejected') continue;
      const message = messages.find((m) => m.id === marker.message_id);
      if (!message) continue;
      const located = locateQuotedText(message.content, marker.quoted_text);
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
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      </ThemedView>
    );
  }

  if (!conversation) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText style={styles.note}>{t.conversation.notFound}</ThemedText>
      </ThemedView>
    );
  }

  const realmPickerMarker = markers.find((m) => m.id === realmPickerMarkerId) ?? null;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <Pressable onPress={() => router.back()} testID="back-button">
          <ThemedText type="link">{t.common.back}</ThemedText>
        </Pressable>

        {/* 会話タイトル（＝最初のユーザー発言のことが多い）を大見出しにしない（2026-07-12）。
            日付・AI元・Realmと同列の小さなメタ情報として1行に収める */}
        <ThemedText type="small" themeColor="textSecondary">
          {new Date(conversation.created_at ?? conversation.imported_at).toLocaleDateString('ja-JP')} ・{' '}
          {t.sources[conversation.source] ?? conversation.source} ・{' '}
          {conversation.projects?.name ?? t.conversation.unassigned}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {conversation.title}
        </ThemedText>

        {/* 本文（マーカーハイライト＋範囲選択） */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">{t.conversation.bodyTitle}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {t.conversation.bodyHint}
          </ThemedText>
          {messages.map((m) => {
            const segments = computeSegments(m.content, layersByMessage[m.id] ?? []);
            return (
              <ThemedView key={m.id} style={styles.messageRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {m.role === 'user' ? t.conversation.roleUser : t.conversation.roleAssistant}
                </ThemedText>
                <View
                  ref={(el) => {
                    messageRefs.current[m.id] = el;
                  }}
                >
                  <Text selectable style={styles.messageText}>
                    {segments.map((seg, i) => {
                      if (!seg.layer) return seg.text;
                      const isProposed = seg.layer.kind === 'proposed';
                      const bg = seg.layer.color
                        ? MARKER_COLORS.find((c) => c.key === seg.layer!.color)?.hex
                        : '#FFD23D88';
                      return (
                        <Text
                          key={i}
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

        {pendingSelection && (
          <ThemedView type="backgroundElement" style={styles.actionBar}>
            <ThemedText type="small">
              {editingMarker
                ? (editingMarker.status === 'proposed' ? t.conversation.editingProposed : t.conversation.editingMarker)(
                    (pendingSelection.text || editingMarker.quoted_text).slice(0, 40),
                  )
                : t.conversation.newMarker(pendingSelection.text.slice(0, 40))}
            </ThemedText>
            {editingMarker && (
              <ThemedText type="small" themeColor="textSecondary">
                {t.conversation.adjustHint}
              </ThemedText>
            )}
            <ThemedView style={styles.row}>
              {MARKER_COLORS.map((c) => (
                <Pressable
                  key={c.key}
                  style={[styles.swatch, { backgroundColor: c.hex }]}
                  {...preventSelectionLoss}
                  onPress={() => confirmPendingMarker(c.key)}
                  testID={`marker-color-${c.key}`}
                />
              ))}
              {editingMarker && (
                <Pressable
                  style={styles.smallButtonOutline}
                  {...preventSelectionLoss}
                  onPress={() => rejectMarker(editingMarker.id)}
                  testID="reject-marker-button"
                >
                  <ThemedText type="small">{t.conversation.reject}</ThemedText>
                </Pressable>
              )}
              <Pressable
                style={styles.smallButtonOutline}
                {...preventSelectionLoss}
                onPress={cancelPendingMarker}
                testID="cancel-new-marker"
              >
                <ThemedText type="small">{t.common.cancel}</ThemedText>
              </Pressable>
            </ThemedView>

            {/* 既存マーカーがRealm未割当なら、色を選び直さなくてもこの場で収納できる（整理待ちからのジャンプ先） */}
            {editingMarker && !editingMarker.project_id && projects.length > 0 && (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.conversation.assignPrompt}
                </ThemedText>
                <ThemedView style={styles.tagWrap}>
                  {projects.map((p) => (
                    <Pressable
                      key={p.id}
                      style={styles.chip}
                      {...preventSelectionLoss}
                      onPress={() => assignMarkerToRealm(editingMarker.id, p.id)}
                      testID={`assign-realm-${p.id}`}
                    >
                      <ThemedText type="small">{p.name}</ThemedText>
                    </Pressable>
                  ))}
                </ThemedView>
              </>
            )}
          </ThemedView>
        )}

        {/* v2.1認知フロー：色確定の直後に「Realmを選ぶ」ステップ（スキップ可） */}
        {!pendingSelection && realmPickerMarker && (
          <ThemedView type="backgroundElement" style={styles.actionBar} testID="realm-picker-bar">
            <ThemedText type="small">
              {t.conversation.realmPickerPrompt((realmPickerMarker.quoted_text ?? '').slice(0, 30))}
            </ThemedText>
            <ThemedView style={styles.tagWrap}>
              {projects.map((p) => (
                <Pressable
                  key={p.id}
                  style={styles.chip}
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
              <Pressable
                style={styles.smallButtonOutline}
                onPress={() => setRealmPickerMarkerId(null)}
                testID="realm-picker-later"
              >
                <ThemedText type="small">{t.common.later}</ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>
        )}

        {/* メモ */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">{t.conversation.memoTitle}</ThemedText>
          <TextInput
            style={styles.textArea}
            value={memoDraft}
            onChangeText={(text) => {
              setMemoDraft(text);
              setMemoSaved(false);
            }}
            multiline
            placeholder={t.conversation.memoPlaceholder}
            testID="memo-input"
          />
          <ThemedView style={styles.row}>
            <Pressable style={styles.smallButton} onPress={saveMemo} testID="memo-save-button">
              <ThemedText style={styles.smallButtonText}>{t.common.save}</ThemedText>
            </Pressable>
            {memoSaved && (
              <ThemedText type="small" testID="memo-saved-indicator">
                {t.conversation.memoSaved}
              </ThemedText>
            )}
          </ThemedView>
        </ThemedView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  note: { opacity: 0.7, padding: Spacing.four },
  section: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  messageText: { fontSize: 16, lineHeight: 24 },
  markerProposed: { borderBottomWidth: 2, borderBottomColor: '#999', borderStyle: 'dashed' },
  markerSelected: { outlineWidth: 2, outlineColor: '#208AEF', outlineStyle: 'solid' } as object,
  actionBar: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
    borderWidth: 1,
    borderColor: '#208AEF',
  },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: '#00000022' },
  messageRow: { gap: Spacing.half, paddingVertical: Spacing.one },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  textArea: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    padding: Spacing.two,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  smallButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    alignSelf: 'flex-start',
  },
  smallButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  smallButtonOutline: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    alignSelf: 'flex-start',
  },
});
