/**
 * S2 インポート完了サマリー（ux-flow-and-screens.md §2-1）。
 * 成功/失敗件数と警告を提示する。「レビューを始める」導線はS6実装後に接続する。
 */

import { Redirect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n';
import { getLastImportSummary } from '@/lib/lastImport';

export default function ImportSummaryScreen() {
  const router = useRouter();
  const summary = getLastImportSummary();

  if (!summary) return <Redirect href="/" />;

  const total = summary.succeeded + summary.failed.length;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <ThemedView type="backgroundElement" style={styles.badge}>
          <ThemedText type="small">{t.importSummary.sourceBadge(t.sources[summary.source] ?? summary.source)}</ThemedText>
        </ThemedView>

        <ThemedText type="subtitle" testID="summary-headline">
          {t.importSummary.headline(total, summary.succeeded)}
        </ThemedText>
        {summary.failed.length > 0 && (
          <ThemedText type="small">{t.importSummary.skipped(summary.failed.length)}</ThemedText>
        )}
        <ThemedText type="small">{t.importSummary.note}</ThemedText>

        {summary.failed.length > 0 && (
          <ThemedView type="backgroundElement" style={styles.listBox}>
            <ThemedText type="smallBold">{t.importSummary.skippedTitle}</ThemedText>
            {summary.failed.map((f, i) => (
              <ThemedText type="small" key={i}>
                ・{f.conversationRef}：{f.error}
              </ThemedText>
            ))}
          </ThemedView>
        )}

        {summary.warnings.length > 0 && (
          <ThemedView type="backgroundElement" style={styles.listBox}>
            <ThemedText type="smallBold">{t.importSummary.warningsTitle(summary.warnings.length)}</ThemedText>
            {summary.warnings.slice(0, 50).map((w, i) => (
              <ThemedText type="small" key={i}>
                ・{w.conversationRef}：{w.message}
              </ThemedText>
            ))}
            {summary.warnings.length > 50 && (
              <ThemedText type="small">{t.importSummary.moreWarnings(summary.warnings.length - 50)}</ThemedText>
            )}
          </ThemedView>
        )}

        {summary.succeeded > 0 && (
          <Pressable
            style={styles.button}
            onPress={() => router.replace({ pathname: '/inbox', params: { batchId: summary.batchId } })}
            testID="view-imported-button"
          >
            <ThemedText style={styles.buttonText}>{t.importSummary.viewImported(summary.succeeded)}</ThemedText>
          </Pressable>
        )}
        <Pressable style={styles.buttonSecondary} onPress={() => router.replace('/')} testID="back-home-button">
          <ThemedText style={styles.buttonSecondaryText}>{t.importSummary.backHome}</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  content: { maxWidth: MaxContentWidth, padding: Spacing.four, gap: Spacing.three },
  badge: { alignSelf: 'flex-start', borderRadius: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.one },
  listBox: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '600' },
  buttonSecondary: { padding: Spacing.three, alignItems: 'center' },
  buttonSecondaryText: { fontWeight: '600', opacity: 0.7 },
});
