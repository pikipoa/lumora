/**
 * S1 インポート画面（ux-flow-and-screens.md §2-1）。
 * ファイル選択 → 形式自動判定＋パース → Supabaseへ保存 → S2サマリーへ遷移。
 */

import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing, MaxContentWidth } from '@/constants/theme';
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
        <ThemedText type="subtitle">会話データのアップロード</ThemedText>

        <ThemedView type="backgroundElement" style={styles.helpBox}>
          <ThemedText type="smallBold">対応形式</ThemedText>
          <ThemedText type="small">・ChatGPT：公式エクスポートのZIP（conversations.json）</ThemedText>
          <ThemedText type="small">
            ・Gemini：Google TakeoutのZIP（「My Activity」→「Gemini Apps」、JSON形式を指定）
          </ThemedText>
          <ThemedText type="small">・Claude：公式エクスポートのZIP（conversations.json）</ThemedText>
          <ThemedText type="small">・Perplexity：個別スレッドのMarkdownファイル</ThemedText>
        </ThemedView>

        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={startImport}
          disabled={busy}
          testID="pick-file-button"
        >
          <ThemedText style={styles.buttonText}>ファイルを選択してインポート</ThemedText>
        </Pressable>

        {phase.kind === 'parsing' && (
          <ThemedView style={styles.progressRow}>
            <ActivityIndicator />
            <ThemedText type="small">{phase.fileName} を解析中…</ThemedText>
          </ThemedView>
        )}
        {phase.kind === 'saving' && (
          <ThemedView style={styles.progressRow}>
            <ActivityIndicator />
            <ThemedText type="small">
              保存中… {phase.done} / {phase.total} 件
            </ThemedText>
          </ThemedView>
        )}
        {phase.kind === 'error' && (
          <ThemedView type="backgroundElement" style={styles.errorBox}>
            <ThemedText style={styles.errorTitle}>{phase.reason}</ThemedText>
            <ThemedText type="small">{phase.guidance}</ThemedText>
          </ThemedView>
        )}

        <ThemedText type="small" style={styles.privacyNote}>
          アップロードした原本ファイルはこの端末内にのみ保存され、クラウドには会話テキスト（正規化済み）だけが保存されます。
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
