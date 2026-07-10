/**
 * 会話一覧（暫定Inbox）— Step4のAI処理を手動起動するための最小画面。
 * 本格的なS3〜S5（Realm/Wing階層）はStep 5で実装し、この画面はS5(Inbox)に発展させる。
 */

import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { analyzeConversation } from '@/lib/aiService';
import { useAuth } from '@/lib/auth-context';
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

type RowState = { kind: 'idle' } | { kind: 'running' } | { kind: 'done'; note: string } | { kind: 'error'; note: string };

export default function InboxScreen() {
  const { session, loading } = useAuth();
  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, RowState>>({});

  const load = useCallback(async () => {
    const { data: conversations } = await supabase
      .from('conversations')
      .select('id, title, source, imported_at')
      .order('imported_at', { ascending: false })
      .limit(200);
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
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!loading && !session) return <Redirect href="/login" />;

  async function runAnalysis(conversationId: string) {
    setRowStates((s) => ({ ...s, [conversationId]: { kind: 'running' } }));
    const result = await analyzeConversation(conversationId);
    if (result.ok) {
      setRowStates((s) => ({
        ...s,
        [conversationId]: {
          kind: 'done',
          note: `要約1件・タグ${result.conversation_tags ?? 0}件・マーカー${result.markers ?? 0}件を提案（Ore）`,
        },
      }));
    } else {
      setRowStates((s) => ({
        ...s,
        [conversationId]: { kind: 'error', note: result.error ?? '不明なエラー' },
      }));
    }
  }

  return (
    <ThemedView style={styles.container}>
      <FlatList
        contentContainerStyle={styles.content}
        data={rows ?? []}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <ThemedText type="small" style={styles.note}>
            「AI分析」を押すと、その会話の本文がEdge Function経由でClaude APIに送信され、要約・タグ・重要箇所が提案（Ore）として生成されます。
          </ThemedText>
        }
        ListEmptyComponent={
          rows === null ? (
            <ActivityIndicator style={{ marginTop: Spacing.five }} />
          ) : (
            <ThemedText style={styles.note}>
              会話がまだありません。まずインポートしてください。
            </ThemedText>
          )
        }
        renderItem={({ item }) => {
          const state = rowStates[item.id] ?? { kind: 'idle' };
          return (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" numberOfLines={2}>
                {item.title}
              </ThemedText>
              <ThemedText type="small">
                {SOURCE_LABEL[item.source] ?? item.source} ・{' '}
                {new Date(item.imported_at).toLocaleDateString('ja-JP')}
                {item.latestJobStatus === 'done' && ' ・ 分析済み'}
              </ThemedText>

              {state.kind === 'done' && <ThemedText type="small">✅ {state.note}</ThemedText>}
              {state.kind === 'error' && (
                <ThemedText type="small" style={styles.error}>
                  ⚠️ {state.note}
                </ThemedText>
              )}

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
  button: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  error: { color: '#D93025' },
});
