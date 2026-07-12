/**
 * S8 横断検索画面（Lumora最大の価値・知識発掘のコア体験）。
 * 全プロジェクト・全AI横断のキーワード検索。pg_trgmベースのRPC `search_conversations`
 * （会話タイトル/本文を横断）。
 *
 * 【v2.1 認知OSへの改訂（2026-07-12）】タグ絞り込みチップ（ConversationTagベース）は削除した。
 * TagはAIの理解構造（検索・推論・関連発見のためにAIが内部で使う）であり、UIに常時表示しない
 * （5オブジェクト定義：docs/data-model.md「0. 設計思想」）。
 */

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const SOURCE_LABEL: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
};

interface ResultRow {
  id: string;
  title: string;
  source: string;
  imported_at: string;
  snippet: string;
}

export default function SearchScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { q: initialQuery } = useLocalSearchParams<{ q?: string }>();

  const [query, setQuery] = useState(initialQuery ?? '');
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      return;
    }
    setSearching(true);
    const { data } = await supabase.rpc('search_conversations', { search_query: trimmed });
    setResults((data as ResultRow[]) ?? []);
    setSearching(false);
  }, [query]);

  useEffect(() => {
    if (initialQuery) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!loading && !session) return <Redirect href="/login" />;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <ThemedText type="subtitle">横断検索</ThemedText>

        <ThemedView style={styles.row}>
          <TextInput
            style={styles.input}
            placeholder="キーワードで検索"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            testID="search-input"
          />
          <Pressable style={styles.smallButton} onPress={runSearch} testID="search-button">
            <ThemedText style={styles.smallButtonText}>検索</ThemedText>
          </Pressable>
        </ThemedView>

        {searching && <ActivityIndicator style={{ marginTop: Spacing.three }} />}

        {!searching && results !== null && results.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            該当する会話が見つかりませんでした。
          </ThemedText>
        )}

        {!searching &&
          results?.map((r) => (
            <Pressable
              key={r.id}
              style={styles.card}
              onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: r.id } })}
              testID={`search-result-${r.id}`}
            >
              <ThemedText type="smallBold" numberOfLines={2}>
                {r.title}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {SOURCE_LABEL[r.source] ?? r.source} ・ {new Date(r.imported_at).toLocaleDateString('ja-JP')}
              </ThemedText>
              {r.snippet && r.snippet !== r.title && (
                <ThemedText type="small" numberOfLines={2}>
                  …{r.snippet}…
                </ThemedText>
              )}
            </Pressable>
          ))}
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
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one, backgroundColor: '#F0F0F3' },
  smallButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  smallButtonText: { color: '#fff', fontWeight: '600' },
});
