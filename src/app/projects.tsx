/**
 * S3 プロジェクト一覧（ux-flow-and-screens.md §2-1）。Project一覧＋未分類Inboxへの導線。
 * プロジェクト作成時の種タグ登録UI（コールドスタート対応）もここに置く。
 */

import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { loadUnreviewedCounts } from '@/lib/review';
import { supabase } from '@/lib/supabase';

const TAG_TYPE_LABEL: Record<string, string> = { topic: 'Topic', concept: 'Concept' };

interface ProjectRow {
  id: string;
  name: string;
  description: string | null;
  conversationCount: number;
  unreviewedCount: number;
}

export default function ProjectsScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();

  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [inboxUnreviewed, setInboxUnreviewed] = useState(0);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [seedTags, setSeedTags] = useState<{ name: string; tag_type: 'topic' | 'concept' }[]>([]);
  const [seedTagInput, setSeedTagInput] = useState('');
  const [seedTagType, setSeedTagType] = useState<'topic' | 'concept'>('topic');

  const load = useCallback(async () => {
    const [{ data: projectRows }, { data: conversations }, counts] = await Promise.all([
      supabase.from('projects').select('id, name, description').order('created_at', { ascending: false }),
      supabase.from('conversations').select('id, project_id'),
      loadUnreviewedCounts(),
    ]);

    const countByProject = new Map<string, number>();
    for (const c of conversations ?? []) {
      if (!c.project_id) continue;
      countByProject.set(c.project_id, (countByProject.get(c.project_id) ?? 0) + 1);
    }

    setProjects(
      (projectRows ?? []).map((p) => ({
        ...p,
        conversationCount: countByProject.get(p.id) ?? 0,
        unreviewedCount: counts.byProject[p.id] ?? 0,
      })),
    );
    setInboxUnreviewed(counts.inbox);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!loading && !session) return <Redirect href="/login" />;

  function addSeedTag() {
    const trimmed = seedTagInput.trim();
    if (!trimmed) return;
    setSeedTags((prev) => [...prev, { name: trimmed, tag_type: seedTagType }]);
    setSeedTagInput('');
  }

  async function createProject() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    await supabase.from('projects').insert({
      name: trimmedName,
      description: description.trim() || null,
      user_id: userId,
    });

    for (const tag of seedTags) {
      const { data: existing } = await supabase
        .from('tags')
        .select('id')
        .eq('name', tag.name)
        .eq('tag_type', tag.tag_type)
        .maybeSingle();
      if (!existing) {
        await supabase.from('tags').insert({ name: tag.name, tag_type: tag.tag_type, user_id: userId });
      }
    }

    setName('');
    setDescription('');
    setSeedTags([]);
    setCreating(false);
    load();
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">プロジェクト</ThemedText>

        <Pressable style={styles.card} onPress={() => router.push('/inbox')} testID="open-inbox-card">
          <ThemedText type="smallBold">📂 未分類（Inbox）</ThemedText>
          {inboxUnreviewed > 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {inboxUnreviewed}件レビュー待ち
            </ThemedText>
          )}
        </Pressable>

        {projects === null ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} />
        ) : (
          projects.map((p) => (
            <Pressable
              key={p.id}
              style={styles.card}
              onPress={() => router.push({ pathname: '/projects/[id]', params: { id: p.id } })}
              testID={`project-${p.id}`}
            >
              <ThemedText type="smallBold">{p.name}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                会話{p.conversationCount}件
                {p.unreviewedCount > 0 ? ` ・ ${p.unreviewedCount}件レビュー待ち` : ''}
              </ThemedText>
            </Pressable>
          ))
        )}

        {!creating ? (
          <Pressable style={styles.newButton} onPress={() => setCreating(true)} testID="new-project-button">
            <ThemedText style={styles.newButtonText}>＋ 新規プロジェクト</ThemedText>
          </Pressable>
        ) : (
          <ThemedView type="backgroundElement" style={styles.form}>
            <ThemedText type="smallBold">新規プロジェクト</ThemedText>
            <TextInput
              style={styles.input}
              placeholder="プロジェクト名"
              value={name}
              onChangeText={setName}
              testID="project-name-input"
            />
            <TextInput
              style={styles.input}
              placeholder="説明（任意）"
              value={description}
              onChangeText={setDescription}
              testID="project-description-input"
            />

            <ThemedText type="small">種タグ（任意・後からいつでも追加できます）</ThemedText>
            <ThemedView style={styles.tagWrap}>
              {seedTags.map((t, i) => (
                <ThemedView key={i} style={styles.chip}>
                  <ThemedText type="small">
                    {TAG_TYPE_LABEL[t.tag_type]}: {t.name}
                  </ThemedText>
                </ThemedView>
              ))}
            </ThemedView>
            <ThemedView style={styles.row}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                placeholder="タグ名"
                value={seedTagInput}
                onChangeText={setSeedTagInput}
                onSubmitEditing={addSeedTag}
                testID="seed-tag-input"
              />
              <Pressable
                style={styles.smallButtonOutline}
                onPress={() => setSeedTagType(seedTagType === 'topic' ? 'concept' : 'topic')}
              >
                <ThemedText type="small">{TAG_TYPE_LABEL[seedTagType]}</ThemedText>
              </Pressable>
              <Pressable style={styles.smallButtonOutline} onPress={addSeedTag} testID="add-seed-tag-button">
                <ThemedText type="small">追加</ThemedText>
              </Pressable>
            </ThemedView>

            <ThemedView style={styles.row}>
              <Pressable style={styles.newButton} onPress={createProject} testID="create-project-button">
                <ThemedText style={styles.newButtonText}>作成</ThemedText>
              </Pressable>
              <Pressable style={styles.smallButtonOutline} onPress={() => setCreating(false)}>
                <ThemedText type="small">キャンセル</ThemedText>
              </Pressable>
            </ThemedView>
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
  form: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  input: {
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
  newButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  newButtonText: { color: '#fff', fontWeight: '600' },
  smallButtonOutline: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    alignSelf: 'flex-start',
  },
});
