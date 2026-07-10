/**
 * S4 プロジェクト詳細（ux-flow-and-screens.md §2-1）。Theme一覧、プロジェクト内会話数、未レビュー件数。
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { loadUnreviewedCounts } from '@/lib/review';
import { supabase } from '@/lib/supabase';

interface ThemeRow {
  id: string;
  name: string;
  conversationCount: number;
  unreviewedCount: number;
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [projectName, setProjectName] = useState<string | null>(null);
  const [themes, setThemes] = useState<ThemeRow[] | null>(null);
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [creatingTheme, setCreatingTheme] = useState(false);
  const [newThemeName, setNewThemeName] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: project }, { data: themeRows }, { data: conversations }, counts] = await Promise.all([
      supabase.from('projects').select('name').eq('id', id).single(),
      supabase.from('themes').select('id, name').eq('project_id', id).order('created_at'),
      supabase.from('conversations').select('id, theme_id').eq('project_id', id),
      loadUnreviewedCounts(),
    ]);

    setProjectName(project?.name ?? null);

    const countByTheme = new Map<string, number>();
    let unassigned = 0;
    for (const c of conversations ?? []) {
      if (c.theme_id) countByTheme.set(c.theme_id, (countByTheme.get(c.theme_id) ?? 0) + 1);
      else unassigned += 1;
    }
    setUnassignedCount(unassigned);

    setThemes(
      (themeRows ?? []).map((t) => ({
        ...t,
        conversationCount: countByTheme.get(t.id) ?? 0,
        unreviewedCount: counts.byTheme[t.id] ?? 0,
      })),
    );
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function createTheme() {
    const trimmed = newThemeName.trim();
    if (!trimmed || !id) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    await supabase.from('themes').insert({ name: trimmed, project_id: id, user_id: userId });
    setNewThemeName('');
    setCreatingTheme(false);
    load();
  }

  if (themes === null) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} testID="back-button">
          <ThemedText type="link">← プロジェクト一覧</ThemedText>
        </Pressable>

        <ThemedText type="subtitle">{projectName ?? ''}</ThemedText>

        <Pressable
          style={styles.card}
          onPress={() => router.push({ pathname: '/inbox', params: { projectId: id } })}
          testID="unassigned-conversations-card"
        >
          <ThemedText type="smallBold">未割当の会話</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {unassignedCount}件
          </ThemedText>
        </Pressable>

        {themes.map((t) => (
          <Pressable
            key={t.id}
            style={styles.card}
            onPress={() => router.push({ pathname: '/inbox', params: { themeId: t.id, themeName: t.name } })}
            testID={`theme-${t.id}`}
          >
            <ThemedText type="smallBold">{t.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              会話{t.conversationCount}件
              {t.unreviewedCount > 0 ? ` ・ ${t.unreviewedCount}件レビュー待ち` : ''}
            </ThemedText>
          </Pressable>
        ))}

        {!creatingTheme ? (
          <Pressable style={styles.newButton} onPress={() => setCreatingTheme(true)} testID="new-theme-button">
            <ThemedText style={styles.newButtonText}>＋ 新規テーマ</ThemedText>
          </Pressable>
        ) : (
          <ThemedView style={styles.row}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="テーマ名"
              value={newThemeName}
              onChangeText={setNewThemeName}
              onSubmitEditing={createTheme}
              testID="theme-name-input"
            />
            <Pressable style={styles.newButton} onPress={createTheme} testID="create-theme-button">
              <ThemedText style={styles.newButtonText}>作成</ThemedText>
            </Pressable>
          </ThemedView>
        )}
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
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one, backgroundColor: '#F0F0F3' },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.two,
  },
  newButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  newButtonText: { color: '#fff', fontWeight: '600' },
});
