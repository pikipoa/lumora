/**
 * アカウント削除（2026-07-31、DESIGN.md Implementation Rulesレビュー承認済み）。
 *
 * 【設計の要点】
 * - **何が消えるかを件数で示す。**「本当によろしいですか？」を重ねるより情報量がある
 * - **メールアドレスの完全一致まで削除ボタンを無効化する。** 取り消せない操作なので、
 *   ここだけは摩擦を足す。部分一致では押せない（`hiro@example.co` では押せない）
 * - **エクスポートが無いことを隠さない。** 削除すると内容を取り出せないと明記する
 *   （`docs/trust-model.md`「未整備の項目も明示する」）
 * - 画面全体を赤くはしない（DESIGN.md Avoid「Material Design感」）が、**削除ボタンだけは
 *   OS標準のdestructive colorを使う**。iOS/Androidで「赤いボタン＝戻れない」は既に共有された
 *   知識であり、新しいUI語彙ではない
 *
 * 「知識は破壊しない」（PRINCIPLES.md Principle 3）と矛盾しない。あの原則はシステムへの
 * 制約であって、ユーザー自身の削除権を制限しない（2026-07-29に明確化）。
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { deleteAccount, fetchDeletionSummary, type DeletionSummary } from '@/lib/accountDeletion';

/** OS標準の破壊的操作の色。iOS systemRed / Android error に相当する落ち着いた赤 */
const DESTRUCTIVE = '#D93025';

interface Props {
  userId: string;
  email: string;
}

export function DeleteAccountPanel({ userId, email }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DeletionSummary | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<keyof typeof t.settings.deleteAccount.error | null>(null);

  useEffect(() => {
    if (!open) return;
    fetchDeletionSummary(userId).then(setSummary);
  }, [open, userId]);

  // 完全一致のみ有効。前後の空白だけは入力補助の都合で許容する（大文字小文字は区別しない：
  // メールアドレスのローカル部は理論上大文字小文字を区別するが、実運用では区別しないため）
  const matches = typed.trim().toLowerCase() === email.trim().toLowerCase();

  async function onSubmit() {
    if (!matches || busy) return;
    setBusy(true);
    setErrorKey(null);
    const result = await deleteAccount();
    if (!result.ok) {
      setErrorKey(result.message as keyof typeof t.settings.deleteAccount.error);
      setBusy(false);
      return;
    }
    router.replace('/login');
  }

  if (!open) {
    return (
      <Pressable style={styles.entry} onPress={() => setOpen(true)} testID="delete-account-entry">
        <ThemedText type="small" themeColor="textSecondary">
          {t.settings.deleteAccount.entry}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <ThemedView style={styles.panel} testID="delete-account-panel">
      <ThemedText type="subtitle">{t.settings.deleteAccount.title}</ThemedText>

      {/* 何が消えるかを数で示す。読み込み中は数字を出さない（0件と誤読させない） */}
      {summary ? (
        <View style={styles.counts}>
          <CountRow label={t.settings.deleteAccount.countChronicle} value={summary.chronicles} />
          <CountRow label={t.settings.deleteAccount.countArca} value={summary.arcas} />
          <CountRow label={t.settings.deleteAccount.countRealm} value={summary.realms} />
        </View>
      ) : (
        <ActivityIndicator />
      )}

      <ThemedText>{t.settings.deleteAccount.irreversible}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t.settings.deleteAccount.noExport}
      </ThemedText>

      <ThemedText type="small" themeColor="textSecondary" style={styles.prompt}>
        {t.settings.deleteAccount.confirmPrompt}
      </ThemedText>
      <TextInput
        value={typed}
        onChangeText={setTyped}
        placeholder={t.settings.deleteAccount.emailPlaceholder}
        placeholderTextColor={theme.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        editable={!busy}
        style={[styles.input, { color: theme.text, borderColor: theme.backgroundSelected }]}
        testID="delete-account-email-input"
      />

      {errorKey && (
        <ThemedText type="small">{t.settings.deleteAccount.error[errorKey]}</ThemedText>
      )}

      <View style={styles.actions}>
        <Pressable
          onPress={onSubmit}
          disabled={!matches || busy}
          style={[styles.submit, { backgroundColor: DESTRUCTIVE, opacity: matches && !busy ? 1 : 0.35 }]}
          testID="delete-account-submit"
        >
          <ThemedText style={styles.submitText}>
            {busy ? t.settings.deleteAccount.deleting : t.settings.deleteAccount.submit}
          </ThemedText>
        </Pressable>
        <Pressable
          onPress={() => {
            setOpen(false);
            setTyped('');
            setErrorKey(null);
          }}
          disabled={busy}
          testID="delete-account-cancel"
        >
          <ThemedText type="small" themeColor="textSecondary">
            {t.settings.deleteAccount.cancel}
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.countRow}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  /** 他の設定項目とは大きな余白で隔離する。色ではなく余白で「別のもの」だと伝える */
  entry: { marginTop: Spacing.five * 2, paddingVertical: Spacing.three },
  panel: { marginTop: Spacing.five * 2, gap: Spacing.three },
  counts: { gap: Spacing.one },
  countRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  prompt: { marginTop: Spacing.two },
  input: { borderBottomWidth: 1, paddingVertical: Spacing.two, fontSize: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.four, marginTop: Spacing.two },
  submit: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.four, borderRadius: Spacing.two },
  submitText: { color: '#FFFFFF' },
});
