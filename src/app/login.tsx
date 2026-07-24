import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { Sentry } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

type Mode = 'login' | 'signup' | 'reset';

export default function LoginScreen() {
  const router = useRouter();
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showWhySupabase, setShowWhySupabase] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function signIn() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (authError) {
      // メールアドレス・パスワードは送らず、失敗した事実とエラー種別のみ記録する
      Sentry.captureException(new Error(`signIn failed: ${authError.message}`), { tags: { auth_action: 'signin' } });
      setError(t.login.failed(authError.message));
      return;
    }
    router.replace('/');
  }

  async function signUp() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    setBusy(false);
    if (authError) {
      Sentry.captureException(new Error(`signUp failed: ${authError.message}`), { tags: { auth_action: 'signup' } });
      setError(t.login.signupFailed(authError.message));
      return;
    }
    setNotice(t.login.signupSuccess);
  }

  async function requestReset() {
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/reset-password` : undefined,
    });
    setBusy(false);
    if (authError) {
      Sentry.captureException(new Error(`resetPasswordForEmail failed: ${authError.message}`), { tags: { auth_action: 'reset' } });
      setError(t.login.resetFailed(authError.message));
      return;
    }
    setNotice(t.login.resetSuccess);
  }

  function submit() {
    if (mode === 'login') return signIn();
    if (mode === 'signup') return signUp();
    return requestReset();
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title">{t.brand.appName}</ThemedText>

        {mode !== 'reset' && (
          <ThemedView style={styles.tabRow}>
            <Pressable onPress={() => switchMode('login')} testID="mode-login-tab">
              <ThemedText type={mode === 'login' ? 'smallBold' : 'small'} themeColor={mode === 'login' ? 'text' : 'textSecondary'}>
                {t.login.modeLoginTab}
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => switchMode('signup')} testID="mode-signup-tab">
              <ThemedText type={mode === 'signup' ? 'smallBold' : 'small'} themeColor={mode === 'signup' ? 'text' : 'textSecondary'}>
                {t.login.modeSignupTab}
              </ThemedText>
            </Pressable>
          </ThemedView>
        )}

        {mode === 'signup' && <ThemedText type="small">{t.login.signupHelp}</ThemedText>}
        {mode === 'reset' && <ThemedText type="small">{t.login.resetHelp}</ThemedText>}

        <TextInput
          style={[styles.input, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement, color: theme.text }]}
          placeholder={t.login.emailPlaceholder}
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          testID="email-input"
        />
        {mode !== 'reset' && (
          <TextInput
            style={[styles.input, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement, color: theme.text }]}
            placeholder={t.login.passwordPlaceholder}
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            onSubmitEditing={submit}
            testID="password-input"
          />
        )}

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}
        {notice && <ThemedText style={styles.notice}>{notice}</ThemedText>}

        <Pressable style={styles.button} onPress={submit} disabled={busy} testID="submit-button">
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <ThemedText style={styles.buttonText}>
              {mode === 'login' ? t.login.loginButton : mode === 'signup' ? t.login.signupButton : t.login.resetButton}
            </ThemedText>
          )}
        </Pressable>

        {mode === 'login' && (
          <Pressable onPress={() => switchMode('reset')} testID="forgot-password-link">
            <ThemedText type="link">{t.login.forgotPasswordLink}</ThemedText>
          </Pressable>
        )}
        {mode === 'reset' && (
          <Pressable onPress={() => switchMode('login')} testID="back-to-login-link">
            <ThemedText type="link">{t.login.backToLogin}</ThemedText>
          </Pressable>
        )}

        <Pressable onPress={() => setShowWhySupabase((v) => !v)} testID="why-supabase-toggle">
          <ThemedText type="small" themeColor="textSecondary">
            {showWhySupabase ? '▾ ' : '▸ '}
            {t.login.whySupabaseToggle}
          </ThemedText>
        </Pressable>
        {showWhySupabase && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.whySupabaseBody}>
            {t.login.whySupabaseBody}
          </ThemedText>
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
  tabRow: { flexDirection: 'row', gap: Spacing.four },
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
  whySupabaseBody: { lineHeight: 20 },
});
