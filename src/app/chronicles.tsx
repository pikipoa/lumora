/**
 * Chronicle（文脈ライブラリ）。「マーカーを含む会話」だけを集めた、人間が過去を読み返すための層
 * （5オブジェクト定義：docs/data-model.md「0. 設計思想」）。
 * 最新マーカー日時の降順＝最近文脈を書き足した会話が上に来る。
 *
 * 【v2.1 認知OSへの改訂（2026-07-12）】Realm未割当のマーカーは、一覧の先頭に
 * 「整理待ち N」という一時セクションとして表示する（タップでS6の該当マーカーへジャンプし、
 * そこでRealmを選べる）。最後の1件が割当された瞬間、セクションごと自然に消える。
 * 未割当の置き場を別画面（旧Arca画面）に持たない、というピキさん確定方針。
 * 詳細：C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-12 v2.1 認知OSへの改訂」
 */

import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const SOURCE_LABEL: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
};

interface MarkerRow {
  conversation_id: string;
  created_at: string;
  conversations: { id: string; title: string; source: string } | null;
}

interface ChronicleRow {
  conversationId: string;
  title: string;
  source: string;
  markerCount: number;
  lastMarkerAt: string;
}

interface UnassignedMarker {
  id: string;
  conversationId: string;
  text: string;
}

export default function ChroniclesScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<ChronicleRow[] | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedMarker[]>([]);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const [{ data }, { data: unassignedRows }] = await Promise.all([
        supabase
          .from('markers')
          .select('conversation_id, created_at, conversations(id, title, source)')
          .eq('status', 'confirmed'),
        supabase
          .from('markers')
          .select('id, conversation_id, quoted_text, edited_text')
          .eq('status', 'confirmed')
          .is('project_id', null)
          .order('created_at', { ascending: false }),
      ]);

      const byConversation = new Map<string, ChronicleRow>();
      for (const row of (data as unknown as MarkerRow[]) ?? []) {
        const conv = row.conversations;
        if (!conv) continue;
        const existing = byConversation.get(conv.id);
        if (existing) {
          existing.markerCount += 1;
          if (row.created_at > existing.lastMarkerAt) existing.lastMarkerAt = row.created_at;
        } else {
          byConversation.set(conv.id, {
            conversationId: conv.id,
            title: conv.title,
            source: conv.source,
            markerCount: 1,
            lastMarkerAt: row.created_at,
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
    })();
  }, [session]);

  if (!loading && !session) return <Redirect href="/login" />;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <ThemedText type="subtitle">Chronicle</ThemedText>

        {/* Realm未割当マーカーの一時セクション。0件になると消える（v2.1） */}
        {unassigned.length > 0 && (
          <ThemedView style={styles.pendingSection} testID="unassigned-section">
            <ThemedText type="small" themeColor="textSecondary">
              整理待ち {unassigned.length}
            </ThemedText>
            {unassigned.map((m) => (
              <Pressable
                key={m.id}
                onPress={() =>
                  router.push({ pathname: '/conversation/[id]', params: { id: m.conversationId, markerId: m.id } })
                }
                testID={`unassigned-${m.id}`}
              >
                <ThemedText numberOfLines={1}>{m.text}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>
        )}

        {rows === null ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} />
        ) : rows.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            まだマーカーが付いた会話がありません。
          </ThemedText>
        ) : (
          rows.map((r) => (
            <Pressable
              key={r.conversationId}
              style={styles.row}
              onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: r.conversationId } })}
              testID={`chronicle-${r.conversationId}`}
            >
              <ThemedText numberOfLines={2}>{r.title}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {SOURCE_LABEL[r.source] ?? r.source} ・ マーカー{r.markerCount}件 ・{' '}
                {new Date(r.lastMarkerAt).toLocaleDateString('ja-JP')}
              </ThemedText>
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
  row: { gap: Spacing.one },
  pendingSection: { gap: Spacing.two, paddingBottom: Spacing.two },
});
