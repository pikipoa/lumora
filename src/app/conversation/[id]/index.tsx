/**
 * S6 会話詳細（レビュー画面）。要約/タグ/マーカーのAI提案(Ore)を確認・確定する主戦場。
 *
 * マーカーの範囲選択はStep6技術スパイクの結論（ブラウザ標準Selection/Range API）に基づく。
 * Web版はTextを`selectable`にしてブラウザのSelection APIを直接使う。ネイティブ版は
 * 同じロジックをWebView内JSとして動かす設計（Step7-a検証・data-model.md参照）で、
 * 本画面のロジック自体はプラットフォーム非依存の`markerLayout.ts`に共通化している。
 *
 * ハイライトはproposed/confirmedマーカーを「区間マージ」で複数レイヤーとして重ね描画する
 * 設計にしており、将来Beacon等の追加レイヤーが増えても同じ仕組みで表示できる。
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
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

const SOURCE_LABEL: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
};

const TAG_TYPE_LABEL: Record<string, string> = { topic: 'Topic', concept: 'Concept' };

interface ConversationDetail {
  id: string;
  title: string;
  source: string;
  project_id: string | null;
  theme_id: string | null;
  projects: { name: string } | null;
  themes: { name: string } | null;
}

interface MessageRow {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  seq: number;
}

interface SummaryRow {
  id: string;
  body: string;
  status: 'proposed' | 'confirmed' | 'edited' | 'rejected';
}

interface ConversationTagRow {
  id: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  proposed_by: 'ai' | 'human';
  tags: { id: string; name: string; tag_type: 'topic' | 'concept' };
}

interface MarkerRow {
  id: string;
  message_id: string;
  quoted_text: string;
  color: string | null;
  role_tag: string | null;
  status: 'proposed' | 'confirmed' | 'rejected';
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
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [conversationTags, setConversationTags] = useState<ConversationTagRow[]>([]);
  const [markers, setMarkers] = useState<MarkerRow[]>([]);
  const [memo, setMemo] = useState<MemoRow | null>(null);
  const [loading, setLoading] = useState(true);

  const [summaryDraft, setSummaryDraft] = useState('');
  const [editingSummary, setEditingSummary] = useState(false);
  const [showRejectedTags, setShowRejectedTags] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagType, setNewTagType] = useState<'topic' | 'concept'>('topic');
  const [memoDraft, setMemoDraft] = useState('');
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const messageRefs = useRef<Record<string, View | null>>({});

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: conv }, { data: msgs }, { data: sum }, { data: cts }, { data: mks }, { data: memos }] =
      await Promise.all([
        supabase
          .from('conversations')
          .select('id, title, source, project_id, theme_id, projects(name), themes(name)')
          .eq('id', id)
          .single(),
        supabase.from('messages').select('id, role, content, seq').eq('conversation_id', id).order('seq'),
        supabase.from('summaries').select('id, body, status').eq('conversation_id', id).maybeSingle(),
        supabase
          .from('conversation_tags')
          .select('id, status, proposed_by, tags(id, name, tag_type)')
          .eq('conversation_id', id),
        supabase
          .from('markers')
          .select('id, message_id, quoted_text, color, role_tag, status')
          .eq('conversation_id', id),
        supabase.from('memos').select('id, body').eq('target_type', 'conversation').eq('target_id', id).maybeSingle(),
      ]);

    setConversation((conv as unknown as ConversationDetail) ?? null);
    setMessages(msgs ?? []);
    setSummary(sum ?? null);
    setSummaryDraft(sum?.body ?? '');
    setConversationTags((cts as unknown as ConversationTagRow[]) ?? []);
    setMarkers(mks ?? []);
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
      if (created) await recordMarkerHistory(created.id, color, 'confirmed');
    }
    clearNativeSelection();
    setPendingSelection(null);
    setEditingMarkerId(null);
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

  async function confirmSummary() {
    if (!summary) return;
    await supabase.from('summaries').update({ status: 'confirmed' }).eq('id', summary.id);
    load();
  }

  async function saveEditedSummary() {
    if (!summary) return;
    await supabase.from('summaries').update({ body: summaryDraft, status: 'edited' }).eq('id', summary.id);
    setEditingSummary(false);
    load();
  }

  async function rejectSummary() {
    if (!summary) return;
    await supabase.from('summaries').update({ status: 'rejected' }).eq('id', summary.id);
    load();
  }

  async function setTagStatus(ctId: string, status: 'confirmed' | 'rejected') {
    await supabase
      .from('conversation_tags')
      .update({ status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null })
      .eq('id', ctId);
    load();
  }

  async function addTag() {
    const name = newTagName.trim();
    if (!name || !id) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    let { data: existingTag } = await supabase
      .from('tags')
      .select('id')
      .eq('name', name)
      .eq('tag_type', newTagType)
      .maybeSingle();

    if (!existingTag) {
      const { data: created, error } = await supabase
        .from('tags')
        .insert({ name, tag_type: newTagType, user_id: userId })
        .select('id')
        .single();
      if (error) return;
      existingTag = created;
    }

    await supabase.from('conversation_tags').insert({
      conversation_id: id,
      tag_id: existingTag.id,
      status: 'confirmed',
      proposed_by: 'human',
      confirmed_at: new Date().toISOString(),
      user_id: userId,
    });
    setNewTagName('');
    load();
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
    }
    load();
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
  const proposedMarkerCount = markers.filter((m) => m.status === 'proposed').length;

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
        <ThemedText style={styles.note}>会話が見つかりませんでした。</ThemedText>
      </ThemedView>
    );
  }

  const visibleTags = conversationTags.filter((t) => showRejectedTags || t.status !== 'rejected');

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} testID="back-button">
          <ThemedText type="link">← 戻る</ThemedText>
        </Pressable>

        <ThemedView type="backgroundElement" style={styles.badge}>
          <ThemedText type="small">{SOURCE_LABEL[conversation.source] ?? conversation.source}</ThemedText>
        </ThemedView>

        <ThemedText type="small" themeColor="textSecondary">
          {conversation.projects?.name ?? '未分類（Inbox）'}
          {conversation.themes?.name ? ` / ${conversation.themes.name}` : ''}
        </ThemedText>

        <ThemedText type="subtitle">{conversation.title}</ThemedText>

        {/* 要約エリア */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">要約</ThemedText>
          {summary ? (
            <>
              {summary.status === 'proposed' && (
                <ThemedText type="small" themeColor="textSecondary">
                  🤖 AI提案（Ore）
                </ThemedText>
              )}
              {editingSummary ? (
                <>
                  <TextInput
                    style={styles.textArea}
                    value={summaryDraft}
                    onChangeText={setSummaryDraft}
                    multiline
                    testID="summary-edit-input"
                  />
                  <Pressable style={styles.smallButton} onPress={saveEditedSummary} testID="summary-save-button">
                    <ThemedText style={styles.smallButtonText}>保存</ThemedText>
                  </Pressable>
                </>
              ) : summary.status === 'rejected' ? (
                <ThemedText type="small" themeColor="textSecondary">
                  非表示にされています
                </ThemedText>
              ) : (
                <ThemedText>{summary.body}</ThemedText>
              )}

              {!editingSummary && summary.status !== 'rejected' && (
                <ThemedView style={styles.row}>
                  {summary.status === 'proposed' && (
                    <Pressable style={styles.smallButton} onPress={confirmSummary} testID="summary-confirm-button">
                      <ThemedText style={styles.smallButtonText}>このままでOK</ThemedText>
                    </Pressable>
                  )}
                  <Pressable
                    style={styles.smallButtonOutline}
                    onPress={() => setEditingSummary(true)}
                    testID="summary-edit-button"
                  >
                    <ThemedText type="small">編集する</ThemedText>
                  </Pressable>
                  <Pressable style={styles.smallButtonOutline} onPress={rejectSummary} testID="summary-reject-button">
                    <ThemedText type="small">非表示</ThemedText>
                  </Pressable>
                </ThemedView>
              )}
              {summary.status === 'rejected' && (
                <Pressable style={styles.smallButtonOutline} onPress={confirmSummary} testID="summary-unreject-button">
                  <ThemedText type="small">やっぱり表示する</ThemedText>
                </Pressable>
              )}
            </>
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              まだAI分析が実行されていません（会話一覧から実行できます）
            </ThemedText>
          )}
        </ThemedView>

        {/* タグエリア */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedView style={styles.rowBetween}>
            <ThemedText type="smallBold">タグ</ThemedText>
            <Pressable onPress={() => setShowRejectedTags((v) => !v)}>
              <ThemedText type="small" themeColor="textSecondary">
                {showRejectedTags ? '却下履歴を隠す' : '却下履歴を見る'}
              </ThemedText>
            </Pressable>
          </ThemedView>

          <ThemedView style={styles.tagWrap}>
            {visibleTags.map((ct) => (
              <ThemedView
                key={ct.id}
                style={[
                  styles.chip,
                  ct.status === 'confirmed' && styles.chipConfirmed,
                  ct.status === 'proposed' && styles.chipProposed,
                  ct.status === 'rejected' && styles.chipRejected,
                ]}
              >
                <ThemedText type="small">
                  {TAG_TYPE_LABEL[ct.tags.tag_type]}: {ct.tags.name}
                </ThemedText>
                {ct.status === 'proposed' && (
                  <ThemedView style={styles.chipActions}>
                    <Pressable onPress={() => setTagStatus(ct.id, 'confirmed')} testID={`tag-approve-${ct.id}`}>
                      <ThemedText type="small">✓</ThemedText>
                    </Pressable>
                    <Pressable onPress={() => setTagStatus(ct.id, 'rejected')} testID={`tag-reject-${ct.id}`}>
                      <ThemedText type="small">✕</ThemedText>
                    </Pressable>
                  </ThemedView>
                )}
                {ct.status === 'confirmed' && (
                  <Pressable onPress={() => setTagStatus(ct.id, 'rejected')} testID={`tag-unconfirm-${ct.id}`}>
                    <ThemedText type="small">✕</ThemedText>
                  </Pressable>
                )}
                {ct.status === 'rejected' && (
                  <Pressable onPress={() => setTagStatus(ct.id, 'confirmed')} testID={`tag-restore-${ct.id}`}>
                    <ThemedText type="small">戻す</ThemedText>
                  </Pressable>
                )}
              </ThemedView>
            ))}
          </ThemedView>

          <ThemedView style={styles.row}>
            <TextInput
              style={styles.tagInput}
              placeholder="＋タグを追加"
              value={newTagName}
              onChangeText={setNewTagName}
              onSubmitEditing={addTag}
              testID="new-tag-input"
            />
            <Pressable
              style={styles.smallButtonOutline}
              onPress={() => setNewTagType(newTagType === 'topic' ? 'concept' : 'topic')}
            >
              <ThemedText type="small">{TAG_TYPE_LABEL[newTagType]}</ThemedText>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={addTag} testID="add-tag-button">
              <ThemedText style={styles.smallButtonText}>追加</ThemedText>
            </Pressable>
          </ThemedView>
        </ThemedView>

        {/* 本文（マーカーハイライト＋範囲選択） */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">本文</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            文字をドラッグ選択すると新規マーカーを作成できます。ハイライト済み箇所をタップすると、その場で範囲を左右にドラッグ調整してから承認/却下できます。
          </ThemedText>
          {messages.map((m) => {
            const segments = computeSegments(m.content, layersByMessage[m.id] ?? []);
            return (
              <ThemedView key={m.id} style={styles.messageRow}>
                <ThemedText type="small" themeColor="textSecondary">
                  {m.role === 'user' ? 'あなた' : 'AI'}
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
          {proposedMarkerCount > 0 && (
            <Pressable
              style={styles.smallButtonOutline}
              onPress={() => router.push({ pathname: '/conversation/[id]/review', params: { id: id! } })}
              testID="start-marker-review"
            >
              <ThemedText type="small">まとめてマーカーレビュー（{proposedMarkerCount}件）→</ThemedText>
            </Pressable>
          )}
        </ThemedView>

        {pendingSelection && (
          <ThemedView type="backgroundElement" style={styles.actionBar}>
            <ThemedText type="small">
              {editingMarker
                ? `${editingMarker.status === 'proposed' ? '🤖 AI提案（Ore）を編集：' : 'マーカーを編集：'}「${(pendingSelection.text || editingMarker.quoted_text).slice(0, 40)}」`
                : `新規マーカーを作成：「${pendingSelection.text.slice(0, 40)}」`}
            </ThemedText>
            {editingMarker && (
              <ThemedText type="small" themeColor="textSecondary">
                範囲をドラッグして調整してから色を選ぶと、その範囲で確定します
              </ThemedText>
            )}
            <ThemedView style={styles.row}>
              {MARKER_COLORS.map((c) => (
                <Pressable
                  key={c.key}
                  style={[styles.swatch, { backgroundColor: c.hex }]}
                  onPress={() => confirmPendingMarker(c.key)}
                  testID={`marker-color-${c.key}`}
                />
              ))}
              {editingMarker && (
                <Pressable
                  style={styles.smallButtonOutline}
                  onPress={() => rejectMarker(editingMarker.id)}
                  testID="reject-marker-button"
                >
                  <ThemedText type="small">却下</ThemedText>
                </Pressable>
              )}
              <Pressable style={styles.smallButtonOutline} onPress={cancelPendingMarker} testID="cancel-new-marker">
                <ThemedText type="small">キャンセル</ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>
        )}

        {/* メモ */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">メモ</ThemedText>
          <TextInput
            style={styles.textArea}
            value={memoDraft}
            onChangeText={setMemoDraft}
            multiline
            placeholder="この会話についてのメモ"
            testID="memo-input"
          />
          <Pressable style={styles.smallButton} onPress={saveMemo} testID="memo-save-button">
            <ThemedText style={styles.smallButtonText}>保存</ThemedText>
          </Pressable>
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
  badge: { alignSelf: 'flex-start', borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
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
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
  chipProposed: { borderStyle: 'dashed' },
  chipConfirmed: { borderStyle: 'solid', borderColor: '#208AEF' },
  chipRejected: { opacity: 0.5 },
  chipActions: { flexDirection: 'row', gap: Spacing.one },
  tagInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
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
