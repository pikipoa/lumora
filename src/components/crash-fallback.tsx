/**
 * アプリ全体のクラッシュ時フォールバック（2026-07-24、不具合対応で追加）。
 *
 * Sentry.wrap()はTouchEventBoundary/Profiler等でラップするだけでErrorBoundaryを
 * 含まない（@sentry/react-native sdk.jsのwrap実装で確認済み）。そのためどこかで
 * 未捕捉のレンダーエラーが起きると、Reactの仕様（React 18〜：どのError Boundaryにも
 * 捕捉されないエラーはツリー全体をアンマウントする）により、画面が真っ白になり
 * 再読み込みするまで復帰しなかった（ピキさん実機報告：「Wingページ→Realmページに
 * 戻る」操作で発生）。根本原因の特定と別に、まずこの「真っ白で詰む」symptom自体を
 * 無くすため、Sentry.ErrorBoundaryにこのフォールバックを渡す。
 *
 * useColorScheme（react-native標準）はアプリ独自のThemeProviderに依存しないため、
 * 万一プロバイダ自体が初期化に失敗していてもこのフォールバックは独立して描画できる。
 */
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';

import { Colors, Spacing } from '@/constants/theme';
import { t } from '@/i18n';

export function CrashFallback() {
  const scheme = useColorScheme();
  const theme = Colors[scheme === 'dark' ? 'dark' : 'light'];

  function reload() {
    if (typeof window !== 'undefined') window.location.reload();
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text style={[styles.title, { color: theme.text }]}>{t.common.crashTitle}</Text>
      <Text style={[styles.body, { color: theme.textSecondary }]}>{t.common.crashBody}</Text>
      <Pressable onPress={reload}>
        <Text style={styles.reload}>{t.common.reload}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, padding: Spacing.five },
  title: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 14, textAlign: 'center' },
  reload: { fontSize: 14, fontWeight: '600', color: '#208AEF' },
});
