/**
 * Chronicle（文脈ライブラリ）。「マーカーを含む会話」だけを集めた、人間が過去を読み返すための層
 * （5オブジェクト定義：docs/data-model.md「0. 設計思想」）。
 * 最新マーカー日時の降順＝最近文脈を書き足した会話が上に来る。
 *
 * 【表示改善（2026-07-12、ピキさんUXフィードバック）】
 * - 各行の主役は「引いたマーカーの文」（＝この会話がChronicleにいる理由そのもの）。
 *   会話タイトル（Geminiでは最初のユーザー発言と同じで分かりにくかった）はメタ情報の1行に降格
 * - 整理待ちセクションには、S6へ遷移しなくてもその場で仕分けられるRealmチップを付けた
 *   （「整理待ちといいながら仕分ける機能がない」への対応）。割当と同時に行が消える
 */

import { Redirect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

interface MarkerRow {
  conversation_id: string;
  created_at: string;
  quoted_text: string;
  edited_text: string | null;
  conversations: { id: string; title: string; source: string; created_at: string | null; imported_at: string } | null;
}

interface ChronicleRow {
  conversationId: string;
  title: string;
  source: string;
  conversationDate: string;
  markerCount: number;
  lastMarkerAt: string;
  latestMarkerText: string;
}

interface UnassignedMarker {
  id: string;
  conversationId: string;
  text: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

export default function ChroniclesScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<ChronicleRow[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedMarker[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  const load = useCallback(async () => {
    const [{ data }, { data: unassignedRows }, { data: proj }] = await Promise.all([
      supabase
        .from('markers')
        .select('conversation_id, created_at, quoted_text, edited_text, conversations(id, title, source, created_at, imported_at)')
        .eq('status', 'confirmed'),
      supabase
        .from('markers')
        .select('id, conversation_id, quoted_text, edited_text')
        .eq('status', 'confirmed')
        .is('project_id', null)
        .order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name').order('created_at', { ascending: false }),
    ]);

    const byConversation = new Map<string, ChronicleRow>();
    for (const row of (data as unknown as MarkerRow[]) ?? []) {
      const conv = row.conversations;
      if (!conv) continue;
      const markerText = row.edited_text ?? row.quoted_text;
      const existing = byConversation.get(conv.id);
      if (existing) {
        existing.markerCount += 1;
        if (row.created_at > existing.lastMarkerAt) {
          existing.lastMarkerAt = row.created_at;
          existing.latestMarkerText = markerText;
        }
      } else {
        byConversation.set(conv.id, {
          conversationId: conv.id,
          title: conv.title,
          source: conv.source,
          conversationDate: new Date(conv.created_at ?? conv.imported_at).toLocaleDateString('ja-JP'),
          markerCount: 1,
          lastMarkerAt: row.created_at,
          latestMarkerText: markerText,
        });
      }
    }

    setRows([...byConversation.values()].sort((a, b) => (a.lastMarkerAt < b.lastMarkerAt ? 1 : -1)));
    setUnassigned(
      (unassignedRows ?? []).map((m) => ({
        id: m.id,
        conversationId: m.conversation_id,
        text: (m.edited_text as string | null) ?? m.quoted_text,
      })),
    );
    setProjects(proj ?? []);
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  // 整理待ちからその場でRealmへ仕分ける（S6へ遷移せずに完結できる）
  async function assignToRealm(markerId: string, projectId: string) {
    await supabase.from('markers').update({ project_id: projectId }).eq('id', markerId);
    load();
  }

  if (!loading && !session) return <Redirect href="/login" />;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <ThemedText type="subtitle">{t.chronicle.title}</ThemedText>

        {/* Realm未割当マーカーの一時セクション。0件になると消える（v2.1） */}
        {unassigned.length > 0 && (
          <ThemedView style={styles.pendingSection} testID="unassigned-section">
            <ThemedText type="small" themeColor="textSecondary">
              {t.chronicle.pendingHeading(unassigned.length)}
            </ThemedText>
            {unassigned.map((m) => (
              <ThemedView key={m.id} style={styles.pendingRow}>
                <Pressable
                  onPress={() =>
                    router.push({ pathname: '/conversation/[id]', params: { id: m.conversationId, markerId: m.id } })
                  }
                  testID={`unassigned-${m.id}`}
                >
                  <ThemedText numberOfLines={1}>{m.text}</ThemedText>
                </Pressable>
                {projects.length > 0 && (
                  <ThemedView style={styles.chipRow}>
                    {projects.map((p) => (
                      <Pressable
                        key={p.id}
                        style={styles.chip}
                        onPress={() => assignToRealm(m.id, p.id)}
                        testID={`unassigned-assign-${m.id}-${p.id}`}
                      >
                        <ThemedText type="small">{p.name}</ThemedText>
                      </Pressable>
                    ))}
                  </ThemedView>
                )}
              </ThemedView>
            ))}
          </ThemedView>
        )}

        {rows === null ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} />
        ) : rows.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            {t.chronicle.empty}
          </ThemedText>
        ) : (
          rows.map((r) => (
            <Pressable
              key={r.conversationId}
              style={styles.row}
              onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: r.conversationId } })}
              testID={`chronicle-${r.conversationId}`}
            >
              <ThemedText type="small" themeColor="textSecondary">
                {r.conversationDate} ・ {t.sources[r.source] ?? r.source}
                {r.markerCount > 1 ? t.chronicle.markerCount(r.markerCount) : ''}
              </ThemedText>
              <ThemedText numberOfLines={2}>{r.latestMarkerText}</ThemedText>
            </Pressable>
          ))
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
    gap: Spacing.four,
  },
  row: { gap: Spacing.half },
  pendingSection: { gap: Spacing.three, paddingBottom: Spacing.two },
  pendingRow: { gap: Spacing.one },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
