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
        <Stack>
          {/* ホームはDESIGN.md準拠で余白を全面的に使うためヘッダー非表示（ワードマークは画面内に持つ） */}
          <Stack.Screen name="index" options={{ title: 'Lumora', headerShown: false }} />
          <Stack.Screen name="login" options={{ title: 'ログイン' }} />
          <Stack.Screen name="import" options={{ title: 'インポート' }} />
          <Stack.Screen name="import-summary" options={{ title: 'インポート完了' }} />
          <Stack.Screen name="inbox" options={{ title: '会話一覧' }} />
          <Stack.Screen name="conversation/[id]/index" options={{ title: '会話詳細' }} />
          <Stack.Screen name="projects" options={{ title: 'Realm' }} />
          <Stack.Screen name="projects/[id]" options={{ title: 'Realm' }} />
          <Stack.Screen name="search" options={{ title: '横断検索' }} />
          <Stack.Screen name="chronicles" options={{ title: 'Chronicle' }} />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
