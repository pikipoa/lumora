/**
 * パスワード再設定メールのリンクから戻ってくる画面。
 * Supabaseの`detectSessionInUrl`（src/lib/supabase.ts、Web限定で有効化）が
 * URL中のトークンを検出し、一時的な回復セッションを自動確立する。
 * このセッションの状態で`updateUser({ password })`を呼ぶと新パスワードを設定できる。
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { Sentry } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [sessionReady, setSessionReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(!!data.session);
    });
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (authError) {
      Sentry.captureException(new Error(`updateUser(password) failed: ${authError.message}`), {
        tags: { auth_action: 'reset_confirm' },
      });
      setError(t.resetPassword.failed(authError.message));
      return;
    }
    setDone(true);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">{t.brand.appName}</ThemedText>
        <ThemedText type="subtitle">{t.resetPassword.title}</ThemedText>

        {sessionReady === null ? (
          <ActivityIndicator />
        ) : !sessionReady ? (
          <ThemedText style={styles.error}>{t.resetPassword.invalidSession}</ThemedText>
        ) : done ? (
          <>
            <ThemedText style={styles.notice}>{t.resetPassword.success}</ThemedText>
            <Pressable style={styles.button} onPress={() => router.replace('/')} testID="reset-password-go-home">
              <ThemedText style={styles.buttonText}>{t.resetPassword.goHome}</ThemedText>
            </Pressable>
          </>
        ) : (
          <>
            <TextInput
              style={[styles.input, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement, color: theme.text }]}
              placeholder={t.resetPassword.newPasswordPlaceholder}
              placeholderTextColor={theme.textSecondary}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              onSubmitEditing={confirm}
              testID="new-password-input"
            />
            {error && <ThemedText style={styles.error}>{error}</ThemedText>}
            <Pressable style={styles.button} onPress={confirm} disabled={busy} testID="confirm-reset-button">
              {busy ? <ActivityIndicator color="#fff" /> : <ThemedText style={styles.buttonText}>{t.resetPassword.confirmButton}</ThemedText>}
            </Pressable>
          </>
        )}
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
    paddingTop: Spacing.six,
    gap: Spacing.three,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#D93025' },
  notice: { color: '#1E7E34' },
});
