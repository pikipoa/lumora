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
          <Stack.Screen name="index" options={{ title: 'Lumora' }} />
          <Stack.Screen name="login" options={{ title: 'ログイン' }} />
          <Stack.Screen name="import" options={{ title: 'インポート' }} />
          <Stack.Screen name="import-summary" options={{ title: 'インポート完了' }} />
          <Stack.Screen name="inbox" options={{ title: '会話一覧（Inbox）' }} />
        </Stack>
      </AuthProvider>
    </ThemeProvider>
  );
}
