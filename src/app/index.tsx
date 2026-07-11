/**
 * ホーム画面。2026-07-11、「機能を並べる静的メニュー」から「ユーザーの成長・知識の蓄積に
 * 合わせて進化するUI」へ作り替えた（進化するホーム画面／Progressive Unlock UI）。
 * 詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-11 進化するホーム画面（Progressive Unlock UI）」
 *
 * - Cold Start（会話が1件もない）：インポートのCTAのみを見せる
 * - 通常時：最上段に検索窓、その下にArca/Chronicle/Realmが「解放」条件を満たすたびに
 *   段階的に出現する。初出現時は`unlock-celebration`で祝福演出を挟む
 * - 解放状態は`src/lib/unlocks.ts`が、DBの実データ（現在値）とAsyncStorageの既読フラグ
 *   （一度trueになったら戻らない）の2層で管理する
 */

import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UnlockCelebration } from '@/components/unlock-celebration';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import {
  ARCA_CELEBRATION,
  CHRONICLE_CELEBRATION,
  REALM_CELEBRATION,
  getSeenFlags,
  loadUnlockCounts,
  markSeen,
  type CelebrationCard,
  type SeenFlags,
  type UnlockCounts,
} from '@/lib/unlocks';

export default function HomeScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();

  const [counts, setCounts] = useState<UnlockCounts | null>(null);
  const [seenFlags, setSeenFlags] = useState<SeenFlags>({ arcaChronicle: false, realm: false });
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationCard[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      (async () => {
        const nextCounts = await loadUnlockCounts();
        const seen = await getSeenFlags(session.user.id);

        const newlyUnlocked: CelebrationCard[] = [];
        if (nextCounts.hasConfirmedMarker && !seen.arcaChronicle) {
          newlyUnlocked.push(ARCA_CELEBRATION, CHRONICLE_CELEBRATION);
          await markSeen(session.user.id, 'arcaChronicle');
        }
        if (nextCounts.hasRealmAssignedMarker && !seen.realm) {
          newlyUnlocked.push(REALM_CELEBRATION);
          await markSeen(session.user.id, 'realm');
        }

        setCounts(nextCounts);
        setSeenFlags({
          arcaChronicle: seen.arcaChronicle || nextCounts.hasConfirmedMarker,
          realm: seen.realm || nextCounts.hasRealmAssignedMarker,
        });
        if (newlyUnlocked.length > 0) setCelebrationQueue(newlyUnlocked);
      })();
    }, [session]),
  );

  if (!loading && !session) return <Redirect href="/login" />;

  function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) {
      router.push('/search');
      return;
    }
    router.push({ pathname: '/search', params: { q: trimmed } });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {counts === null ? (
          <ActivityIndicator style={{ marginTop: Spacing.five }} />
        ) : !counts.hasConversations ? (
          <ThemedView style={styles.coldStart}>
            <ThemedText type="title">Lumora</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.coldStartCopy}>
              まずは会話をインポートするところから始まります。
            </ThemedText>
            <Pressable style={styles.heroButton} onPress={() => router.push('/import')} testID="import-cta">
              <ThemedText style={styles.heroButtonText}>📥 会話をインポート</ThemedText>
            </Pressable>
          </ThemedView>
        ) : (
          <ThemedView style={styles.menu}>
            <ThemedText type="title">Lumora</ThemedText>
            <ThemedText type="small">{session?.user.email}</ThemedText>

            <ThemedView style={styles.searchRow}>
              <TextInput
                style={styles.searchInput}
                placeholder="横断検索"
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={runSearch}
                testID="home-search-input"
              />
              <Pressable style={styles.searchButton} onPress={runSearch} testID="home-search-button">
                <ThemedText style={styles.searchButtonText}>🔍</ThemedText>
              </Pressable>
            </ThemedView>

            {seenFlags.arcaChronicle && (
              <ThemedView style={styles.section}>
                <Pressable style={styles.menuItem} onPress={() => router.push('/highlights')} testID="arca-card">
                  <ThemedText type="smallBold">✨ Arca</ThemedText>
                  <ThemedText type="small">マーカー{counts.markerCount}件。Realm・タグで整理</ThemedText>
                </Pressable>
                <Pressable style={styles.menuItem} onPress={() => router.push('/chronicles')} testID="chronicle-card">
                  <ThemedText type="smallBold">📜 Chronicle</ThemedText>
                  <ThemedText type="small">会話{counts.chronicleCount}件。文脈を読み返す図書館</ThemedText>
                </Pressable>
              </ThemedView>
            )}

            {seenFlags.realm && (
              <ThemedView style={styles.section}>
                <Pressable style={styles.menuItem} onPress={() => router.push('/projects')} testID="realm-card">
                  <ThemedText type="smallBold">🌍 Realm</ThemedText>
                  <ThemedText type="small">{counts.realmCount}個。整理された知識の置き場所</ThemedText>
                </Pressable>
              </ThemedView>
            )}

            <ThemedView style={styles.footerLinks}>
              <Pressable onPress={() => router.push('/import')} testID="import-link">
                <ThemedText type="link">＋ 会話を追加でインポート</ThemedText>
              </Pressable>
              <Pressable onPress={() => router.push('/inbox')} testID="inbox-link">
                <ThemedText type="link">📂 会話一覧（Inbox・フォールバック）</ThemedText>
              </Pressable>
            </ThemedView>
          </ThemedView>
        )}

        <Pressable onPress={() => supabase.auth.signOut()}>
          <ThemedText type="small" style={styles.signOut}>
            ログアウト
          </ThemedText>
        </Pressable>
      </SafeAreaView>

      {celebrationQueue.length > 0 && (
        <UnlockCelebration cards={celebrationQueue} onDone={() => setCelebrationQueue([])} />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    gap: Spacing.three,
  },
  coldStart: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three },
  coldStartCopy: { textAlign: 'center' },
  heroButton: {
    marginTop: Spacing.three,
    backgroundColor: '#208AEF',
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.five,
  },
  heroButtonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
  menu: { gap: Spacing.three },
  searchRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
  },
  searchButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  searchButtonText: { fontSize: 16 },
  section: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three, backgroundColor: '#F0F0F3' },
  menuItem: { gap: Spacing.one, paddingVertical: Spacing.two },
  footerLinks: { gap: Spacing.two, marginTop: Spacing.two },
  signOut: { textDecorationLine: 'underline', marginTop: Spacing.four },
});
