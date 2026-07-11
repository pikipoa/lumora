/**
 * Arca（confirmed マーカーの集積地）。2026-07-11、色フォルダ構造に再設計した
 * （docs/DESIGN.md準拠、レビュー承認済み）。
 *
 * - 一次分類軸は「色」：マーカーは必ず色を持つため、タグ付け（Wing）やRealm割当より
 *   手前の、本にマーカーを引いた瞬間の感覚に最も近い分類軸として採用した
 * - 色フォルダ一覧（`colorFilter === null`）はタイポグラフィと色ドットのみ。カード・
 *   絵文字・説明文は置かない（DESIGN.md「Remove Before Add」「Typography First」）
 * - フォルダの中（`colorFilter`が選ばれた状態）でRealm/Tagの絞り込みチップを表示する
 *   （承認済み：色の中でさらにRealm/Tagで絞れる方が実用的なため残した）
 * - Realm詳細（S4）から`projectId`付きで遷移してきた場合も色フォルダ一覧を経由させる。
 *   フォルダの件数はその時点のRealmフィルタでスコープされる
 * - 「整理する」：人間が確定させた（confirmed）が未タグのマーカー群だけを対象に、
 *   Edge Function `organize-markers` を呼びTopic/ConceptのTagを提案する
 *   （AIは発見しない・整理するだけ、という確定方針）。色横断の操作なのでフォルダ一覧側に置く
 *
 * 【Tag/Wingの役割分離（2026-07-11）】TagはAIが検索・分類のために使う内部メタデータ、
 * Wingは人間が読むための「本の目次・章立て」として役割を分離した。上記のタグ絞り込み
 * チップ（旧実装では「Wingフィルタ」と呼んでいたが実体はタグ名フィルタ）は`tagFilter`と
 * 改名し、Tagであることを明確にした。本物のWingはRealm詳細（`projects/[id].tsx`）が
 * 本物の`themes`＋`marker_wings`で扱う。Arcaでは、Realm割当済みのマーカーに対して
 * 「Wingに追加」チップピッカーを設け、そのRealmのWingへ手動で参照リンクできるようにする
 * （Wingは複数所属可・Marker本文は複製しない。詳細：
 * C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-11 Tag/Wingの役割分離」）
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

const MARKER_COLOR_ORDER = ['pink', 'green', 'yellow', 'blue', 'red'] as const;
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

interface WingRef {
  id: string;
  name: string;
  icon: string | null;
}

interface MarkerWingRow {
  id: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  themes: WingRef;
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
  marker_wings: MarkerWingRow[];
}

interface ProjectOption {
  id: string;
  name: string;
}

export default function HighlightsScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { projectId: initialProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const [rows, setRows] = useState<HighlightRow[] | null>(null);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [wings, setWings] = useState<(WingRef & { project_id: string })[]>([]);
  const [projectFilter, setProjectFilter] = useState<'all' | 'unassigned' | string>(initialProjectId ?? 'all');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [colorFilter, setColorFilter] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [wingPickerId, setWingPickerId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeNote, setOrganizeNote] = useState<string | null>(null);

  const load = async () => {
    const [{ data: mk }, { data: proj }, { data: wingRows }] = await Promise.all([
      supabase
        .from('markers')
        .select(
          'id, quoted_text, color, role_tag, conversation_id, project_id, conversations(title), marker_tags(id, status, tags(id, name, tag_type)), marker_wings(id, status, themes(id, name, icon))',
        )
        .eq('status', 'confirmed')
        .order('created_at', { ascending: false }),
      supabase.from('projects').select('id, name').order('created_at', { ascending: false }),
      supabase.from('themes').select('id, name, icon, project_id'),
    ]);
    setRows((mk as unknown as HighlightRow[]) ?? []);
    setProjects(proj ?? []);
    setWings((wingRows as unknown as (WingRef & { project_id: string })[]) ?? []);
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

  const colorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of byProject) {
      if (!r.color) continue;
      counts.set(r.color, (counts.get(r.color) ?? 0) + 1);
    }
    return counts;
  }, [byProject]);

  const byColor = useMemo(() => {
    if (!colorFilter) return [];
    return byProject.filter((r) => r.color === colorFilter);
  }, [byProject, colorFilter]);

  const tagOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of byColor) {
      for (const mt of r.marker_tags) {
        if (mt.status === 'rejected') continue;
        counts.set(mt.tags.name, (counts.get(mt.tags.name) ?? 0) + 1);
      }
    }
    return [...counts.entries()];
  }, [byColor]);

  const visible = useMemo(() => {
    if (!tagFilter) return byColor;
    return byColor.filter((r) => r.marker_tags.some((mt) => mt.status !== 'rejected' && mt.tags.name === tagFilter));
  }, [byColor, tagFilter]);

  const untaggedInView = byProject.filter((r) => r.marker_tags.length === 0);

  function openColor(color: string) {
    setColorFilter(color);
    setTagFilter(null);
  }

  function backToFolders() {
    setColorFilter(null);
    setTagFilter(null);
  }

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

  async function assignToWing(markerId: string, wingId: string) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    await supabase
      .from('marker_wings')
      .insert({ user_id: userId, marker_id: markerId, wing_id: wingId, status: 'confirmed', proposed_by: 'human', confirmed_at: new Date().toISOString() });
    setWingPickerId(null);
    load();
  }

  async function removeFromWing(markerWingId: string) {
    await supabase.from('marker_wings').update({ status: 'rejected' }).eq('id', markerWingId);
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
        {colorFilter === null ? (
          <>
            <ThemedText type="subtitle">Arca</ThemedText>

            {rows === null ? (
              <ActivityIndicator style={{ marginTop: Spacing.five }} />
            ) : colorCounts.size === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                まだマーカーがありません。
              </ThemedText>
            ) : (
              <ThemedView style={styles.folderGrid}>
                {MARKER_COLOR_ORDER.filter((c) => (colorCounts.get(c) ?? 0) > 0).map((c) => (
                  <Pressable key={c} style={styles.folder} onPress={() => openColor(c)} testID={`color-folder-${c}`}>
                    <ThemedView style={[styles.folderDot, { backgroundColor: MARKER_COLORS[c] }]} />
                    <ThemedText style={styles.folderCount}>{colorCounts.get(c)}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>
            )}

            {untaggedInView.length > 0 && (
              <ThemedView style={styles.row}>
                <ThemedText type="small" themeColor="textSecondary">
                  未タグが{untaggedInView.length}件
                </ThemedText>
                <Pressable onPress={organizeUntagged} disabled={organizing} testID="organize-untagged-button">
                  {organizing ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <ThemedText type="linkPrimary">整理する</ThemedText>
                  )}
                </Pressable>
                {organizeNote && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {organizeNote}
                  </ThemedText>
                )}
              </ThemedView>
            )}
          </>
        ) : (
          <>
            <Pressable onPress={backToFolders} testID="back-to-folders">
              <ThemedText type="link">← Arca</ThemedText>
            </Pressable>

            <ThemedView style={styles.row}>
              <ThemedView style={[styles.folderDotSmall, { backgroundColor: MARKER_COLORS[colorFilter] }]} />
              <ThemedText type="subtitle">{byColor.length}件</ThemedText>
            </ThemedView>

            {/* Realmフィルタ */}
            <ThemedView style={styles.tagWrap}>
              <Pressable
                style={[styles.chip, projectFilter === 'all' && styles.chipActive]}
                onPress={() => setProjectFilter('all')}
                testID="filter-project-all"
              >
                <ThemedText type="small">すべて</ThemedText>
              </Pressable>
              <Pressable
                style={[styles.chip, projectFilter === 'unassigned' && styles.chipActive]}
                onPress={() => setProjectFilter('unassigned')}
                testID="filter-project-unassigned"
              >
                <ThemedText type="small">未割当</ThemedText>
              </Pressable>
              {projects.map((p) => (
                <Pressable
                  key={p.id}
                  style={[styles.chip, projectFilter === p.id && styles.chipActive]}
                  onPress={() => setProjectFilter(p.id)}
                  testID={`filter-project-${p.id}`}
                >
                  <ThemedText type="small">{p.name}</ThemedText>
                </Pressable>
              ))}
            </ThemedView>

            {/* Tagフィルタ（選択中Realm×色内のタグによる絞り込み） */}
            {tagOptions.length > 0 && (
              <ThemedView style={styles.tagWrap}>
                {tagOptions.map(([name, count]) => (
                  <Pressable
                    key={name}
                    style={[styles.chip, tagFilter === name && styles.chipActive]}
                    onPress={() => setTagFilter(tagFilter === name ? null : name)}
                    testID={`filter-tag-${name}`}
                  >
                    <ThemedText type="small">
                      {name} ({count})
                    </ThemedText>
                  </Pressable>
                ))}
              </ThemedView>
            )}

            {visible.length === 0 ? (
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
                    <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                      {r.conversations?.title ?? ''}
                    </ThemedText>
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

                  {r.project_id && (
                    <ThemedView style={styles.tagWrap}>
                      {r.marker_wings
                        .filter((mw) => mw.status === 'confirmed')
                        .map((mw) => (
                          <ThemedView key={mw.id} style={styles.tagChip}>
                            <ThemedText type="small">
                              {mw.themes.icon ?? '📖'} {mw.themes.name}
                            </ThemedText>
                            <Pressable onPress={() => removeFromWing(mw.id)} testID={`wing-remove-${mw.id}`}>
                              <ThemedText type="small">✕</ThemedText>
                            </Pressable>
                          </ThemedView>
                        ))}
                      <Pressable
                        style={styles.smallButtonOutline}
                        onPress={() => setWingPickerId(wingPickerId === r.id ? null : r.id)}
                        testID={`wing-picker-toggle-${r.id}`}
                      >
                        <ThemedText type="small">＋ Wing</ThemedText>
                      </Pressable>
                    </ThemedView>
                  )}
                  {wingPickerId === r.id && (
                    <ThemedView style={styles.tagWrap}>
                      {wings
                        .filter((w) => w.project_id === r.project_id)
                        .filter((w) => !r.marker_wings.some((mw) => mw.status !== 'rejected' && mw.themes.id === w.id))
                        .map((w) => (
                          <Pressable key={w.id} style={styles.chip} onPress={() => assignToWing(r.id, w.id)} testID={`assign-wing-${w.id}`}>
                            <ThemedText type="small">
                              {w.icon ?? '📖'} {w.name}
                            </ThemedText>
                          </Pressable>
                        ))}
                      {wings.filter((w) => w.project_id === r.project_id).length === 0 && (
                        <ThemedText type="small" themeColor="textSecondary">
                          このRealmにWingがまだありません
                        </ThemedText>
                      )}
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
          </>
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
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', flexWrap: 'wrap' },
  folderGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.five },
  folder: { alignItems: 'center', gap: Spacing.two },
  folderDot: { width: 56, height: 56, borderRadius: 28 },
  folderDotSmall: { width: 20, height: 20, borderRadius: 10 },
  folderCount: { fontSize: 22, fontWeight: '600' },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two, backgroundColor: '#F0F0F3' },
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
  smallButtonOutline: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
});
