/**
 * S4 プロジェクト詳細（Realm）。マーカー中心アーキテクチャへの転換（2026-07-11）に伴い、
 * Theme一覧＋会話数の表示から、Wing（MarkerTagカテゴリ）ごとのマーカー数の表示へ作り替えた。
 * Wingは新テーブルを追加せず、このRealmに属するマーカーのタグそのものとして実現する
 * （タップでArca画面へRealm/Wingを引き継いで遷移）。
 * 詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

interface WingRow {
  name: string;
  count: number;
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [projectName, setProjectName] = useState<string | null>(null);
  const [markerCount, setMarkerCount] = useState(0);
  const [wings, setWings] = useState<WingRow[] | null>(null);
  const [unassignedConversationCount, setUnassignedConversationCount] = useState(0);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: project }, { data: markers }, { data: conversations }] = await Promise.all([
      supabase.from('projects').select('name').eq('id', id).single(),
      supabase
        .from('markers')
        .select('id, marker_tags(status, tags(name))')
        .eq('project_id', id)
        .eq('status', 'confirmed'),
      supabase.from('conversations').select('id').eq('project_id', id).is('theme_id', null),
    ]);

    setProjectName(project?.name ?? null);
    setMarkerCount(markers?.length ?? 0);
    setUnassignedConversationCount(conversations?.length ?? 0);

    const counts = new Map<string, number>();
    for (const m of markers ?? []) {
      const markerTags = (m as unknown as { marker_tags: { status: string; tags: { name: string } }[] }).marker_tags;
      for (const mt of markerTags ?? []) {
        if (mt.status === 'rejected') continue;
        counts.set(mt.tags.name, (counts.get(mt.tags.name) ?? 0) + 1);
      }
    }
    setWings([...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (wings === null) {
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
          <ThemedText type="link">← Realm</ThemedText>
        </Pressable>

        <ThemedText type="subtitle">{projectName ?? ''}</ThemedText>

        <Pressable
          style={styles.row}
          onPress={() => router.push({ pathname: '/highlights', params: { projectId: id } })}
          testID="all-markers-card"
        >
          <ThemedText style={styles.count}>{markerCount}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            すべてのマーカー
          </ThemedText>
        </Pressable>

        {wings.length > 0 && (
          <ThemedView style={styles.wingList}>
            {wings.map((w) => (
              <Pressable
                key={w.name}
                style={styles.wingRow}
                onPress={() => router.push({ pathname: '/highlights', params: { projectId: id, wing: w.name } })}
                testID={`wing-${w.name}`}
              >
                <ThemedText>{w.name}</ThemedText>
                <ThemedText themeColor="textSecondary">{w.count}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        {markerCount === 0 && (
          <ThemedText type="small" themeColor="textSecondary">
            まだこのRealmにマーカーがありません。横断検索から会話を見つけて本文を選択し、マーカーを作成してからここに割り当ててください。
          </ThemedText>
        )}

        <Pressable onPress={() => router.push({ pathname: '/inbox', params: { projectId: id } })} testID="unassigned-conversations-card">
          <ThemedText type="small" themeColor="textSecondary">
            割り当て済みの会話：{unassignedConversationCount}件
          </ThemedText>
        </Pressable>
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
    gap: Spacing.four,
  },
  row: { gap: Spacing.half },
  count: { fontSize: 40, lineHeight: 46, fontWeight: '600' },
  wingList: { gap: Spacing.three },
  wingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
});
