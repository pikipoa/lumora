/**
 * S8 横断検索画面（ux-flow-and-screens.md §2-1）。全プロジェクト・全AI横断の
 * キーワード検索＋タグ検索（confirmedタグでフィルタ）。
 *
 * キーワード検索はpg_trgmベースのRPC `search_conversations`（会話タイトル/本文/要約を横断）。
 * タグ検索は`ConversationTag`のconfirmed行のみを対象にする（横断検索の粗い絞り込みという
 * 役割分担はdata-model.md「論点F」の通り）。両方指定時はAND（両方に一致する会話のみ）。
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

interface TagOption {
  id: string;
  name: string;
  tag_type: 'topic' | 'concept';
}

export default function SearchScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { q: initialQuery } = useLocalSearchParams<{ q?: string }>();

  const [query, setQuery] = useState(initialQuery ?? '');
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('conversation_tags')
        .select('tags(id, name, tag_type)')
        .eq('status', 'confirmed');
      const seen = new Map<string, TagOption>();
      for (const row of data ?? []) {
        const tag = (row as unknown as { tags: TagOption }).tags;
        if (tag) seen.set(tag.id, tag);
      }
      setTagOptions([...seen.values()]);
    })();
  }, [session]);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed && !selectedTagId) {
      setResults(null);
      return;
    }
    setSearching(true);

    let keywordMatches: ResultRow[] | null = null;
    if (trimmed) {
      const { data } = await supabase.rpc('search_conversations', { search_query: trimmed });
      keywordMatches = (data as ResultRow[]) ?? [];
    }

    let tagMatches: ResultRow[] | null = null;
    if (selectedTagId) {
      const { data } = await supabase
        .from('conversation_tags')
        .select('conversations(id, title, source, imported_at)')
        .eq('status', 'confirmed')
        .eq('tag_id', selectedTagId);
      tagMatches = (data ?? [])
        .map((row) => (row as unknown as { conversations: ResultRow | null }).conversations)
        .filter((c): c is ResultRow => !!c)
        .map((c) => ({ ...c, snippet: c.title }));
    }

    let combined: ResultRow[];
    if (keywordMatches && tagMatches) {
      const tagIds = new Set(tagMatches.map((r) => r.id));
      combined = keywordMatches.filter((r) => tagIds.has(r.id));
    } else {
      combined = keywordMatches ?? tagMatches ?? [];
    }

    setResults(combined);
    setSearching(false);
  }, [query, selectedTagId]);

  useEffect(() => {
    runSearch();
  }, [selectedTagId]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {tagOptions.length > 0 && (
          <ThemedView style={styles.tagWrap}>
            {tagOptions.map((t) => (
              <Pressable
                key={t.id}
                style={[styles.chip, selectedTagId === t.id && styles.chipActive]}
                onPress={() => setSelectedTagId(selectedTagId === t.id ? null : t.id)}
                testID={`filter-tag-${t.id}`}
              >
                <ThemedText type="small">{t.name}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

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
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  chipActive: { borderColor: '#208AEF', backgroundColor: '#208AEF22' },
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
