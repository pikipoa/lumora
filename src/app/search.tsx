/**
 * S8 横断検索画面（Lumora最大の価値・知識発掘のコア体験）。
 * 全プロジェクト・全AI横断のキーワード検索。pg_trgmベースのRPC `search_conversations`。
 *
 * 【表示改善（2026-07-12、ピキさんUXフィードバック）】
 * - 「横断検索」という画面名の表示をやめ、検索後は「検索ワード＋n件」を見出しにする
 * - 結果の各行は「会話された日付・会話元のAI・ユーザーの言葉・AIの回答」の最小表示
 *   （タイトルとスニペットが同じ文で二重に見える問題への対応。特にGeminiはタイトル＝
 *   最初のユーザー発言のため顕著だった）
 * - 並び替え（新しい順/古い順/長い順/短い順）を小さなポップオーバーで切替できる
 */

import { Redirect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ConversationPeekSheet } from '@/components/conversation-peek-sheet';
import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const SORT_OPTIONS = [
  { key: 'new', label: t.searchScreen.sortNew },
  { key: 'old', label: t.searchScreen.sortOld },
  { key: 'long', label: t.searchScreen.sortLong },
  { key: 'short', label: t.searchScreen.sortShort },
] as const;
type SortKey = (typeof SORT_OPTIONS)[number]['key'];

interface ResultRow {
  id: string;
  title: string;
  source: string;
  project_id: string | null;
  created_at: string | null;
  imported_at: string;
  user_text: string | null;
  assistant_text: string | null;
  total_chars: number;
}

function conversationDate(r: ResultRow): string {
  return new Date(r.created_at ?? r.imported_at).toLocaleDateString('ja-JP');
}

