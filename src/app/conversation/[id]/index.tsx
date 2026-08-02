/**
 * S6 会話詳細（Chronicle本体）。横断検索（S8）から辿り着き、本文を選択してマーカーを作る主戦場。
 *
 * 【検索結果ピーク機能（2026-07-12）】本文表示・マーカー作成・Realm選択のロジックは
 * `ConversationMarkerWorkspace`（src/components/conversation-marker-workspace.tsx）へ
 * 抽出した。検索結果からのボトムシート（conversation-peek-sheet.tsx）と共通化するため。
 * このファイルはHomeLink・戻るリンク・メモ機能のみを持つ薄いラッパーになった。
 * 詳細：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-12 検索結果からのマーカー作成UX改善（ピーク/ボトムシート化）」
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ConversationMarkerWorkspace } from '@/components/conversation-marker-workspace';
import { HomeLink } from '@/components/home-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';

interface MemoRow {
  id: string;
  body: string;
}

export default function ConversationDetailScreen() {
  const theme = useTheme();
  const { id, markerId: jumpToMarkerId } = useLocalSearchParams<{ id: string; markerId?: string }>();
  const router = useRouter();

  const [conversationFound, setConversationFound] = useState<boolean | null>(null);
  const [memo, setMemo] = useState<MemoRow | null>(null);
  const [memoLoaded, setMemoLoaded] = useState(false);
  const [memoDraft, setMemoDraft] = useState('');
  const [memoSaved, setMemoSaved] = useState(false);

  async function loadMemo() {
    if (!id) return;
    const { data } = await supabase
      .from('memos')
      .select('id, body')
      .eq('target_type', 'conversation')
      .eq('target_id', id)
      .maybeSingle();
    setMemo(data ?? null);
    setMemoDraft(data?.body ?? '');
    setMemoLoaded(true);
  }

  async function saveMemo() {
    if (!id) return;
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;

    if (memo) {
      await supabase.from('memos').update({ body: memoDraft, updated_at: new Date().toISOString() }).eq('id', memo.id);
    } else if (memoDraft.trim()) {
      await supabase
        .from('memos')
        .insert({ target_type: 'conversation', target_id: id, body: memoDraft, user_id: userId });
    } else {
      return; // 空のまま保存しても何もすることが無いので、フィードバックも出さない
    }
    await loadMemo();
    setMemoSaved(true);
    setTimeout(() => setMemoSaved(false), 2000);
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.page}>
        {/* 長い会話をどこまでスクロールしても戻れるよう、ヘッダーはスクロール領域の外に固定する
            （2026-07-22、長大な会話の最下部からトップへ戻れない不具合の修正） */}
        <View style={styles.headerRow}>
          <HomeLink />
          <Pressable onPress={() => router.back()} testID="back-button">
            <ThemedText type="link">{t.common.back}</ThemedText>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <ConversationMarkerWorkspace
            conversationId={id}
            jumpToMarkerId={jumpToMarkerId}
            onLoaded={(c) => {
              setConversationFound(!!c);
              if (c && !memoLoaded) loadMemo();
            }}
          />

          {conversationFound && (
            <ThemedView type="backgroundElement" style={styles.section}>
              <ThemedText type="smallBold">{t.conversation.memoTitle}</ThemedText>
              <TextInput
                style={[styles.textArea, { borderColor: theme.backgroundSelected, backgroundColor: theme.background, color: theme.text }]}
                placeholderTextColor={theme.textSecondary}
                value={memoDraft}
                onChangeText={(text) => {
                  setMemoDraft(text);
                  setMemoSaved(false);
                }}
                multiline
                placeholder={t.conversation.memoPlaceholder}
                testID="memo-input"
              />
              <ThemedView style={styles.row}>
                <Pressable style={styles.smallButton} onPress={saveMemo} testID="memo-save-button">
                  <ThemedText style={styles.smallButtonText}>{t.common.save}</ThemedText>
                </Pressable>
                {memoSaved && (
                  <ThemedText type="small" testID="memo-saved-indicator">
                    {t.conversation.memoSaved}
                  </ThemedText>
                )}
              </ThemedView>
            </ThemedView>
          )}
        </ScrollView>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  page: { flex: 1, width: '100%', maxWidth: MaxContentWidth },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
    // 操作用のUIはテキスト選択の対象にしない（2026-08-02）。
    // このヘッダーはスクロール領域の外に固定されているため、本文を上方向へ選択していくと
    // ハンドルがここへ到達し、リンク文字が選択に含まれて選択が本文の外へ出てしまう
    // （下部タブバーで起きたのと同じ症状。bottom-tab-bar.tsx参照）
    userSelect: 'none',
  },
  content: {
    padding: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.three,
  },
  section: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center' },
  textArea: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  smallButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    alignSelf: 'flex-start',
  },
  smallButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
});
