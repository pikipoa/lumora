/**
 * S2 インポート完了サマリー（ux-flow-and-screens.md §2-1）。
 * 成功/失敗件数と警告を提示する。「レビューを始める」導線はS6実装後に接続する。
 */

import { Redirect, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getLastImportSummary } from '@/lib/lastImport';

const SOURCE_LABEL: Record<string, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  perplexity: 'Perplexity',
};

export default function ImportSummaryScreen() {
  const router = useRouter();
  const summary = getLastImportSummary();

  if (!summary) return <Redirect href="/" />;

  const total = summary.succeeded + summary.failed.length;

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView type="backgroundElement" style={styles.badge}>
          <ThemedText type="small">出典: {SOURCE_LABEL[summary.source] ?? summary.source}</ThemedText>
        </ThemedView>

        <ThemedText type="subtitle" testID="summary-headline">
          {total}件中{summary.succeeded}件を正常にインポートしました
        </ThemedText>
        {summary.failed.length > 0 && (
          <ThemedText type="small">
            {summary.failed.length}件は形式エラー等のためスキップされました
          </ThemedText>
        )}
        <ThemedText type="small">
          インポートした会話は未分類（Inbox）に入っています。Realm（プロジェクト）への割り当てとレビューは、レビュー画面の実装後にここから直接始められるようになります。
        </ThemedText>

        {summary.failed.length > 0 && (
          <ThemedView type="backgroundElement" style={styles.listBox}>
            <ThemedText type="smallBold">スキップされた会話</ThemedText>
            {summary.failed.map((f, i) => (
              <ThemedText type="small" key={i}>
                ・{f.conversationRef}：{f.error}
              </ThemedText>
            ))}
          </ThemedView>
        )}

        {summary.warnings.length > 0 && (
          <ThemedView type="backgroundElement" style={styles.listBox}>
            <ThemedText type="smallBold">警告（{summary.warnings.length}件）</ThemedText>
            {summary.warnings.slice(0, 50).map((w, i) => (
              <ThemedText type="small" key={i}>
                ・{w.conversationRef}：{w.message}
              </ThemedText>
            ))}
            {summary.warnings.length > 50 && (
              <ThemedText type="small">…ほか{summary.warnings.length - 50}件</ThemedText>
            )}
          </ThemedView>
        )}

        <Pressable style={styles.button} onPress={() => router.replace('/')} testID="back-home-button">
          <ThemedText style={styles.buttonText}>ホームへ戻る</ThemedText>
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
});
