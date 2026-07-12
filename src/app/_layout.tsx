import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

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
          <Stack.Screen name="index" options={{ title: 'Lumora' }} />
          <Stack.Screen name="login" options={{ title: 'ログイン' }} />
          <Stack.Screen name="import" options={{ title: 'インポート' }} />
          <Stack.Screen name="import-summary" options={{ title: 'インポート完了' }} />
          <Stack.Screen name="inbox" options={{ title: '会話一覧' }} />
          <Stack.Screen name="conversation/[id]/index" options={{ title: '会話詳細' }} />
          <Stack.Screen name="projects" options={{ title: 'Realm' }} />
          <Stack.Screen name="projects/[id]" options={{ title: 'Realm' }} />
          <Stack.Screen name="search" options={{ title: 'Search' }} />
          <Stack.Screen name="chronicles" options={{ title: 'Chronicle' }} />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
