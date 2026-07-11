/**
 * Chronicle（文脈ライブラリ）。進化するホーム画面（2026-07-11）で新設。
 * 詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-11 進化するホーム画面（Progressive Unlock UI）」
 *
 * 「マーカーが1つ以上付いた会話」だけを集めた一覧。Arca（一文＝知識の種）に対して、
 * Chronicleは「その一文を含む会話＝文脈・経緯」を保存する場所という役割分担
 * （data-model.md「2026-07-11 マーカー中心アーキテクチャへの転換」参照）。
 * 「なぜそう言っていたのか」を確認したい時にここから会話を開く。
 * 最新マーカー日時の降順＝最近文脈を書き足した会話が上に来る。
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

export default function ChroniclesScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<ChronicleRow[] | null>(null);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const { data } = await supabase
        .from('markers')
        .select('conversation_id, created_at, conversations(id, title, source)')
        .eq('status', 'confirmed');

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
    })();
  }, [session]);

  if (!loading && !session) return <Redirect href="/login" />;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <ThemedText type="subtitle">Chronicle</ThemedText>

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
});
