import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { useColorScheme, View } from 'react-native';

import { BottomTabBar, TAB_BAR_HEIGHT } from '@/components/bottom-tab-bar';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { t } from '@/i18n';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { initSentry, Sentry, setSentryRoute } from '@/lib/sentry';
import { getSeenFlags, type SeenFlags } from '@/lib/unlocks';

SplashScreen.preventAutoHideAsync();
initSentry();

function RouteTracker() {
  const pathname = usePathname();
  useEffect(() => {
    setSentryRoute(pathname);
  }, [pathname]);
  return null;
}

function AppShell() {
  const { session } = useAuth();
  const isMobile = useIsMobile();
  const pathname = usePathname();
  const [seenFlags, setSeenFlags] = useState<SeenFlags | null>(null);

  useEffect(() => {
    if (session) getSeenFlags(session.user.id).then(setSeenFlags);
    else setSeenFlags(null);
  }, [session, pathname]);

  // 何も解放していない間はタブバー自体を出さない（Homeだけでは並び替えの意味が無いため）
  const showTabBar = isMobile && !!session && !!seenFlags && (seenFlags.arcaChronicle || seenFlags.realm);

  return (
    <View style={{ flex: 1, paddingBottom: showTabBar ? TAB_BAR_HEIGHT : 0 }}>
      {/* ネイティブヘッダーは全画面で非表示（2026-07-12）：画面内のタイトルとヘッダーバーで
          同じ語が二重に表示される問題への対応。titleはブラウザタブ名としてのみ使われる。
          ナビゲーションは各画面のHomeLink＋「←」リンクが担う */}
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" options={{ title: t.routes.home }} />
        <Stack.Screen name="login" options={{ title: t.routes.login }} />
        <Stack.Screen name="reset-password" options={{ title: t.routes.resetPassword }} />
        <Stack.Screen name="import" options={{ title: t.routes.import }} />
        <Stack.Screen name="import-summary" options={{ title: t.routes.importSummary }} />
        <Stack.Screen name="inbox" options={{ title: t.routes.inbox }} />
        <Stack.Screen name="conversation/[id]/index" options={{ title: t.routes.conversation }} />
        <Stack.Screen name="projects" options={{ title: t.routes.realms }} />
        <Stack.Screen name="projects/[id]" options={{ title: t.routes.realmDetail }} />
        <Stack.Screen name="search" options={{ title: t.routes.search }} />
        <Stack.Screen name="chronicles" options={{ title: t.routes.chronicles }} />
        <Stack.Screen name="settings" options={{ title: t.routes.settings }} />
      </Stack>
      {/* position:fixedなのでpaddingBottomの外に置いても表示位置は変わらない。
          Stackは内部でStyleSheet.absoluteFillを使うため、flexの兄弟として実スペースを
          占有させる方式は機能しない（2026-07-24、不具合修正。詳細はbottom-tab-bar.tsx） */}
      {showTabBar && seenFlags && <BottomTabBar seenFlags={seenFlags} />}
    </View>
  );
}

function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RouteTracker />
        <AppShell />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);
