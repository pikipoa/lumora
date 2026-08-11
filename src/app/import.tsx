/**
 * S1 インポート画面（ux-flow-and-screens.md §2-1）。
 * ファイル選択 → 形式自動判定＋パース → Supabaseへ保存 → S2サマリーへ遷移。
 */

import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, MaxContentWidth } from '@/constants/theme';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth-context';
import { runImport } from '@/lib/importService';
import { setLastImportSummary } from '@/lib/lastImport';
import { pickImportFile } from '@/lib/pickImportFile';

type Phase =
  | { kind: 'idle' }
  | { kind: 'parsing'; fileName: string }
  | { kind: 'saving'; fileName: string; done: number; total: number }
  | { kind: 'error'; reason: string; guidance: string };

export default function ImportScreen() {
  const { session, loading } = useAuth();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  if (!loading && !session) return <Redirect href="/login" />;

  async function startImport() {
    const file = await pickImportFile();
    if (!file) return;

    setPhase({ kind: 'parsing', fileName: file.name });
    // setStateの描画を1フレーム先に反映させてから重い同期パースに入る
    await new Promise((r) => setTimeout(r, 50));

    const result = await runImport(file, (done, total) =>
      setPhase({ kind: 'saving', fileName: file.name, done, total }),
    );

    if (!result.ok) {
      setPhase({ kind: 'error', reason: result.reason, guidance: result.guidance });
      return;
    }
    setLastImportSummary(result.summary);
    setPhase({ kind: 'idle' });
    router.replace('/import-summary');
  }

  const busy = phase.kind === 'parsing' || phase.kind === 'saving';

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <ThemedText type="subtitle">{t.importScreen.title}</ThemedText>

        <ThemedView type="backgroundElement" style={styles.helpBox}>
          <ThemedText type="smallBold">{t.importScreen.supportedFormats}</ThemedText>
          <ThemedText type="small">{t.importScreen.formatChatgpt}</ThemedText>
          <ThemedText type="small">{t.importScreen.formatGemini}</ThemedText>
          <ThemedText type="small">{t.importScreen.formatClaude}</ThemedText>
          <ThemedText type="small">{t.importScreen.formatPerplexity}</ThemedText>
          <ThemedText type="small">{t.importScreen.formatDocument}</ThemedText>
          <ThemedText type="small">{t.importScreen.formatClaudeCode}</ThemedText>
        </ThemedView>

        {/* 形式の一覧を読んで「で、それはどこで手に入るのか」と止まる位置に置く。
            ボタンにしないのは、主要動線（ファイルを選択）と競合させないため */}
        <Pressable onPress={() => router.push('/export-guide')} testID="export-guide-link">
          <ThemedText type="link">{t.importScreen.exportGuideLink}</ThemedText>
        </Pressable>

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={startImport}
          disabled={busy}
          testID="pick-file-button"
        >
          <ThemedText style={styles.buttonText}>{t.importScreen.pickFile}</ThemedText>
        </Pressable>

        {phase.kind === 'parsing' && (
          <ThemedView style={styles.progressRow}>
            <ActivityIndicator />
            <ThemedText type="small">{t.importScreen.parsing(phase.fileName)}</ThemedText>
          </ThemedView>
        )}
        {phase.kind === 'saving' && (
          <ThemedView style={styles.progressRow}>
            <ActivityIndicator />
            <ThemedText type="small">{t.importScreen.saving(phase.done, phase.total)}</ThemedText>
          </ThemedView>
        )}
        {phase.kind === 'error' && (
          <ThemedView type="backgroundElement" style={styles.errorBox}>
            <ThemedText style={styles.errorTitle}>{phase.reason}</ThemedText>
            <ThemedText type="small">{phase.guidance}</ThemedText>
          </ThemedView>
        )}

        <ThemedText type="small" style={styles.privacyNote}>
          {t.importScreen.privacyNote}
        </ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  content: {
    maxWidth: MaxContentWidth,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  helpBox: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.one },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    padding: Spacing.three,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontWeight: '600' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  errorBox: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  errorTitle: { color: '#D93025', fontWeight: '600' },
  privacyNote: { opacity: 0.7 },
});
