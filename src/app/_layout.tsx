import { DarkTheme, DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { t } from '@/i18n';
import { AuthProvider } from '@/lib/auth-context';
import { initSentry, Sentry, setSentryRoute } from '@/lib/sentry';

SplashScreen.preventAutoHideAsync();
initSentry();

function RouteTracker() {
  const pathname = usePathname();
  useEffect(() => {
    setSentryRoute(pathname);
  }, [pathname]);
  return null;
}

function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        <RouteTracker />
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
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default Sentry.wrap(RootLayout);
