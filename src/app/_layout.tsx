import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { t } from '@/i18n';
import { AuthProvider } from '@/lib/auth-context';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AuthProvider>
        {/* ネイティブヘッダーは全画面で非表示（2026-07-12）：画面内のタイトルとヘッダーバーで
            同じ語が二重に表示される問題への対応。titleはブラウザタブ名としてのみ使われる。
            ナビゲーションは各画面のHomeLink＋「←」リンクが担う */}
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" options={{ title: t.routes.home }} />
          <Stack.Screen name="login" options={{ title: t.routes.login }} />
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
