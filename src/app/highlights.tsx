/**
 * Arca（confirmed マーカーの集積地）。旧S9「重要部分だけ表示」を、マーカー中心アーキテクチャの
 * 中核画面として拡張した（2026-07-11）。詳細経緯：
 * C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-11 マーカー中心アーキテクチャへの転換」
 *
 * - Realm（Project）フィルタ：マーカーを直接Realmへ割り当てる（markers.project_id）
 * - Wing（Theme相当）はMarkerTagで代替：新テーブルは追加せず、選択中Realm内のマーカーが持つ
 *   タグでの絞り込み表示としてWingを実現する
 * - 「AIでタグを整理」：人間が確定させた（confirmed）が未タグのマーカー群だけを対象に、
 *   Edge Function `organize-markers` を呼びTopic/ConceptのMarkerTagを提案する
 *   （AIは発見しない・整理するだけ、という確定方針）
 */

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { organizeMarkers } from '@/lib/aiService';
import { useAuth } from '@/lib/auth-context';
import { notifyReviewPending } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

const MARKER_COLORS: Record<string, string> = {
  pink: '#FF4FA3',
  green: '#3DDC84',
  yellow: '#FFD23D',
  blue: '#3D9CFF',
  red: '#FF4D4D',
};

const ROLE_LABEL: Record<string, string> = {
  idea: '💡 idea',
  hypothesis: '🔭 hypothesis',
  decision: '📌 decision',
  strategy: '⚔️ strategy',
  learning: '📚 learning',
};

const TAG_TYPE_LABEL: Record<string, string> = { topic: 'Topic', concept: 'Concept' };

interface TagRef {
  id: string;
  name: string;
  tag_type: 'topic' | 'concept';
}

interface MarkerTagRow {
  id: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  tags: TagRef;
}

interface HighlightRow {
  id: string;
  quoted_text: string;
  color: string | null;
  role_tag: string | null;
  conversation_id: string;
  project_id: string | null;
  conversations: { title: string } | null;
  marker_tags: MarkerTagRow[];
}

interface ProjectOption {
  id: string;
  name: string;
}

