/**
 * S9 重要部分だけ表示画面（ux-flow-and-screens.md §2-1）。confirmed（Arca）マーカーのみを
 * 全体横断で一覧表示し、タップでS6の該当箇所へジャンプする。
 */

import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
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

interface HighlightRow {
  id: string;
  quoted_text: string;
  color: string | null;
  role_tag: string | null;
  conversation_id: string;
  conversations: { title: string } | null;
}

export default function HighlightsScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<HighlightRow[] | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('markers')
        .select('id, quoted_text, color, role_tag, conversation_id, conversations(title)')
        .eq('status', 'confirmed')
        .order('created_at', { ascending: false });
      setRows((data as unknown as HighlightRow[]) ?? []);
    })();
  }, [session]);

  if (!loading && !session) return <Redirect href="/login" />;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText type="subtitle">重要部分だけ表示</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          確定済み（Arca）のマーカーのみを一覧表示します。
        </ThemedText>

        {rows === null ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} />
        ) : rows.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            まだ確定済みのマーカーがありません。
          </ThemedText>
        ) : (
          rows.map((r) => (
            <Pressable
              key={r.id}
              style={styles.card}
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
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  card: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two, backgroundColor: '#F0F0F3' },
  swatch: { width: 14, height: 14, borderRadius: 7 },
});
