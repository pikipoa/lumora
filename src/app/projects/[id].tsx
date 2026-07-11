/**
 * S4 プロジェクト詳細（Realm）。Tag/Wingの役割分離（2026-07-11）に伴い、Pivot-4の
 * 「WingはMarkerTag名を借用した疑似実装」から、本物の`themes`（Wing）＋`marker_wings`
 * （多対多）ベースの実装へ作り替えた。詳細経緯：
 * C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-11 Tag/Wingの役割分離」
 *
 * - RealmはTagを一切見せない（表示はWingのname/icon/件数のみ。生のTag名はArca側で扱う）
 * - Wingは複数のMarkerを束ねるリンクであり、Marker本文は複製しない。1つのMarkerが
 *   複数のWingに所属できるため、Wing詳細の各マーカーには「他のWing」も添えて表示する
 * - Knowledge Organize：①未タグのMarkerにタグを付け（organizeMarkers）→②タグ済みで
 *   Wing未設定のMarkerをWingへ編成する（organizeWings）、の2段階を順に実行する
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { organizeMarkers, organizeWings } from '@/lib/aiService';
import { supabase } from '@/lib/supabase';

const ICON_PRESETS = ['⚔️', '🎨', '🏗️', '📖', '📣', '🗄️', '💡', '🔬', '💰', '🌱'];

interface WingOption {
  id: string;
  name: string;
  icon: string | null;
}

interface MarkerWingJoin {
  id: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  themes: WingOption | null;
}

interface MarkerRow {
  id: string;
  quoted_text: string;
  conversations: { title: string } | null;
  marker_tags: { status: string }[];
  marker_wings: MarkerWingJoin[];
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [projectName, setProjectName] = useState<string | null>(null);
  const [markers, setMarkers] = useState<MarkerRow[] | null>(null);
  const [wingOptions, setWingOptions] = useState<WingOption[]>([]);
  const [unassignedConversationCount, setUnassignedConversationCount] = useState(0);
  const [selectedWingId, setSelectedWingId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeNote, setOrganizeNote] = useState<string | null>(null);
  const [creatingWing, setCreatingWing] = useState(false);
  const [newWingName, setNewWingName] = useState('');
  const [newWingIcon, setNewWingIcon] = useState(ICON_PRESETS[0]);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: project }, { data: mk }, { data: wings }, { data: conversations }] = await Promise.all([
      supabase.from('projects').select('name').eq('id', id).single(),
      supabase
        .from('markers')
        .select(
          'id, quoted_text, conversations(title), marker_tags(status), marker_wings(id, status, themes(id, name, icon))',
        )
        .eq('project_id', id)
        .eq('status', 'confirmed'),
      supabase.from('themes').select('id, name, icon').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('conversations').select('id').eq('project_id', id),
    ]);

    setProjectName(project?.name ?? null);
    setMarkers((mk as unknown as MarkerRow[]) ?? []);
    setWingOptions(wings ?? []);
    setUnassignedConversationCount(conversations?.length ?? 0);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const wingCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of markers ?? []) {
      for (const mw of m.marker_wings) {
        if (mw.status !== 'confirmed' || !mw.themes) continue;
        counts.set(mw.themes.id, (counts.get(mw.themes.id) ?? 0) + 1);
      }
    }
    return counts;
  }, [markers]);

  const pendingWingCount = useMemo(
    () => (markers ?? []).reduce((sum, m) => sum + m.marker_wings.filter((mw) => mw.status === 'proposed').length, 0),
    [markers],
  );

  const untaggedMarkerIds = useMemo(
    () => (markers ?? []).filter((m) => m.marker_tags.every((t) => t.status === 'rejected')).map((m) => m.id),
    [markers],
  );

  const taggedNoWingCount = useMemo(
    () =>
      (markers ?? []).filter(
        (m) => m.marker_tags.some((t) => t.status !== 'rejected') && m.marker_wings.length === 0,
      ).length,
    [markers],
  );

  const wingMarkers = useMemo(() => {
    if (!selectedWingId) return [];
    return (markers ?? [])
      .map((m) => ({
        marker: m,
        mine: m.marker_wings.find((mw) => mw.themes?.id === selectedWingId),
        others: m.marker_wings.filter((mw) => mw.themes && mw.themes.id !== selectedWingId && mw.status !== 'rejected'),
      }))
      .filter((r) => r.mine && r.mine.status !== 'rejected');
  }, [markers, selectedWingId]);

  const selectedWing = wingOptions.find((w) => w.id === selectedWingId) ?? null;

  async function runKnowledgeOrganize() {
    if (!id) return;
    setOrganizing(true);
    setOrganizeNote(null);
    if (untaggedMarkerIds.length > 0) {
      await organizeMarkers(untaggedMarkerIds.slice(0, 50));
    }
    const result = await organizeWings(id);
    setOrganizing(false);
    if (result.ok) {
      setOrganizeNote(`Wingを${result.wings_proposed ?? 0}件提案しました`);
      load();
    } else {
      setOrganizeNote(`エラー: ${result.error ?? '不明なエラー'}`);
    }
  }

  async function setWingStatus(markerWingId: string, status: 'confirmed' | 'rejected') {
    await supabase
      .from('marker_wings')
      .update({ status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null })
      .eq('id', markerWingId);
    load();
  }

  async function createWing() {
    const name = newWingName.trim();
    if (!name || !id) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    await supabase.from('themes').insert({ user_id: userId, project_id: id, name, icon: newWingIcon });
    setNewWingName('');
    setCreatingWing(false);
    load();
  }

  if (markers === null) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {selectedWingId === null ? (
          <>
            <Pressable onPress={() => router.back()} testID="back-button">
              <ThemedText type="link">← Realm</ThemedText>
            </Pressable>

            <ThemedText type="subtitle">{projectName ?? ''}</ThemedText>

            <Pressable
              style={styles.row}
              onPress={() => router.push({ pathname: '/highlights', params: { projectId: id } })}
              testID="all-markers-card"
            >
              <ThemedText style={styles.count}>{markers.length}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                すべてのマーカー
              </ThemedText>
            </Pressable>

            {(untaggedMarkerIds.length > 0 || taggedNoWingCount > 0) && (
              <ThemedView style={styles.row}>
                <ThemedText type="smallBold">Knowledge Organize</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  AIが知識を整理しています
                </ThemedText>
                <Pressable onPress={runKnowledgeOrganize} disabled={organizing} testID="knowledge-organize-button">
                  {organizing ? <ActivityIndicator size="small" /> : <ThemedText type="linkPrimary">実行する</ThemedText>}
                </Pressable>
                {organizeNote && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {organizeNote}
                  </ThemedText>
                )}
              </ThemedView>
            )}

            {pendingWingCount > 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                Wingの提案が{pendingWingCount}件、確認待ちです
              </ThemedText>
            )}

            {wingOptions.length > 0 && (
              <ThemedView style={styles.wingList}>
                {wingOptions
                  .slice()
                  .sort((a, b) => (wingCounts.get(b.id) ?? 0) - (wingCounts.get(a.id) ?? 0))
                  .map((w) => (
                    <Pressable
                      key={w.id}
                      style={styles.wingRow}
                      onPress={() => setSelectedWingId(w.id)}
                      testID={`wing-${w.id}`}
                    >
                      <ThemedText>
                        {w.icon ?? '📖'} {w.name}
                      </ThemedText>
                      <ThemedText themeColor="textSecondary">{wingCounts.get(w.id) ?? 0}</ThemedText>
                    </Pressable>
                  ))}
              </ThemedView>
            )}

            {!creatingWing ? (
              <Pressable onPress={() => setCreatingWing(true)} testID="new-wing-button">
                <ThemedText type="linkPrimary">＋ 新しいWing</ThemedText>
              </Pressable>
            ) : (
              <ThemedView style={styles.newWingForm}>
                <TextInput
                  style={styles.tagInput}
                  placeholder="Wing名"
                  value={newWingName}
                  onChangeText={setNewWingName}
                  onSubmitEditing={createWing}
                  testID="new-wing-name-input"
                />
                <ThemedView style={styles.tagWrap}>
                  {ICON_PRESETS.map((icon) => (
                    <Pressable
                      key={icon}
                      style={[styles.iconChoice, newWingIcon === icon && styles.iconChoiceActive]}
                      onPress={() => setNewWingIcon(icon)}
                      testID={`new-wing-icon-${icon}`}
                    >
                      <ThemedText>{icon}</ThemedText>
                    </Pressable>
                  ))}
                </ThemedView>
                <ThemedView style={styles.row}>
                  <Pressable onPress={createWing} testID="create-wing-button">
                    <ThemedText type="linkPrimary">作成</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => setCreatingWing(false)}>
                    <ThemedText type="small" themeColor="textSecondary">
                      キャンセル
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              </ThemedView>
            )}

            {markers.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                まだこのRealmにマーカーがありません。横断検索から会話を見つけて本文を選択し、マーカーを作成してからここに割り当ててください。
              </ThemedText>
            )}

            <Pressable onPress={() => router.push({ pathname: '/inbox', params: { projectId: id } })} testID="unassigned-conversations-card">
              <ThemedText type="small" themeColor="textSecondary">
                割り当て済みの会話：{unassignedConversationCount}件
              </ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable onPress={() => setSelectedWingId(null)} testID="back-to-wings">
              <ThemedText type="link">← {projectName}</ThemedText>
            </Pressable>

            <ThemedText type="subtitle">
              {selectedWing?.icon ?? '📖'} {selectedWing?.name}
            </ThemedText>

            {wingMarkers.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                このWingにはまだマーカーがありません。
              </ThemedText>
            ) : (
              wingMarkers.map(({ marker, mine, others }) => (
                <ThemedView key={marker.id} style={styles.markerCard}>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {marker.conversations?.title ?? ''}
                  </ThemedText>
                  <ThemedText numberOfLines={4}>{marker.quoted_text}</ThemedText>

                  {others.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      他のWing: {others.map((o) => `${o.themes?.icon ?? '📖'} ${o.themes?.name}`).join('、')}
                    </ThemedText>
                  )}

                  {mine?.status === 'proposed' ? (
                    <ThemedView style={styles.row}>
                      <Pressable onPress={() => setWingStatus(mine.id, 'confirmed')} testID={`wing-marker-approve-${mine.id}`}>
                        <ThemedText type="small">✓ 確認</ThemedText>
                      </Pressable>
                      <Pressable onPress={() => setWingStatus(mine.id, 'rejected')} testID={`wing-marker-reject-${mine.id}`}>
                        <ThemedText type="small">✕ 却下</ThemedText>
                      </Pressable>
                    </ThemedView>
                  ) : mine ? (
                    <Pressable onPress={() => setWingStatus(mine.id, 'rejected')} testID={`wing-marker-remove-${mine.id}`}>
                      <ThemedText type="small" themeColor="textSecondary">
                        ✕ このWingから外す
                      </ThemedText>
                    </Pressable>
                  ) : null}
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
  count: { fontSize: 40, lineHeight: 46, fontWeight: '600' },
  wingList: { gap: Spacing.three },
  wingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  newWingForm: { gap: Spacing.two },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tagInput: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  iconChoice: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  iconChoiceActive: { borderColor: '#208AEF', backgroundColor: '#208AEF22' },
  markerCard: { gap: Spacing.one, paddingVertical: Spacing.two },
});
