/**
 * S5 会話一覧（Realm割当分 or Inbox）。ux-flow-and-screens.md §2-1準拠。
 * クエリパラメータなし＝未分類（Inbox。project_id null）。
 * projectId＝そのプロジェクトに割り当て済みの会話（旧・会話単位の割当機能。marker単位の
 * 割当が主戦場になった現在は副次的な導線として残す）。
 *
 * 【設計思想の転換（2026-07-11）】この画面はもう「AI分析の起点」ではない。
 * マーカーは横断検索（S8）→会話詳細（S6）で本文を選択して作る一次動線が主役になったため、
 * ここは「横断検索で見つからない時のフォールバック閲覧」という副次的な役割になった。
 * 旧「🤖 AI分析」ボタンとそれに紐づくジョブ状態表示は削除した。
 * 詳細：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 *
 * 実データ検証後のフィードバック（2026-07-11）を反映：
 * - 並び順はimported_at（インポート時刻）ではなく、元の会話日時（created_at）でソート＋月別グルーピング表示
 *   （一括インポートするとimported_atがほぼ同時刻になり順序の意味が無くなるため）
 * - 「保留」機能：雑談等の不要な会話を一覧から論理的に隅へ追いやれる（held_at）。
 *   保留一覧からのみ、明示的な操作で物理削除もできる（CLAUDE.md 2-1の「rejectedは物理削除しない」
 *   思想を踏襲しつつ、会話単位の大掃除ニーズには2段階目として物理削除も用意する）
 */

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

interface ConversationRow {
  id: string;
  title: string;
  source: string;
  created_at: string | null;
  imported_at: string;
}

interface ProjectOption {
  id: string;
  name: string;
}

function monthKey(iso: string | null): string {
  if (!iso) return t.inbox.monthUnknown;
  const d = new Date(iso);
  return t.inbox.monthLabel(d.getFullYear(), d.getMonth() + 1);
}

function groupByMonth(rows: ConversationRow[]): { title: string; data: ConversationRow[] }[] {
  const sections: { title: string; data: ConversationRow[] }[] = [];
  for (const row of rows) {
    const key = monthKey(row.created_at);
    const last = sections[sections.length - 1];
    if (last && last.title === key) last.data.push(row);
    else sections.push({ title: key, data: [row] });
  }
  return sections;
}

