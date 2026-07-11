/**
 * S5 会話一覧（Theme内 or Inbox）。ux-flow-and-screens.md §2-1準拠。
 * クエリパラメータなし＝未分類（Inbox。project_id null）。
 * projectId＝そのプロジェクト直下でテーマ未割当の会話。themeId＝そのテーマ内の会話。
 * AI分析の手動起動ボタンもここに置く（Step4から引き続き）。
 */

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { analyzeConversation } from '@/lib/aiService';
import { useAuth } from '@/lib/auth-context';
import { notifyReviewPending } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

const SOURCE_LABEL: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
};

interface ConversationRow {
  id: string;
  title: string;
  source: string;
  imported_at: string;
  latestJobStatus: string | null;
}

interface ProjectOption {
  id: string;
  name: string;
}

type RowState = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; note: string } | { kind: 'error'; note: string };

export default function InboxScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { projectId, themeId, themeName } = useLocalSearchParams<{
    projectId?: string;
    themeId?: string;
    themeName?: string;
  }>();

  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});
  const [headerLabel, setHeaderLabel] = useState('未分類（Inbox）');
  const [projectOptions, setProjectOptions] = useState<ProjectOption[] | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const isInboxMode = !projectId && !themeId;

  const load = useCallback(async () => {
    let query = supabase
      .from('conversations')
      .select('id, title, source, imported_at')
      .order('imported_at', { ascending: false })
      .limit(200);

    if (themeId) {
      query = query.eq('theme_id', themeId);
      setHeaderLabel(themeName ? `テーマ: ${themeName}` : 'テーマ内の会話');
    } else if (projectId) {
      query = query.eq('project_id', projectId).is('theme_id', null);
      const { data: project } = await supabase.from('projects').select('name').eq('id', projectId).single();
      setHeaderLabel(project ? `${project.name}：未割当の会話` : 'プロジェクト内の会話');
    } else {
      query = query.is('project_id', null);
      setHeaderLabel('未分類（Inbox）');
    }

    const { data: conversations } = await query;
    const { data: jobs } = await supabase
      .from('ai_jobs')
      .select('conversation_id, status, created_at')
      .order('created_at', { ascending: false });

    const latestJob = new Map<string, string>();
    for (const j of jobs ?? []) {
      if (!latestJob.has(j.conversation_id)) latestJob.set(j.conversation_id, j.status);
    }
    setRows(
      (conversations ?? []).map((c) => ({
        ...c,
        latestJobStatus: latestJob.get(c.id) ?? null,
      })),
    );
  }, [projectId, themeId, themeName]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!loading && !session) return <Redirect href="/login" />;

  async function runAnalysis(conversationId: string) {
    setRowStates((s) => ({ ...s, [conversationId]: { kind: 'running' } }));
    const result = await analyzeConversation(conversationId);
    if (result.ok) {
      const note = `要約1件・タグ${result.conversation_tags ?? 0}件・マーカー${result.markers ?? 0}件を提案（Ore）`;
      setRowStates((s) => ({
        ...s,
        [conversationId]: { kind: 'done', note },
      }));
      const hasProposals = (result.conversation_tags ?? 0) > 0 || (result.markers ?? 0) > 0;
      if (hasProposals) notifyReviewPending(note);
    } else {
      setRowStates((s) => ({
        ...s,
        [conversationId]: { kind: 'error', note: result.error ?? '不明なエラー' },
      }));
    }
  }

  async function openAssignPicker(conversationId: string) {
    if (!projectOptions) {
      const { data } = await supabase.from('projects').select('id, name').order('created_at', { ascending: false });
      setProjectOptions(data ?? []);
    }
    setAssigningId(conversationId);
  }

  async function assignToProject(conversationId: string, targetProjectId: string) {
    await supabase.from('conversations').update({ project_id: targetProjectId }).eq('id', conversationId);
    setAssigningId(null);
    load();
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows ?? []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <>
            <ThemedText type="smallBold">{headerLabel}</ThemedText>
            <ThemedText type="small" style={styles.note}>
              「AI分析」を押すと、その会話の本文がEdge Function経由でClaude APIに送信され、要約・タグ・重要箇所が提案（Ore）として生成されます。
            </ThemedText>
          </>
        }
        ListEmptyComponent={
          rows === null ? (
            <ActivityIndicator style={{ marginTop: Spacing.five }} />
          ) : (
            <ThemedText style={styles.note}>会話がまだありません。</ThemedText>
          )
        }
        renderItem={({ item }) => {
          const state = rowStates[item.id] ?? { kind: 'idle' };
          return (
            <ThemedView type="backgroundElement" style={styles.card}>
              <Pressable
                onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: item.id } })}
                testID={`open-${item.id}`}
              >
                <ThemedText type="smallBold" numberOfLines={2}>
                  {item.title}
                </ThemedText>
                <ThemedText type="small">
                  {SOURCE_LABEL[item.source] ?? item.source} ・{' '}
                  {new Date(item.imported_at).toLocaleDateString('ja-JP')}
                  {item.latestJobStatus === 'done' && ' ・ 分析済み'}
                </ThemedText>
              </Pressable>

              {state.kind === 'done' && <ThemedText type="small">✅ {state.note}</ThemedText>}
              {state.kind === 'error' && (
                <ThemedText type="small" style={styles.error}>
                  ⚠️ {state.note}
                </ThemedText>
              )}

              <ThemedView style={styles.row}>
                <Pressable
                  style={[styles.button, state.kind === 'running' && styles.buttonDisabled]}
                  disabled={state.kind === 'running'}
                  onPress={() => runAnalysis(item.id)}
                  testID={`analyze-${item.id}`}
                >
                  {state.kind === 'running' ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <ThemedText style={styles.buttonText}>
                      🤖 AI分析{item.latestJobStatus === 'done' ? '（再実行）' : 'を実行'}
                    </ThemedText>
                  )}
                </Pressable>

                {isInboxMode && (
                  <Pressable
                    style={styles.buttonOutline}
                    onPress={() => openAssignPicker(item.id)}
                    testID={`assign-${item.id}`}
                  >
                    <ThemedText type="small">プロジェクトに割り当てる</ThemedText>
                  </Pressable>
                )}
              </ThemedView>

              {assigningId === item.id && (
                <ThemedView style={styles.tagWrap}>
                  {(projectOptions ?? []).map((p) => (
                    <Pressable
                      key={p.id}
                      style={styles.chip}
                      onPress={() => assignToProject(item.id, p.id)}
                      testID={`assign-to-${p.id}`}
                    >
                      <ThemedText type="small">{p.name}</ThemedText>
                    </Pressable>
                  ))}
                  {(projectOptions ?? []).length === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      プロジェクトがまだありません
                    </ThemedText>
                  )}
                </ThemedView>
              )}
            </ThemedView>
          );
        }}
      />
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
  note: { opacity: 0.7 },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  error: { color: '#D93025' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
