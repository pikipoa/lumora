/**
 * ホーム画面。docs/DESIGN.md（2026-07-11制定）準拠の再設計版。
 *
 * 【v2.1 認知OSへの改訂（2026-07-12）】Arcaは内部概念に降格し（＝マーカーそのもの。
 * 5オブジェクト定義：docs/data-model.md「0. 設計思想」）、Arca画面・ホームのArcaカードは
 * 削除した。統計行はChronicle/Realmの2つ。解放演出もChronicle/Realmのみ。
 *
 * 設計判断（レビュー承認済み・2026-07-11、v2.1で一部改訂）：
 * - 一次要素は検索のみ（下線だけの入力欄。ボタンなし、Enterで検索）。
 *   認知フロー Import → Search → マーカー → Realm の起点が検索であるため、
 *   ホームで最初に視線が落ちる場所を検索以外にしない
 * - 解放済みの行き先はタイポグラフィ行のみ（カード・枠・絵文字・説明文なし）。
 *   解放されるたびにこの行に単語が増える＝「知識が育つほどUIも育つ」の表現
 * - インポート/Inboxは最下部の小さなテキストリンク
 * - メールアドレス表示・常時ログアウトは削除。ログアウトはワードマーク長押し
 */

import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ChronicleIcon, RealmIcon } from '@/components/type-icon';
import { UnlockCelebration } from '@/components/unlock-celebration';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import {
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
  const isMobile = useIsMobile();

  const [counts, setCounts] = useState<UnlockCounts | null>(null);
  const [seenFlags, setSeenFlags] = useState<SeenFlags>({ arcaChronicle: false, realm: false });
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationCard[]>([]);
  const [query, setQuery] = useState('');
  // タップした瞬間にアイコンの演出（Realm=波紋+弾む／Chronicle=ページめくり）を再生するトリガー。
  // 早期return（!loading && !session）より前に置く必要がある（Rules of Hooks違反を避けるため。
  // 2026-07-23、未ログイン時にHooksの呼び出し数がレンダーごとに変わりクラッシュする不具合を修正）
  const [pressTriggers, setPressTriggers] = useState<Record<string, number>>({});

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
          newlyUnlocked.push(CHRONICLE_CELEBRATION);
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

  const triggerPress = (key: string) => setPressTriggers((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));

  const stats: {
    label: string;
    Icon: typeof RealmIcon;
    value: number;
    href: '/chronicles' | '/projects';
    testID: string;
  }[] = [];
  if (counts && seenFlags.arcaChronicle) {
    stats.push({
      label: t.brand.chronicle,
      Icon: ChronicleIcon,
      value: counts.chronicleCount,
      href: '/chronicles',
      testID: 'chronicle-card',
    });
  }
  if (counts && seenFlags.realm) {
    stats.push({
      label: t.brand.realm,
      Icon: RealmIcon,
      value: counts.realmCount,
      href: '/projects',
      testID: 'realm-card',
    });
  }

  return (
    <ThemedView style={styles.container}>
      {/* デスクトップ幅限定の設定エントリーポイント（settings-ia.md「1. エントリーポイント」）。
          モバイル幅は下部タブバーの⚙️に一本化しているためここには出さない。Settingsの唯一の
          機能（マーカー色の意味登録）はマーカーを引いた後でないと意味を持たないため、
          タブバーのSettingsタブと同じくChronicle解放と同時に現れる */}
      {!isMobile && seenFlags.arcaChronicle && (
        <Pressable
          onPress={() => router.push('/settings')}
          style={styles.settingsButton}
          testID="settings-gear"
        >
          <ThemedText themeColor="textSecondary" style={styles.settingsGlyph}>
            ⚙
          </ThemedText>
        </Pressable>
      )}
      <SafeAreaView style={styles.safeArea}>
        {counts === null ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : !counts.hasConversations ? (
          <View style={styles.center}>
            <Pressable onLongPress={() => supabase.auth.signOut()}>
              <ThemedText themeColor="textSecondary" style={styles.wordmark}>
                {t.brand.appName}
              </ThemedText>
            </Pressable>
            <ThemedText type="subtitle" style={styles.heroCopy}>
              {t.home.coldStartCopy}
            </ThemedText>
            <Pressable onPress={() => router.push('/import')} testID="import-cta">
              <ThemedText type="linkPrimary" style={styles.coldStartLink}>
                {t.home.coldStartCta}
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
                  {t.brand.appName}
                </ThemedText>
              </Pressable>

              <TextInput
                style={[
                  styles.searchInput,
                  { color: theme.text, borderBottomColor: theme.backgroundSelected },
                  // 下線が既にフィールドを示しているため、Webのフォーカスリングは出さない（DESIGN.md「少ない線」）
                  Platform.OS === 'web' && ({ outlineStyle: 'none' } as object),
                ]}
                placeholder={t.home.searchPlaceholder}
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
                    <Pressable
                      key={s.label}
                      style={styles.stat}
                      onPressIn={() => triggerPress(s.testID)}
                      onPress={() => router.push(s.href)}
                      testID={s.testID}
                      accessibilityLabel={s.label}
                    >
                      <s.Icon size={36} color={theme.textSecondary} pressTrigger={pressTriggers[s.testID]} />
                      <ThemedText style={styles.statValue}>{s.value}</ThemedText>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            <View style={styles.bottomSpace} />

            <View style={styles.footer}>
              <Pressable onPress={() => router.push('/import')} testID="import-link">
                <ThemedText type="small" themeColor="textSecondary">
                  {t.home.importLink}
                </ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                {t.home.separator}
              </ThemedText>
              <Pressable onPress={() => router.push('/inbox')} testID="inbox-link">
                <ThemedText type="small" themeColor="textSecondary">
                  {t.home.inboxLink}
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
  settingsButton: { position: 'absolute', top: Spacing.four, right: Spacing.four, zIndex: 1 } as object,
  settingsGlyph: { fontSize: 20 },
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
  // 記号6:数字4の比率（決定・2026-07-22）。トップでは名称テキストを表記しない
  stat: { alignItems: 'center', gap: Spacing.half },
  statValue: { fontSize: 24, lineHeight: 30, fontWeight: '600' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.five,
  },
});
