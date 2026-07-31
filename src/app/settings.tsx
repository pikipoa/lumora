/**
 * S設定 マーカー色の意味登録（settings-ia.md「4-1」）。
 *
 * 「AIのための機能」ではなく「ユーザー自身の思考ルールを言語化・表現する機能」（VISION.md「1-1」）。
 * settings-ia.mdの4セクション構成のうち、今Lumoraに実在する機能はこれ1つだけなので、
 * ハブ画面は作らずこの画面へ直接遷移させる（DESIGN.md「Remove Before Add」）。
 * Phase1のスコープは登録UIとデータ保存のみ（`organize-markers`等への反映はPhase2）。
 */

import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';

import { DeleteAccountPanel } from '@/components/delete-account-panel';
import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';

const COLOR_PRESETS = [
  { color: 'pink', emoji: '🩷', label: 'アイデア' },
  { color: 'green', emoji: '🟩', label: '設定' },
  { color: 'yellow', emoji: '🟨', label: '根拠' },
  { color: 'blue', emoji: '🟦', label: '仕様' },
  { color: 'red', emoji: '🟥', label: '注意点' },
] as const;

interface MeaningRow {
  color: string;
  label: string;
  description: string;
}

export default function SettingsScreen() {
  const theme = useTheme();
  const { session, loading } = useAuth();
  const [rows, setRows] = useState<MeaningRow[]>(
    COLOR_PRESETS.map((p) => ({ color: p.color, label: p.label, description: '' })),
  );
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from('marker_color_meanings').select('color, label, description');
    if (!data || data.length === 0) return;
    setRows((prev) =>
      prev.map((r) => {
        const existing = data.find((d) => d.color === r.color);
        return existing ? { color: r.color, label: existing.label, description: existing.description ?? '' } : r;
      }),
    );
  }, []);

  useEffect(() => {
    if (session) load();
  }, [session, load]);

  if (!loading && !session) return <Redirect href="/login" />;

  function updateRow(color: string, patch: Partial<MeaningRow>) {
    setRows((prev) => prev.map((r) => (r.color === color ? { ...r, ...patch } : r)));
    setSaved(false);
  }

  async function saveAll() {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    await supabase.from('marker_color_meanings').upsert(
      rows.map((r) => ({
        user_id: userId,
        color: r.color,
        label: r.label.trim() || COLOR_PRESETS.find((p) => p.color === r.color)!.label,
        description: r.description.trim() || null,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: 'user_id,color' },
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <HomeLink />
        <ThemedText type="subtitle">{t.settings.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {t.settings.subtitle}
        </ThemedText>

        {rows.map((r) => {
          const preset = COLOR_PRESETS.find((p) => p.color === r.color)!;
          return (
            <ThemedView key={r.color} style={styles.row}>
              <ThemedText style={styles.emoji}>{preset.emoji}</ThemedText>
              <ThemedView style={styles.fields}>
                <TextInput
                  style={[styles.labelInput, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement, color: theme.text }]}
                  value={r.label}
                  onChangeText={(v) => updateRow(r.color, { label: v })}
                  testID={`color-label-${r.color}`}
                />
                <TextInput
                  style={[styles.descInput, { borderColor: theme.backgroundSelected, backgroundColor: theme.backgroundElement, color: theme.text }]}
                  placeholder={t.settings.descriptionPlaceholder}
                  placeholderTextColor={theme.textSecondary}
                  value={r.description}
                  onChangeText={(v) => updateRow(r.color, { description: v })}
                  testID={`color-description-${r.color}`}
                />
              </ThemedView>
            </ThemedView>
          );
        })}

        <ThemedView style={styles.saveRow}>
          <Pressable style={styles.saveButton} onPress={saveAll} testID="settings-save-button">
            <ThemedText style={styles.saveButtonText}>{t.common.save}</ThemedText>
          </Pressable>
          {saved && (
            <ThemedText type="small" testID="settings-saved-indicator">
              {t.settings.saved}
            </ThemedText>
          )}
        </ThemedView>

        {/* アカウント削除（2026-07-31）。設定内で唯一の破壊的操作なので、
            大きな余白で他と隔離する（色ではなく余白で「別のもの」だと伝える） */}
        {session?.user && (
          <DeleteAccountPanel userId={session.user.id} email={session.user.email ?? ''} />
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  emoji: { fontSize: 22, lineHeight: 40 },
  fields: { flex: 1, gap: Spacing.one },
  labelInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontWeight: '600',
  },
  descInput: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
  },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  saveButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  saveButtonText: { color: '#fff', fontWeight: '600' },
});
