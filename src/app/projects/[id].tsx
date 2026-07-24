/**
 * S4 プロジェクト詳細（Realm）＝知識編集の中心。
 *
 * 【v2.1 認知OSへの改訂（2026-07-12）】5オブジェクト定義（docs/data-model.md「0. 設計思想」）に
 * 基づき、Realmを「知識編集の中心」へ拡張した：
 * - AI分析（Knowledge Organize）後、Wing候補を確度付きで提示（◎=90%以上/○）。収納の決定は
 *   常にユーザー（採用／既存Wingを選択。学習型の自動収納は将来のバックログ）
 * - マーカー本文はRealm内で自由編集できる（markers.edited_text）。quoted_textはChronicle原文
 *   として不変に保ち、AIは元知識を参照し続けられる。表示は edited_text ?? quoted_text
 * - 「AI分析結果を見る」パネル：Wing＋AI Tagsを確認できる。ユーザーがやっているのはタグ編集
 *   ではなく「AIがこの知識を正しく理解できているかの確認」（タグは常時表示しない原則のまま、
 *   レビュー対象からは隠さない）
 * - RealmはTagを常時表示しない（生のTag名が出るのはAI分析結果パネルの中だけ）
 * - Wingは複数のMarkerを束ねるリンクであり、Marker本文は複製しない（多対多、他Wing参照表示）
 * 詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-12 v2.1 認知OSへの改訂」
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n';
import { organizeMarkers, organizeWings } from '@/lib/aiService';
import { supabase } from '@/lib/supabase';

const ICON_PRESETS = ['⚔️', '🎨', '🏗️', '📖', '📣', '🗄️', '💡', '🔬', '💰', '🌱'];
const TAG_TYPE_LABEL: Record<string, string> = {
  topic: t.realmDetail.tagTypeTopic,
  concept: t.realmDetail.tagTypeConcept,
};

interface WingOption {
  id: string;
  name: string;
  icon: string | null;
}

interface MarkerWingJoin {
  id: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  confidence: number | null;
  themes: WingOption | null;
}

interface MarkerTagJoin {
  id: string;
  status: 'proposed' | 'confirmed' | 'rejected';
  tags: { id: string; name: string; tag_type: 'topic' | 'concept' };
}

interface MarkerRow {
  id: string;
  quoted_text: string;
  edited_text: string | null;
  conversation_id: string;
  conversations: { title: string } | null;
  marker_tags: MarkerTagJoin[];
  marker_wings: MarkerWingJoin[];
}

function displayText(m: MarkerRow): string {
  return m.edited_text ?? m.quoted_text;
}

export default function ProjectDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [projectName, setProjectName] = useState<string | null>(null);
  const [markers, setMarkers] = useState<MarkerRow[] | null>(null);
  const [wingOptions, setWingOptions] = useState<WingOption[]>([]);
  const [selectedWingId, setSelectedWingId] = useState<string | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeNote, setOrganizeNote] = useState<string | null>(null);
  const [creatingWing, setCreatingWing] = useState(false);
  const [newWingName, setNewWingName] = useState('');
  const [newWingIcon, setNewWingIcon] = useState(ICON_PRESETS[0]);
  // 候補行の「別のWingへ…」ピッカーを開いているマーカー
  const [wingPickerMarkerId, setWingPickerMarkerId] = useState<string | null>(null);
  // 本文編集中のマーカー（Wing詳細内）
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  // 「AI分析結果を見る」パネルを開いているマーカー
  const [aiPanelMarkerId, setAiPanelMarkerId] = useState<string | null>(null);
  const [newTagName, setNewTagName] = useState('');
  const [newTagType, setNewTagType] = useState<'topic' | 'concept'>('topic');
  // リネーム中のタグ（旧marker_tagを✕→新タグを確定、の複合操作として実装）
  const [renameFromId, setRenameFromId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: project }, { data: mk }, { data: wings }] = await Promise.all([
      supabase.from('projects').select('name').eq('id', id).single(),
      supabase
        .from('markers')
        .select(
          'id, quoted_text, edited_text, conversation_id, conversations(title), marker_tags(id, status, tags(id, name, tag_type)), marker_wings(id, status, confidence, themes(id, name, icon))',
        )
        .eq('project_id', id)
        .eq('status', 'confirmed'),
      supabase.from('themes').select('id, name, icon').eq('project_id', id).order('created_at', { ascending: false }),
    ]);

    setProjectName(project?.name ?? null);
    setMarkers((mk as unknown as MarkerRow[]) ?? []);
    setWingOptions(wings ?? []);
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

  // Wing候補の確認待ち：proposedの候補があり、まだどのWingにも収納されていないマーカー
  const pendingMarkers = useMemo(
    () =>
      (markers ?? []).filter(
        (m) =>
          m.marker_wings.some((mw) => mw.status === 'proposed') &&
          !m.marker_wings.some((mw) => mw.status === 'confirmed'),
      ),
    [markers],
  );

  const untaggedMarkerIds = useMemo(
    () => (markers ?? []).filter((m) => m.marker_tags.every((t) => t.status === 'rejected')).map((m) => m.id),
    [markers],
  );

  const organizableCount = useMemo(
    () =>
      untaggedMarkerIds.length +
      (markers ?? []).filter(
        (m) => m.marker_tags.some((t) => t.status !== 'rejected') && m.marker_wings.length === 0,
      ).length,
    [markers, untaggedMarkerIds],
  );

  // 未整理：Wing候補もまだ無いマーカー（AI分析前 or 候補を全て却下した後）
  const unorganizedMarkers = useMemo(
    () => (markers ?? []).filter((m) => !m.marker_wings.some((mw) => mw.status !== 'rejected')),
    [markers],
  );

  const wingMarkers = useMemo(() => {
    if (!selectedWingId) return [];
    return (markers ?? [])
      .map((m) => ({
        marker: m,
        mine: m.marker_wings.find((mw) => mw.themes?.id === selectedWingId),
        others: m.marker_wings.filter(
          (mw) => mw.themes && mw.themes.id !== selectedWingId && mw.status === 'confirmed',
        ),
      }))
      .filter((r) => r.mine && r.mine.status === 'confirmed');
  }, [markers, selectedWingId]);

  const selectedWing = wingOptions.find((w) => w.id === selectedWingId) ?? null;

  async function runKnowledgeOrganize() {
    if (!id) return;
    setOrganizing(true);
    setOrganizeNote(null);
    if (untaggedMarkerIds.length > 0) {
      const tagResult = await organizeMarkers(untaggedMarkerIds.slice(0, 50));
      if (!tagResult.ok) {
        setOrganizing(false);
        setOrganizeNote(
          tagResult.quotaExceeded ? t.realmDetail.organizeQuotaExceeded : t.common.error(tagResult.error ?? t.common.unknownError),
        );
        return;
      }
    }
    const result = await organizeWings(id);
    setOrganizing(false);
    if (result.ok) {
      setOrganizeNote(t.realmDetail.organizeDone(result.wings_proposed ?? 0));
      load();
    } else if (result.quotaExceeded) {
      setOrganizeNote(t.realmDetail.organizeQuotaExceeded);
    } else {
      setOrganizeNote(t.common.error(result.error ?? t.common.unknownError));
    }
  }

  async function setWingStatus(markerWingId: string, status: 'confirmed' | 'rejected') {
    await supabase
      .from('marker_wings')
      .update({ status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null })
      .eq('id', markerWingId);
    load();
  }

  // 候補以外のWingへ手動で収納する（多対多。本文は複製しない）
  async function assignToWing(markerId: string, wingId: string) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    await supabase.from('marker_wings').insert({
      user_id: userId,
      marker_id: markerId,
      wing_id: wingId,
      status: 'confirmed',
      proposed_by: 'human',
      confirmed_at: new Date().toISOString(),
    });
    setWingPickerMarkerId(null);
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

  function startEditingText(m: MarkerRow) {
    setEditingTextId(m.id);
    setTextDraft(displayText(m));
  }

  // Realm内の自由編集。原文と同じ or 空なら編集なし（null）へ戻す
  async function saveEditedText(m: MarkerRow) {
    const trimmed = textDraft.trim();
    const next = trimmed === '' || trimmed === m.quoted_text ? null : trimmed;
    await supabase.from('markers').update({ edited_text: next }).eq('id', m.id);
    setEditingTextId(null);
    load();
  }

  async function setTagStatus(markerTagId: string, status: 'confirmed' | 'rejected') {
    await supabase
      .from('marker_tags')
      .update({ status, confirmed_at: status === 'confirmed' ? new Date().toISOString() : null })
      .eq('id', markerTagId);
    load();
  }

  // AI分析結果パネルからのタグ追加（リネーム時は旧タグを✕してから呼ばれる）
  async function addTagToMarker(markerId: string) {
    const name = newTagName.trim();
    if (!name) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    let { data: tag } = await supabase
      .from('tags')
      .select('id')
      .eq('name', name)
      .eq('tag_type', newTagType)
      .maybeSingle();
    if (!tag) {
      const { data: created, error } = await supabase
        .from('tags')
        .insert({ name, tag_type: newTagType, user_id: userId })
        .select('id')
        .single();
      if (error) return;
      tag = created;
    }

    if (renameFromId) {
      await supabase.from('marker_tags').update({ status: 'rejected' }).eq('id', renameFromId);
    }
    await supabase.from('marker_tags').insert({
      user_id: userId,
      marker_id: markerId,
      tag_id: tag.id,
      status: 'confirmed',
      proposed_by: 'human',
      confirmed_at: new Date().toISOString(),
    });
    setNewTagName('');
    setRenameFromId(null);
    load();
  }

  if (markers === null) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      </ThemedView>
    );
  }

  // 「AI分析結果を見る」パネル（Wing詳細のマーカーごとに開閉）
  function renderAiPanel(m: MarkerRow) {
    const confirmedWings = m.marker_wings.filter((mw) => mw.status === 'confirmed' && mw.themes);
    const proposedWings = m.marker_wings.filter((mw) => mw.status === 'proposed' && mw.themes);
    const tags = m.marker_tags.filter((mt) => mt.status !== 'rejected');
    return (
      <ThemedView style={styles.aiPanel} testID={`ai-panel-${m.id}`}>
        <ThemedText type="smallBold">{t.realmDetail.aiPanelWing}</ThemedText>
        <ThemedView style={styles.tagWrap}>
          {confirmedWings.map((mw) => (
            <ThemedText key={mw.id} type="small">
              {mw.themes!.icon ?? '📖'} {mw.themes!.name}
            </ThemedText>
          ))}
          {proposedWings.map((mw) => (
            <ThemedView key={mw.id} style={styles.tagChip}>
              <ThemedText type="small" themeColor="textSecondary">
                {mw.themes!.icon ?? '📖'} {mw.themes!.name}
                {mw.confidence != null ? ` (${mw.confidence}%)` : ''}
              </ThemedText>
              <Pressable onPress={() => setWingStatus(mw.id, 'confirmed')} testID={`ai-panel-wing-approve-${mw.id}`}>
                <ThemedText type="small">✓</ThemedText>
              </Pressable>
              <Pressable onPress={() => setWingStatus(mw.id, 'rejected')} testID={`ai-panel-wing-reject-${mw.id}`}>
                <ThemedText type="small">✕</ThemedText>
              </Pressable>
            </ThemedView>
          ))}
          {confirmedWings.length === 0 && proposedWings.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {t.realmDetail.noWingsYet}
            </ThemedText>
          )}
        </ThemedView>

        <ThemedText type="smallBold">{t.realmDetail.aiPanelTags}</ThemedText>
        <ThemedView style={styles.tagWrap}>
          {tags.map((mt) => (
            <ThemedView key={mt.id} style={[styles.tagChip, mt.status === 'proposed' && styles.tagChipProposed]}>
              <ThemedText type="small">
                {mt.status === 'proposed' ? '? ' : '✓ '}
                {mt.tags.name}
              </ThemedText>
              {mt.status === 'proposed' && (
                <Pressable onPress={() => setTagStatus(mt.id, 'confirmed')} testID={`ai-panel-tag-approve-${mt.id}`}>
                  <ThemedText type="small">✓</ThemedText>
                </Pressable>
              )}
              <Pressable onPress={() => setTagStatus(mt.id, 'rejected')} testID={`ai-panel-tag-reject-${mt.id}`}>
                <ThemedText type="small">✕</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => {
                  setRenameFromId(mt.id);
                  setNewTagName(mt.tags.name);
                  setNewTagType(mt.tags.tag_type);
                }}
                testID={`ai-panel-tag-rename-${mt.id}`}
              >
                <ThemedText type="small">✏</ThemedText>
              </Pressable>
            </ThemedView>
          ))}
          {tags.length === 0 && (
            <ThemedText type="small" themeColor="textSecondary">
              {t.realmDetail.noTagsYet}
            </ThemedText>
          )}
        </ThemedView>

        <ThemedView style={styles.row}>
          <TextInput
            style={styles.input}
            placeholder={renameFromId ? t.realmDetail.tagRenamePlaceholder : t.realmDetail.tagAddPlaceholder}
            value={newTagName}
            onChangeText={setNewTagName}
            onSubmitEditing={() => addTagToMarker(m.id)}
            testID="ai-panel-tag-input"
          />
          <Pressable
            style={styles.chip}
            onPress={() => setNewTagType(newTagType === 'topic' ? 'concept' : 'topic')}
          >
            <ThemedText type="small">{TAG_TYPE_LABEL[newTagType]}</ThemedText>
          </Pressable>
          <Pressable style={styles.chip} onPress={() => addTagToMarker(m.id)} testID="ai-panel-tag-add">
            <ThemedText type="small">{renameFromId ? t.realmDetail.tagRename : t.common.add}</ThemedText>
          </Pressable>
          {renameFromId && (
            <Pressable
              onPress={() => {
                setRenameFromId(null);
                setNewTagName('');
              }}
            >
              <ThemedText type="small" themeColor="textSecondary">
                {t.common.cancel}
              </ThemedText>
            </Pressable>
          )}
        </ThemedView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {selectedWingId === null ? (
          <>
            <HomeLink />
            <Pressable onPress={() => router.back()} testID="back-button">
              <ThemedText type="link">{t.realmDetail.backToList}</ThemedText>
            </Pressable>

            <ThemedText type="subtitle">{projectName ?? ''}</ThemedText>

            <ThemedView style={styles.row}>
              <ThemedText style={styles.count}>{markers.length}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t.realmDetail.markersLabel}
              </ThemedText>
            </ThemedView>

            {organizableCount > 0 && (
              <ThemedView style={styles.row}>
                <ThemedText type="smallBold">{t.realmDetail.organizeTitle}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.realmDetail.organizeSubtitle}
                </ThemedText>
                <Pressable onPress={runKnowledgeOrganize} disabled={organizing} testID="knowledge-organize-button">
                  {organizing ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <ThemedText type="linkPrimary">{t.common.run}</ThemedText>
                  )}
                </Pressable>
                {organizeNote && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {organizeNote}
                  </ThemedText>
                )}
              </ThemedView>
            )}

            {/* Wing候補の確認（v2.1：AIは候補を出すだけ、収納の決定はユーザー） */}
            {pendingMarkers.length > 0 && (
              <ThemedView style={styles.pendingList}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.realmDetail.candidatesHeading(pendingMarkers.length)}
                </ThemedText>
                {pendingMarkers.map((m) => {
                  const candidates = m.marker_wings
                    .filter((mw) => mw.status === 'proposed' && mw.themes)
                    .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
                  return (
                    <ThemedView key={m.id} style={styles.pendingRow}>
                      <ThemedText numberOfLines={2}>{displayText(m)}</ThemedText>
                      <ThemedView style={styles.tagWrap}>
                        {candidates.map((mw) => (
                          <Pressable
                            key={mw.id}
                            style={styles.chip}
                            onPress={() => setWingStatus(mw.id, 'confirmed')}
                            testID={`wing-candidate-${mw.id}`}
                          >
                            <ThemedText type="small">
                              {(mw.confidence ?? 0) >= 90 ? '◎' : '○'} {mw.themes!.icon ?? '📖'} {mw.themes!.name}
                              {mw.confidence != null ? ` (${mw.confidence}%)` : ''}
                            </ThemedText>
                          </Pressable>
                        ))}
                        <Pressable
                          onPress={() => setWingPickerMarkerId(wingPickerMarkerId === m.id ? null : m.id)}
                          testID={`wing-candidate-other-${m.id}`}
                        >
                          <ThemedText type="small" themeColor="textSecondary">
                            {t.realmDetail.otherWing}
                          </ThemedText>
                        </Pressable>
                      </ThemedView>
                      {wingPickerMarkerId === m.id && (
                        <ThemedView style={styles.tagWrap}>
                          {wingOptions
                            .filter((w) => !m.marker_wings.some((mw) => mw.status !== 'rejected' && mw.themes?.id === w.id))
                            .map((w) => (
                              <Pressable
                                key={w.id}
                                style={styles.chip}
                                onPress={() => assignToWing(m.id, w.id)}
                                testID={`wing-picker-${w.id}`}
                              >
                                <ThemedText type="small">
                                  {w.icon ?? '📖'} {w.name}
                                </ThemedText>
                              </Pressable>
                            ))}
                        </ThemedView>
                      )}
                    </ThemedView>
                  );
                })}
              </ThemedView>
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

            {/* Wing未整理のマーカー一覧（AI分析前でも収納先を手で選べる） */}
            {unorganizedMarkers.length > 0 && (
              <ThemedView style={styles.pendingList}>
                <ThemedText type="small" themeColor="textSecondary">
                  {t.realmDetail.unorganizedHeading(unorganizedMarkers.length)}
                </ThemedText>
                {unorganizedMarkers.map((m) => (
                  <ThemedView key={m.id} style={styles.pendingRow}>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/conversation/[id]',
                          params: { id: m.conversation_id, markerId: m.id },
                        })
                      }
                      testID={`unorganized-${m.id}`}
                    >
                      <ThemedText numberOfLines={2}>{displayText(m)}</ThemedText>
                    </Pressable>
                    {wingOptions.length > 0 && (
                      <>
                        <Pressable
                          onPress={() => setWingPickerMarkerId(wingPickerMarkerId === m.id ? null : m.id)}
                          testID={`unorganized-wing-picker-toggle-${m.id}`}
                        >
                          <ThemedText type="small" themeColor="textSecondary">
                            {t.realmDetail.toWing}
                          </ThemedText>
                        </Pressable>
                        {wingPickerMarkerId === m.id && (
                          <ThemedView style={styles.tagWrap}>
                            {wingOptions.map((w) => (
                              <Pressable
                                key={w.id}
                                style={styles.chip}
                                onPress={() => assignToWing(m.id, w.id)}
                                testID={`unorganized-wing-picker-${w.id}`}
                              >
                                <ThemedText type="small">
                                  {w.icon ?? '📖'} {w.name}
                                </ThemedText>
                              </Pressable>
                            ))}
                          </ThemedView>
                        )}
                      </>
                    )}
                  </ThemedView>
                ))}
              </ThemedView>
            )}

            {!creatingWing ? (
              <Pressable onPress={() => setCreatingWing(true)} testID="new-wing-button">
                <ThemedText type="linkPrimary">{t.realmDetail.newWing}</ThemedText>
              </Pressable>
            ) : (
              <ThemedView style={styles.newWingForm}>
                <TextInput
                  style={styles.input}
                  placeholder={t.realmDetail.wingNamePlaceholder}
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
                    <ThemedText type="linkPrimary">{t.common.create}</ThemedText>
                  </Pressable>
                  <Pressable onPress={() => setCreatingWing(false)}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {t.common.cancel}
                    </ThemedText>
                  </Pressable>
                </ThemedView>
              </ThemedView>
            )}

            {markers.length === 0 && (
              <ThemedText type="small" themeColor="textSecondary">
                {t.realmDetail.emptyRealm}
              </ThemedText>
            )}
          </>
        ) : (
          <>
            <HomeLink />
            <Pressable onPress={() => setSelectedWingId(null)} testID="back-to-wings">
              <ThemedText type="link">← {projectName}</ThemedText>
            </Pressable>

            <ThemedText type="subtitle">
              {selectedWing?.icon ?? '📖'} {selectedWing?.name}
            </ThemedText>

            {wingMarkers.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                {t.realmDetail.emptyWing}
              </ThemedText>
            ) : (
              wingMarkers.map(({ marker, mine, others }) => (
                <ThemedView key={marker.id} style={styles.markerCard}>
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {marker.conversations?.title ?? ''}
                  </ThemedText>

                  {editingTextId === marker.id ? (
                    <>
                      <TextInput
                        style={styles.textArea}
                        value={textDraft}
                        onChangeText={setTextDraft}
                        multiline
                        testID={`edit-text-input-${marker.id}`}
                      />
                      <ThemedView style={styles.row}>
                        <Pressable onPress={() => saveEditedText(marker)} testID={`edit-text-save-${marker.id}`}>
                          <ThemedText type="linkPrimary">{t.common.save}</ThemedText>
                        </Pressable>
                        <Pressable onPress={() => setEditingTextId(null)}>
                          <ThemedText type="small" themeColor="textSecondary">
                            {t.common.cancel}
                          </ThemedText>
                        </Pressable>
                        {marker.edited_text && (
                          <ThemedText type="small" themeColor="textSecondary">
                            {t.realmDetail.editRevertHint}
                          </ThemedText>
                        )}
                      </ThemedView>
                    </>
                  ) : (
                    <Pressable onPress={() => startEditingText(marker)} testID={`marker-text-${marker.id}`}>
                      <ThemedText>{displayText(marker)}</ThemedText>
                      {marker.edited_text && (
                        <ThemedText type="small" themeColor="textSecondary">
                          {t.realmDetail.edited}
                        </ThemedText>
                      )}
                    </Pressable>
                  )}

                  {others.length > 0 && (
                    <ThemedText type="small" themeColor="textSecondary">
                      {t.realmDetail.otherWings(
                        others.map((o) => `${o.themes?.icon ?? '📖'} ${o.themes?.name}`).join('、'),
                      )}
                    </ThemedText>
                  )}

                  <ThemedView style={styles.row}>
                    <Pressable
                      onPress={() =>
                        router.push({
                          pathname: '/conversation/[id]',
                          params: { id: marker.conversation_id, markerId: marker.id },
                        })
                      }
                      testID={`view-source-${marker.id}`}
                    >
                      <ThemedText type="small" themeColor="textSecondary">
                        {t.realmDetail.viewSource}
                      </ThemedText>
                    </Pressable>
                    <Pressable
                      onPress={() => setAiPanelMarkerId(aiPanelMarkerId === marker.id ? null : marker.id)}
                      testID={`ai-panel-toggle-${marker.id}`}
                    >
                      <ThemedText type="small" themeColor="textSecondary">
                        {aiPanelMarkerId === marker.id ? t.realmDetail.aiPanelClose : t.realmDetail.aiPanelOpen}
                      </ThemedText>
                    </Pressable>
                    {mine && (
                      <Pressable onPress={() => setWingStatus(mine.id, 'rejected')} testID={`wing-marker-remove-${mine.id}`}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {t.realmDetail.removeFromWing}
                        </ThemedText>
                      </Pressable>
                    )}
                  </ThemedView>

                  {aiPanelMarkerId === marker.id && renderAiPanel(marker)}
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
  pendingList: { gap: Spacing.three },
  pendingRow: { gap: Spacing.one },
  newWingForm: { gap: Spacing.two },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, alignItems: 'center' },
  input: {
    flex: 1,
    minWidth: 120,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  chip: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  tagChipProposed: { borderStyle: 'dashed' },
  iconChoice: {
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
  iconChoiceActive: { borderColor: '#208AEF', backgroundColor: '#208AEF22' },
  markerCard: { gap: Spacing.one, paddingVertical: Spacing.two },
  aiPanel: { gap: Spacing.two, paddingVertical: Spacing.two, paddingLeft: Spacing.three },
  textArea: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    padding: Spacing.two,
    minHeight: 80,
    textAlignVertical: 'top',
    fontSize: 16,
    lineHeight: 24,
  },
});