export default function InboxScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();

  const [rows, setRows] = useState<ConversationRow[] | null>(null);
  const [headerLabel, setHeaderLabel] = useState(t.inbox.titleInbox);
  const [projectOptions, setProjectOptions] = useState<ProjectOption[] | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const isInboxMode = !projectId;

  const load = useCallback(async () => {
    let query = supabase
      .from('conversations')
      .select('id, title, source, created_at, imported_at')
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(2000);

    query = showHeld ? query.not('held_at', 'is', null) : query.is('held_at', null);

    if (projectId) {
      query = query.eq('project_id', projectId);
      const { data: project } = await supabase.from('projects').select('name').eq('id', projectId).single();
      setHeaderLabel(project ? t.inbox.titleRealm(project.name) : t.inbox.titleRealmFallback);
    } else {
      query = query.is('project_id', null);
      setHeaderLabel(t.inbox.titleInbox);
    }

    const { data: conversations } = await query;
    setRows(conversations ?? []);
  }, [projectId, showHeld]);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!loading && !session) return <Redirect href="/login" />;

  async function openAssignPicker(conversationId: string) {
    if (!projectOptions) {
      const { data } = await supabase.from('projects').select('id, name').order('created_at', { ascending: false });
      setProjectOptions(data ?? []);
    }
    setAssigningId(conversationId);
  }

  async function assignToProject(conversationId: string, targetProjectId: string) {
    await supabase.from('conversations').update({ project_id: targetProjectId }).eq('id', conversationId);
    setAssigningId(null);
    load();
  }

  async function holdConversation(conversationId: string) {
    await supabase.from('conversations').update({ held_at: new Date().toISOString() }).eq('id', conversationId);
    load();
  }

  async function restoreConversation(conversationId: string) {
    await supabase.from('conversations').update({ held_at: null }).eq('id', conversationId);
    load();
  }

  async function deleteConversation(conversationId: string) {
    await supabase.from('conversations').delete().eq('id', conversationId);
    setConfirmDeleteId(null);
    load();
  }

  return (
    <ThemedView style={styles.container}>
      <SectionList
        contentContainerStyle={styles.content}
        sections={rows ? groupByMonth(rows) : []}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <ThemedView type="background" style={styles.sectionHeader}>
            <ThemedText type="smallBold">{section.title}</ThemedText>
          </ThemedView>
        )}
        ListHeaderComponent={
          <>
            <HomeLink />
            <ThemedView style={styles.rowBetween}>
              <ThemedText type="smallBold">{showHeld ? t.inbox.heldSuffix(headerLabel) : headerLabel}</ThemedText>
              {isInboxMode && (
                <Pressable onPress={() => setShowHeld((v) => !v)} testID="toggle-held">
                  <ThemedText type="small" themeColor="textSecondary">
                    {showHeld ? t.inbox.showNormal : t.inbox.showHeld}
                  </ThemedText>
                </Pressable>
              )}
            </ThemedView>
            {!showHeld && (
              <ThemedText type="small" style={styles.note}>
                {t.inbox.fallbackNote}
              </ThemedText>
            )}
          </>
        }
        ListEmptyComponent={
          rows === null ? (
            <ActivityIndicator style={{ marginTop: Spacing.five }} />
          ) : (
            <ThemedText style={styles.note}>{showHeld ? t.inbox.emptyHeld : t.inbox.empty}</ThemedText>
          )
        }
        renderItem={({ item }) => (
          <ThemedView type="backgroundElement" style={styles.card}>
            <Pressable
              onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: item.id } })}
              testID={`open-${item.id}`}
            >
              <ThemedText type="smallBold" numberOfLines={2}>
                {item.title}
              </ThemedText>
              <ThemedText type="small">
                {t.sources[item.source] ?? item.source} ・{' '}
                {item.created_at ? new Date(item.created_at).toLocaleDateString('ja-JP') : t.common.unknownDate}
              </ThemedText>
            </Pressable>

            {showHeld ? (
              <ThemedView style={styles.row}>
                <Pressable
                  style={styles.buttonOutline}
                  onPress={() => restoreConversation(item.id)}
                  testID={`restore-${item.id}`}
                >
                  <ThemedText type="small">{t.inbox.restore}</ThemedText>
                </Pressable>
                {confirmDeleteId === item.id ? (
                  <>
                    <ThemedText type="small" style={styles.error}>
                      {t.inbox.deleteConfirm}
                    </ThemedText>
                    <Pressable
                      style={styles.buttonDanger}
                      onPress={() => deleteConversation(item.id)}
                      testID={`confirm-delete-${item.id}`}
                    >
                      <ThemedText style={styles.buttonText}>{t.inbox.deletePermanently}</ThemedText>
                    </Pressable>
                    <Pressable style={styles.buttonOutline} onPress={() => setConfirmDeleteId(null)}>
                      <ThemedText type="small">{t.common.cancel}</ThemedText>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    style={styles.buttonOutline}
                    onPress={() => setConfirmDeleteId(item.id)}
                    testID={`delete-${item.id}`}
                  >
                    <ThemedText type="small" style={styles.error}>
                      {t.inbox.deletePermanently}
                    </ThemedText>
                  </Pressable>
                )}
              </ThemedView>
            ) : (
              <ThemedView style={styles.row}>
                {isInboxMode && (
                  <Pressable
                    style={styles.buttonOutline}
                    onPress={() => openAssignPicker(item.id)}
                    testID={`assign-${item.id}`}
                  >
                    <ThemedText type="small">{t.inbox.assignToRealm}</ThemedText>
                  </Pressable>
                )}

                <Pressable style={styles.buttonOutline} onPress={() => holdConversation(item.id)} testID={`hold-${item.id}`}>
                  <ThemedText type="small">{t.inbox.hold}</ThemedText>
                </Pressable>
              </ThemedView>
            )}

            {assigningId === item.id && (
              <ThemedView style={styles.tagWrap}>
                {(projectOptions ?? []).map((p) => (
                  <Pressable
                    key={p.id}
                    style={styles.chip}
                    onPress={() => assignToProject(item.id, p.id)}
                    testID={`assign-to-${p.id}`}
                  >
                    <ThemedText type="small">{p.name}</ThemedText>
                  </Pressable>
                ))}
                {(projectOptions ?? []).length === 0 && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.inbox.noRealms}
                  </ThemedText>
                )}
              </ThemedView>
            )}
          </ThemedView>
        )}
      />
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
  note: { opacity: 0.7 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionHeader: { paddingVertical: Spacing.two },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two, marginBottom: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', alignItems: 'center' },
  buttonDanger: {
    backgroundColor: '#D93025',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  error: { color: '#D93025' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    borderColor: '#999',
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
  },
});
