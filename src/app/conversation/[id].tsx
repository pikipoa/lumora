/**
 * S6 会話詳細（レビュー画面）。要約/タグのAI提案(Ore)を確認・確定する主戦場。
 * マーカー（本文中の重要箇所ハイライト・色選択）はStep6スパイク→Step7で実装するため、
 * このバージョンではproposedマーカーの一覧を簡易表示するに留める。
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

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
  quoted_text: string;
  role_tag: string | null;
  status: string;
}

interface MemoRow {
  id: string;
  body: string;
}

export default function ConversationDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

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
        supabase.from('markers').select('id, quoted_text, role_tag, status').eq('conversation_id', id),
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
  const proposedMarkers = markers.filter((m) => m.status === 'proposed');

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

        {/* マーカー簡易一覧（範囲調整・色確定はStep7で実装） */}
        {proposedMarkers.length > 0 && (
          <ThemedView type="backgroundElement" style={styles.section}>
            <ThemedText type="smallBold">AI提案のマーカー（{proposedMarkers.length}件・簡易表示）</ThemedText>
            {proposedMarkers.map((m) => (
              <ThemedText type="small" key={m.id}>
                ・{m.role_tag ? `[${m.role_tag}] ` : ''}
                {m.quoted_text}
              </ThemedText>
            ))}
            <ThemedText type="small" themeColor="textSecondary">
              範囲調整・色選択での確定はマーカー確定UI（Step7）実装後に対応します
            </ThemedText>
          </ThemedView>
        )}

        {/* 本文 */}
        <ThemedView type="backgroundElement" style={styles.section}>
          <ThemedText type="smallBold">本文</ThemedText>
          {messages.map((m) => (
            <ThemedView key={m.id} style={styles.messageRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {m.role === 'user' ? 'あなた' : 'AI'}
              </ThemedText>
              <ThemedText>{m.content}</ThemedText>
            </ThemedView>
          ))}
        </ThemedView>

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