export default function HighlightsScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { projectId: initialProjectId, wing: initialWing } = useLocalSearchParams<{
    projectId?: string;
    wing?: string;
  }>();
  const [rows, setRows] = useState<HighlightRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [projectFilter, setProjectFilter] = useState<'all' | 'unassigned' | string>(initialProjectId ?? 'all');
  const [wingFilter, setWingFilter] = useState<string | null>(initialWing ?? null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeNote, setOrganizeNote] = useState<string | null>(null);

  const load = async () => {
    const [{ data: mk }, { data: proj }] = await Promise.all([
      supabase
        .from('markers')
        .select(
          'id, quoted_text, color, role_tag, conversation_id, project_id, conversations(title), marker_tags(id, status, tags(id, name, tag_type))',
        )
        .eq('status', 'confirmed')
        .order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name').order('created_at', { ascending: false }),
    ]);
    setRows((mk as unknown as HighlightRow[]) ?? []);
    setProjects(proj ?? []);
  };

  useEffect(() => {
    if (session) load();
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loading && !session) return <Redirect href="/login" />;

  const byProject = useMemo(() => {
    if (!rows) return [];
    if (projectFilter === 'all') return rows;
    if (projectFilter === 'unassigned') return rows.filter((r) => !r.project_id);
    return rows.filter((r) => r.project_id === projectFilter);
  }, [rows, projectFilter]);

  const wingOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of byProject) {
      for (const mt of r.marker_tags) {
        if (mt.status === 'rejected') continue;
        counts.set(mt.tags.name, (counts.get(mt.tags.name) ?? 0) + 1);
      }
    }
    return [...counts.entries()];
  }, [byProject]);

  const visible = useMemo(() => {
    if (!wingFilter) return byProject;
    return byProject.filter((r) => r.marker_tags.some((mt) => mt.status !== 'rejected' && mt.tags.name === wingFilter));
  }, [byProject, wingFilter]);

  const untaggedInView = byProject.filter((r) => r.marker_tags.length === 0);

  async function assignToProject(markerId: string, projectId: string) {
    await supabase.from('markers').update({ project_id: projectId }).eq('id', markerId);
    setAssigningId(null);
    load();
  }

  async function setMarkerTagStatus(mtId: string, status: 'confirmed' | 'rejected') {
    await supabase
      .from('marker_tags')
      .update({ status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null })
      .eq('id', mtId);
    load();
  }

  async function organizeUntagged() {
    if (untaggedInView.length === 0) return;
    setOrganizing(true);
    setOrganizeNote(null);
    const ids = untaggedInView.slice(0, 50).map((r) => r.id);
    const result = await organizeMarkers(ids);
    setOrganizing(false);
    if (result.ok) {
      const note = `${result.markers_processed ?? 0}件のマーカーにタグを${result.tags_proposed ?? 0}件提案（Ore）`;
      setOrganizeNote(note);
      notifyReviewPending(note);
      load();
    } else {
      setOrganizeNote(`エラー: ${result.error ?? '不明なエラー'}`);
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">Arca</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          確定済み（Arca）マーカーの集積地。Realm・タグで絞り込み、未タグのマーカーはAIに整理してもらえます。
        </ThemedText>

        {/* Realmフィルタ */}
        <ThemedView style={styles.tagWrap}>
          <Pressable
            style={[styles.chip, projectFilter === 'all' && styles.chipActive]}
            onPress={() => {
              setProjectFilter('all');
              setWingFilter(null);
            }}
            testID="filter-project-all"
          >
            <ThemedText type="small">すべて</ThemedText>
          </Pressable>
          <Pressable
            style={[styles.chip, projectFilter === 'unassigned' && styles.chipActive]}
            onPress={() => {
              setProjectFilter('unassigned');
              setWingFilter(null);
            }}
            testID="filter-project-unassigned"
          >
            <ThemedText type="small">未割当</ThemedText>
          </Pressable>
          {projects.map((p) => (
            <Pressable
              key={p.id}
              style={[styles.chip, projectFilter === p.id && styles.chipActive]}
              onPress={() => {
                setProjectFilter(p.id);
                setWingFilter(null);
              }}
              testID={`filter-project-${p.id}`}
            >
              <ThemedText type="small">{p.name}</ThemedText>
            </Pressable>
          ))}
        </ThemedView>

        {/* Wingフィルタ（選択中Realm内のタグによる絞り込み） */}
        {wingOptions.length > 0 && (
          <ThemedView style={styles.tagWrap}>
            {wingOptions.map(([name, count]) => (
              <Pressable
                key={name}
                style={[styles.chip, wingFilter === name && styles.chipActive]}
                onPress={() => setWingFilter(wingFilter === name ? null : name)}
                testID={`filter-wing-${name}`}
              >
                <ThemedText type="small">
                  {name} ({count})
                </ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        {untaggedInView.length > 0 && (
          <ThemedView type="backgroundElement" style={styles.organizeBar}>
            <ThemedText type="small">未タグのマーカーが{untaggedInView.length}件あります</ThemedText>
            <Pressable
              style={[styles.smallButton, organizing && styles.buttonDisabled]}
              disabled={organizing}
              onPress={organizeUntagged}
              testID="organize-untagged-button"
            >
              {organizing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <ThemedText style={styles.smallButtonText}>🤖 AIでタグを整理</ThemedText>
              )}
            </Pressable>
            {organizeNote && <ThemedText type="small">{organizeNote}</ThemedText>}
          </ThemedView>
        )}

        {rows === null ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} />
        ) : visible.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            条件に一致するマーカーがありません。
          </ThemedText>
        ) : (
          visible.map((r) => (
            <ThemedView key={r.id} style={styles.card}>
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/conversation/[id]', params: { id: r.conversation_id, markerId: r.id } })
                }
                testID={`highlight-${r.id}`}
              >
                <ThemedView style={styles.row}>
                  <ThemedView style={[styles.swatch, { backgroundColor: MARKER_COLORS[r.color ?? ''] ?? '#999' }]} />
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1} style={{ flex: 1 }}>
                    {r.conversations?.title ?? ''}
                  </ThemedText>
                </ThemedView>
                <ThemedText numberOfLines={3}>{r.quoted_text}</ThemedText>
                {r.role_tag && <ThemedText type="small">{ROLE_LABEL[r.role_tag] ?? r.role_tag}</ThemedText>}
              </Pressable>

              {r.marker_tags.length > 0 && (
                <ThemedView style={styles.tagWrap}>
                  {r.marker_tags
                    .filter((mt) => mt.status !== 'rejected')
                    .map((mt) => (
                      <ThemedView
                        key={mt.id}
                        style={[styles.tagChip, mt.status === 'proposed' ? styles.chipProposed : styles.chipConfirmed]}
                      >
                        <ThemedText type="small">
                          {TAG_TYPE_LABEL[mt.tags.tag_type]}: {mt.tags.name}
                        </ThemedText>
                        {mt.status === 'proposed' ? (
                          <ThemedView style={styles.row}>
                            <Pressable onPress={() => setMarkerTagStatus(mt.id, 'confirmed')} testID={`markertag-approve-${mt.id}`}>
                              <ThemedText type="small">✓</ThemedText>
                            </Pressable>
                            <Pressable onPress={() => setMarkerTagStatus(mt.id, 'rejected')} testID={`markertag-reject-${mt.id}`}>
                              <ThemedText type="small">✕</ThemedText>
                            </Pressable>
                          </ThemedView>
                        ) : (
                          <Pressable onPress={() => setMarkerTagStatus(mt.id, 'rejected')} testID={`markertag-unconfirm-${mt.id}`}>
                            <ThemedText type="small">✕</ThemedText>
                          </Pressable>
                        )}
                      </ThemedView>
                    ))}
                </ThemedView>
              )}

              {!r.project_id && (
                <ThemedView style={styles.row}>
                  <Pressable
                    style={styles.smallButtonOutline}
                    onPress={() => setAssigningId(assigningId === r.id ? null : r.id)}
                    testID={`assign-marker-${r.id}`}
                  >
                    <ThemedText type="small">Realmに割り当てる</ThemedText>
                  </Pressable>
                </ThemedView>
              )}
              {assigningId === r.id && (
                <ThemedView style={styles.tagWrap}>
                  {projects.map((p) => (
                    <Pressable
                      key={p.id}
                      style={styles.chip}
                      onPress={() => assignToProject(r.id, p.id)}
                      testID={`assign-marker-to-${p.id}`}
                    >
                      <ThemedText type="small">{p.name}</ThemedText>
                    </Pressable>
                  ))}
                  {projects.length === 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      Realmがまだありません
                    </ThemedText>
                  )}
                </ThemedView>
              )}
            </ThemedView>
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
    gap: Spacing.three,
  },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', flexWrap: 'wrap' },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two, backgroundColor: '#F0F0F3' },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  chipActive: { borderColor: '#208AEF', backgroundColor: '#208AEF22' },
  tagChip: {
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
  organizeBar: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  smallButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  smallButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  smallButtonOutline: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  buttonDisabled: { opacity: 0.5 },
});
