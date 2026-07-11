/**
 * ホーム画面。docs/DESIGN.md（2026-07-11制定）準拠の再設計版。
 *
 * 設計判断（レビュー承認済み・2026-07-11）：
 * - 一次要素は検索のみ（下線だけの入力欄。ボタンなし、Enterで検索）。
 *   情報階層 Search → Marker → Arca → Wing → Realm の起点が検索であるため、
 *   ホームで最初に視線が落ちる場所を検索以外にしない
 * - 解放済みの行き先は「Arca 4 · Chronicle 1 · Realm 1」のタイポグラフィ行のみ
 *   （カード・枠・絵文字・説明文なし。数字が大きくラベルが小さい）。
 *   解放されるたびにこの行に単語が増える＝「知識が育つほどUIも育つ」の表現
 * - インポート/Inboxは最下部の小さなテキストリンク
 * - メールアドレス表示・常時ログアウトは削除。ログアウトはワードマーク長押し
 * - 解放判定ロジック（unlocks.ts・AsyncStorage既読フラグ）は前実装のまま
 */

import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UnlockCelebration } from '@/components/unlock-celebration';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
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
  const theme = useTheme();

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

  const stats: { label: string; value: number; href: '/highlights' | '/chronicles' | '/projects'; testID: string }[] =
    [];
  if (counts && seenFlags.arcaChronicle) {
    stats.push({ label: 'Arca', value: counts.markerCount, href: '/highlights', testID: 'arca-card' });
    stats.push({ label: 'Chronicle', value: counts.chronicleCount, href: '/chronicles', testID: 'chronicle-card' });
  }
  if (counts && seenFlags.realm) {
    stats.push({ label: 'Realm', value: counts.realmCount, href: '/projects', testID: 'realm-card' });
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        {counts === null ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : !counts.hasConversations ? (
          <View style={styles.center}>
            <Pressable onLongPress={() => supabase.auth.signOut()}>
              <ThemedText themeColor="textSecondary" style={styles.wordmark}>
                Lumora
              </ThemedText>
            </Pressable>
            <ThemedText type="subtitle" style={styles.heroCopy}>
              AIとの会話を、知識に。
            </ThemedText>
            <Pressable onPress={() => router.push('/import')} testID="import-cta">
              <ThemedText type="linkPrimary" style={styles.coldStartLink}>
                会話をインポート →
              </ThemedText>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.topSpace} />

            <View style={styles.main}>
              {/* ログアウトはワードマーク長押し（常時表示のログアウトはDESIGN.mdにより撤去） */}
              <Pressable onLongPress={() => supabase.auth.signOut()}>
                <ThemedText themeColor="textSecondary" style={styles.wordmark}>
                  Lumora
                </ThemedText>
              </Pressable>

              <TextInput
                style={[
                  styles.searchInput,
                  { color: theme.text, borderBottomColor: theme.backgroundSelected },
                  // 下線が既にフィールドを示しているため、Webのフォーカスリングは出さない（DESIGN.md「少ない線」）
                  Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
                ]}
                placeholder="知識を探す"
                placeholderTextColor={theme.textSecondary}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={runSearch}
                returnKeyType="search"
                autoFocus={Platform.OS === 'web'}
                testID="home-search-input"
              />

              {stats.length > 0 && (
                <View style={styles.statsRow}>
                  {stats.map((s) => (
                    <Pressable key={s.label} style={styles.stat} onPress={() => router.push(s.href)} testID={s.testID}>
                      <ThemedText style={styles.statValue}>{s.value}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        {s.label}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.bottomSpace} />

            <View style={styles.footer}>
              <Pressable onPress={() => router.push('/import')} testID="import-link">
                <ThemedText type="small" themeColor="textSecondary">
                  インポート
                </ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                ・
              </ThemedText>
              <Pressable onPress={() => router.push('/inbox')} testID="inbox-link">
                <ThemedText type="small" themeColor="textSecondary">
                  Inbox
                </ThemedText>
              </Pressable>
            </View>
          </>
        )}
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
    width: '100%',
    maxWidth: MaxContentWidth,
    paddingHorizontal: Spacing.five,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.four },
  topSpace: { flex: 1 },
  bottomSpace: { flex: 2 },
  main: { gap: Spacing.five },
  wordmark: { fontSize: 13, fontWeight: '600', letterSpacing: 2 },
  heroCopy: { textAlign: 'center' },
  coldStartLink: { fontSize: 16 },
  searchInput: {
    fontSize: 20,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  statsRow: { flexDirection: 'row', gap: Spacing.six },
  stat: { gap: Spacing.half },
  statValue: { fontSize: 28, lineHeight: 34, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.five,
  },
});