export default function SearchScreen() {
  const theme = useTheme();
  const { session, loading } = useAuth();
  const { q: initialQuery } = useLocalSearchParams<{ q?: string }>();

  const [query, setQuery] = useState(initialQuery ?? '');
  // 見出しの「検索ワード n件」は、入力中の文字ではなく実際に検索した語を出す
  const [searchedQuery, setSearchedQuery] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('new');
  // 検索結果タップ→この会話をボトムシートで覗く（2026-07-12）。フルページ遷移ではないため
  // シートを閉じても検索結果一覧・スクロール位置・並び替え状態はそのまま保たれる
  const [peekConversationId, setPeekConversationId] = useState<string | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  // 取り込み元での絞り込み（2026-07-24、ピキさんの着想：複数社を一括インポートしていると
  // 目的のAI由来の会話だけを見たい場面があり、より正確に絞り込めるようにする）。
  // 空集合＝絞り込みなし（全件表示）。sourceは一次情報そのものの属性であり、後から人間が
  // 付与するRealm/Wing/Tagとは異なるため、search-spec.mdの「整理後の構造は検索対象・結果に
  // 混ぜない」原則とは衝突しない
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);

  const runSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults(null);
      setSearchedQuery(null);
      return;
    }
    setSearching(true);
    const { data } = await supabase.rpc('search_conversations', { search_query: trimmed });
    setResults((data as ResultRow[]) ?? []);
    setSearchedQuery(trimmed);
    setSourceFilter(new Set());
    setSearching(false);
  }, [query]);

  useEffect(() => {
    if (initialQuery) runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const availableSources = useMemo(
    () => [...new Set((results ?? []).map((r) => r.source))],
    [results],
  );

  const filtered = useMemo(() => {
    if (!results) return null;
    if (sourceFilter.size === 0) return results;
    return results.filter((r) => sourceFilter.has(r.source));
  }, [results, sourceFilter]);

  const sorted = useMemo(() => {
    if (!filtered) return null;
    const rows = [...filtered];
    const time = (r: ResultRow) => new Date(r.created_at ?? r.imported_at).getTime();
    switch (sortKey) {
      case 'new':
        return rows.sort((a, b) => time(b) - time(a));
      case 'old':
        return rows.sort((a, b) => time(a) - time(b));
      case 'long':
        return rows.sort((a, b) => b.total_chars - a.total_chars);
      case 'short':
        return rows.sort((a, b) => a.total_chars - b.total_chars);
    }
  }, [filtered, sortKey]);

  function toggleSourceFilter(source: string) {
    setSourceFilter((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  }

  if (!loading && !session) return <Redirect href="/login" />;

  const currentSortLabel = SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? '';

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />

        <ThemedView style={styles.row}>
          <TextInput
            style={[styles.input, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement, color: theme.text }]}
            placeholder={t.searchScreen.placeholder}
            placeholderTextColor={theme.textSecondary}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={runSearch}
            returnKeyType="search"
            testID="search-input"
          />
          <Pressable style={styles.smallButton} onPress={runSearch} testID="search-button">
            <ThemedText style={styles.smallButtonText}>{t.common.search}</ThemedText>
          </Pressable>
        </ThemedView>

        {searchedQuery !== null && sorted !== null && (
          <ThemedView style={styles.headingRow}>
            <ThemedText type="subtitle" numberOfLines={1} style={{ flexShrink: 1 }}>
              {searchedQuery}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t.common.items(sorted.length)}
            </ThemedText>
            {(results?.length ?? 0) > 1 && (
              <Pressable onPress={() => setSortOpen((v) => !v)} testID="sort-toggle">
                <ThemedText type="small" themeColor="textSecondary">
                  {currentSortLabel} ▾
                </ThemedText>
              </Pressable>
            )}
            {availableSources.length > 1 && (
              <Pressable onPress={() => setFilterOpen((v) => !v)} testID="filter-toggle">
                <ThemedText type="small" themeColor="textSecondary">
                  {sourceFilter.size === 0
                    ? t.searchScreen.filterAll
                    : [...sourceFilter].map((s) => t.sources[s] ?? s).join('・')}{' '}
                  ▾
                </ThemedText>
              </Pressable>
            )}
          </ThemedView>
        )}

        {sortOpen && (
          <ThemedView style={styles.row}>
            {SORT_OPTIONS.map((o) => (
              <Pressable
                key={o.key}
                style={[styles.chip, { borderColor: theme.backgroundSelected }, sortKey === o.key && styles.chipActive]}
                onPress={() => {
                  setSortKey(o.key);
                  setSortOpen(false);
                }}
                testID={`sort-${o.key}`}
              >
                <ThemedText type="small">{o.label}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        {filterOpen && (
          <ThemedView style={styles.row}>
            <Pressable
              style={[styles.chip, { borderColor: theme.backgroundSelected }, sourceFilter.size === 0 && styles.chipActive]}
              onPress={() => setSourceFilter(new Set())}
              testID="source-filter-all"
            >
              <ThemedText type="small">{t.searchScreen.filterAll}</ThemedText>
            </Pressable>
            {availableSources.map((s) => (
              <Pressable
                key={s}
                style={[styles.chip, { borderColor: theme.backgroundSelected }, sourceFilter.has(s) && styles.chipActive]}
                onPress={() => toggleSourceFilter(s)}
                testID={`source-filter-${s}`}
              >
                <ThemedText type="small">{t.sources[s] ?? s}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        {searching && <ActivityIndicator style={{ marginTop: Spacing.three }} />}

        {!searching && sorted !== null && sorted.length === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            {t.searchScreen.empty}
          </ThemedText>
        )}

        {!searching &&
          sorted?.map((r) => (
            <Pressable
              key={r.id}
              style={styles.resultRow}
              onPress={() => setPeekConversationId(r.id)}
              testID={`search-result-${r.id}`}
            >
              <ThemedText type="small" themeColor="textSecondary">
                {conversationDate(r)} ・ {t.sources[r.source] ?? r.source}
              </ThemedText>
              {r.user_text ? (
                <ThemedText type="smallBold" numberOfLines={2}>
                  {r.user_text}
                </ThemedText>
              ) : (
                <ThemedText type="smallBold" numberOfLines={2}>
                  {r.title}
                </ThemedText>
              )}
              {r.assistant_text && (
                <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                  {r.assistant_text}
                </ThemedText>
              )}
            </Pressable>
          ))}
      </ScrollView>

      {peekConversationId && (
        <ConversationPeekSheet
          conversationId={peekConversationId}
          searchTerm={searchedQuery ?? ''}
          onClose={() => setPeekConversationId(null)}
        />
      )}
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
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', flexWrap: 'wrap' },
  headingRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'baseline' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  chip: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  chipActive: { borderColor: '#208AEF', backgroundColor: '#208AEF22' },
  resultRow: { gap: Spacing.half, paddingVertical: Spacing.one },
  smallButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  smallButtonText: { color: '#fff', fontWeight: '600' },
});
