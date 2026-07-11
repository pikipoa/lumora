import { Redirect, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

export default function HomeScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) SplashScreen.hideAsync();
  }, [loading]);

  if (loading) return <ThemedView style={styles.container} />;
  if (!session) return <Redirect href="/login" />;

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">Lumora</ThemedText>
        <ThemedText type="small">{session.user.email}</ThemedText>

        <ThemedView type="backgroundElement" style={styles.menu}>
          <Pressable style={styles.menuItem} onPress={() => router.push('/import')}>
            <ThemedText type="smallBold">📥 会話をインポート</ThemedText>
            <ThemedText type="small">ChatGPT / Gemini / Claude / Perplexity</ThemedText>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => router.push('/inbox')}>
            <ThemedText type="smallBold">📂 会話一覧（Inbox）</ThemedText>
            <ThemedText type="small">インポート済み会話の確認とAI分析の実行</ThemedText>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => router.push('/projects')}>
            <ThemedText type="smallBold">🗂️ プロジェクト一覧</ThemedText>
            <ThemedText type="small">Realm・テーマの整理とレビュー</ThemedText>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => router.push('/search')}>
            <ThemedText type="smallBold">🔍 横断検索</ThemedText>
            <ThemedText type="small">全プロジェクト・全AI横断のキーワード/タグ検索</ThemedText>
          </Pressable>
          <Pressable style={styles.menuItem} onPress={() => router.push('/highlights')}>
            <ThemedText type="smallBold">✨ 重要部分だけ表示</ThemedText>
            <ThemedText type="small">確定済み（Arca）マーカーの一覧</ThemedText>
          </Pressable>
        </ThemedView>

        <Pressable onPress={() => supabase.auth.signOut()}>
          <ThemedText type="small" style={styles.signOut}>
            ログアウト
          </ThemedText>
        </Pressable>
      </SafeAreaView>
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
  menu: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.three },
  menuItem: { gap: Spacing.one, paddingVertical: Spacing.two },
  note: { opacity: 0.7 },
  signOut: { textDecorationLine: 'underline', marginTop: Spacing.four },
});
