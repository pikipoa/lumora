/**
 * S7 マーカーレビューモード（S6内のサブモード）。proposedマーカーを1件ずつ連続で
 * 承認/却下する専用画面（ux-flow-and-screens.md §2-3b）。
 *
 * デバイス分岐はフロントエンドのみ（バックエンドAPI・確定ロジックはS6と共通）：
 * - タップ操作（スマホ/PC共通）：色ボタンで確定、却下ボタンで却下
 * - PCキーボード：j/k(または↓/↑)で移動、1-5で色を選んで確定、X/Backspaceで却下、
 *   確定直後のRole選択は1-5、Escapeでスキップ
 * - 範囲調整はS6と同じくブラウザ標準Selection APIのネイティブドラッグハンドルに任せる
 *
 * 「すべて承認」ボタンは実装しない（Phase1 Non-goal、ux-flow-and-screens.md 論点E）。
 * 本実装ではスワイプジェスチャーのアニメーションまでは作り込まず、却下ボタン/Xキーで
 * 同じ操作を提供する（機能的に同等のため。判断理由：CLAUDE.md 2-5、影響小）。
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { offsetsToRange, rangeToOffsets } from '@/lib/domSelection';
import { supabase } from '@/lib/supabase';

const MARKER_COLORS = [
  { key: 'pink', hex: '#FF4FA3' },
  { key: 'green', hex: '#3DDC84' },
  { key: 'yellow', hex: '#FFD23D' },
  { key: 'blue', hex: '#3D9CFF' },
  { key: 'red', hex: '#FF4D4D' },
] as const;

const ROLE_OPTIONS = [
  { key: 'idea', emoji: '💡', label: 'idea' },
  { key: 'hypothesis', emoji: '🔭', label: 'hypothesis' },
  { key: 'decision', emoji: '📌', label: 'decision' },
  { key: 'strategy', emoji: '⚔️', label: 'strategy' },
  { key: 'learning', emoji: '📚', label: 'learning' },
] as const;

const CONTEXT_WINDOW = 80;

interface QueueItem {
  markerId: string;
  messageId: string;
  content: string;
  start: number;
  end: number;
}

export default function MarkerReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [phase, setPhase] = useState<'reviewing' | 'role'>('reviewing');
  const [lastConfirmedMarkerId, setLastConfirmedMarkerId] = useState<string | null>(null);
  const containerRef = useRef<View | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [{ data: msgs }, { data: mks }] = await Promise.all([
      supabase.from('messages').select('id, content, seq').eq('conversation_id', id).order('seq'),
      supabase
        .from('markers')
        .select('id, message_id, quoted_text')
        .eq('conversation_id', id)
        .eq('status', 'proposed'),
    ]);
    const messageById = new Map((msgs ?? []).map((m) => [m.id, m]));
    const items: QueueItem[] = [];
    for (const marker of mks ?? []) {
      const message = messageById.get(marker.message_id);
      if (!message) continue;
      const idx = message.content.indexOf(marker.quoted_text);
      if (idx === -1) continue;
      items.push({
        markerId: marker.id,
        messageId: marker.message_id,
        content: message.content,
        start: idx,
        end: idx + marker.quoted_text.length,
      });
    }
    // メッセージのseq順→本文内の出現位置順に並べる
    items.sort((a, b) => {
      const ma = messageById.get(a.messageId)!;
      const mb = messageById.get(b.messageId)!;
      return ma.seq - mb.seq || a.start - b.start;
    });
    setQueue(items);
    setIndex(0);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const current = queue && index < queue.length ? queue[index] : null;

  // カードが切り替わったら、そのマーカーの範囲を選択状態として復元する
  useEffect(() => {
    setPhase('reviewing');
    if (!current) {
      setRange(null);
      return;
    }
    setRange({ start: current.start, end: current.end });
    if (Platform.OS !== 'web') return;
    const view = containerRef.current as unknown as HTMLElement | null;
    if (!view) return;
    const domRange = offsetsToRange(view, current.start, current.end);
    if (!domRange) return;
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(domRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.markerId]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !current) return;
    function onSelectionChange() {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const view = containerRef.current as unknown as HTMLElement | null;
      if (!view) return;
      const domRange = sel.getRangeAt(0);
      if (!view.contains(domRange.commonAncestorContainer)) return;
      const { start, end } = rangeToOffsets(view, domRange);
      setRange({ start, end });
    }
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [current]);

  async function recordMarkerHistory(markerId: string, color: string | null, status: string) {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes.user?.id;
    if (!userId) return;
    await supabase.from('marker_history').insert({ marker_id: markerId, color, status, user_id: userId });
  }

  const goNext = useCallback(() => setIndex((i) => i + 1), []);
  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const confirmWithColor = useCallback(
    async (colorKey: string) => {
      if (!current || !range) return;
      const quotedText = current.content.slice(range.start, range.end);
      if (!quotedText) return;
      await supabase.from('markers').update({ quoted_text: quotedText, color: colorKey, status: 'confirmed' }).eq('id', current.markerId);
      await recordMarkerHistory(current.markerId, colorKey, 'confirmed');
      setLastConfirmedMarkerId(current.markerId);
      setPhase('role');
    },
    [current, range],
  );

  const setRoleAndAdvance = useCallback(
    async (roleKey: string | null) => {
      if (lastConfirmedMarkerId && roleKey) {
        await supabase.from('markers').update({ role_tag: roleKey }).eq('id', lastConfirmedMarkerId);
      }
      setLastConfirmedMarkerId(null);
      goNext();
    },
    [lastConfirmedMarkerId, goNext],
  );

  const reject = useCallback(async () => {
    if (!current) return;
    await supabase.from('markers').update({ status: 'rejected' }).eq('id', current.markerId);
    await recordMarkerHistory(current.markerId, null, 'rejected');
    goNext();
  }, [current, goNext]);

  // PCキーボードショートカット（ux-flow-and-screens.md §2-3b PC版）
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    function onKeyDown(e: KeyboardEvent) {
      if (phase === 'role') {
        const roleIdx = ['1', '2', '3', '4', '5'].indexOf(e.key);
        if (roleIdx !== -1) {
          e.preventDefault();
          setRoleAndAdvance(ROLE_OPTIONS[roleIdx].key);
        } else if (e.key === 'Escape' || e.key === 'Enter' || e.key === '0') {
          e.preventDefault();
          setRoleAndAdvance(null);
        }
        return;
      }
      if (e.shiftKey) return; // Shift+矢印はブラウザ標準の選択伸縮に任せる
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        goPrev();
      } else if (e.key === 'x' || e.key === 'X' || e.key === 'Backspace') {
        e.preventDefault();
        reject();
      } else {
        const colorIdx = ['1', '2', '3', '4', '5'].indexOf(e.key);
        if (colorIdx !== -1) {
          e.preventDefault();
          confirmWithColor(MARKER_COLORS[colorIdx].key);
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [phase, goNext, goPrev, reject, confirmWithColor, setRoleAndAdvance]);

  const snippet = useMemo(() => {
    if (!current || !range) return null;
    const before = current.content.slice(Math.max(0, range.start - CONTEXT_WINDOW), range.start);
    const mid = current.content.slice(range.start, range.end);
    const after = current.content.slice(range.end, range.end + CONTEXT_WINDOW);
    return {
      before: (range.start > CONTEXT_WINDOW ? '…' : '') + before,
      mid,
      after: after + (range.end + CONTEXT_WINDOW < current.content.length ? '…' : ''),
    };
  }, [current, range]);

  if (queue === null) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator style={{ marginTop: Spacing.five }} />
      </ThemedView>
    );
  }

  if (!current) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.content}>
          <ThemedText type="subtitle">レビュー完了</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            提案中のマーカーはすべてレビューしました。
          </ThemedText>
          <Pressable
            style={styles.smallButton}
            onPress={() => router.push({ pathname: '/conversation/[id]/index', params: { id: id! } })}
            testID="back-to-conversation"
          >
            <ThemedText style={styles.smallButtonText}>会話詳細に戻る</ThemedText>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        <Pressable onPress={() => router.back()} testID="back-button">
          <ThemedText type="link">← 会話詳細に戻る</ThemedText>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary">
          カード {index + 1}/{queue.length}
        </ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <View
            ref={(el) => {
              containerRef.current = el;
            }}
          >
            {snippet && (
              <Text selectable style={styles.snippetText}>
                <Text style={styles.contextText}>{snippet.before}</Text>
                <Text style={styles.highlight}>{snippet.mid}</Text>
                <Text style={styles.contextText}>{snippet.after}</Text>
              </Text>
            )}
          </View>

          {phase === 'reviewing' ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                範囲をドラッグして調整→色をタップで確定
              </ThemedText>
              <ThemedView style={styles.row}>
                <Pressable style={styles.smallButtonOutline} onPress={reject} testID="review-reject-button">
                  <ThemedText type="small">← 却下</ThemedText>
                </Pressable>
                {MARKER_COLORS.map((c) => (
                  <Pressable
                    key={c.key}
                    style={[styles.swatch, { backgroundColor: c.hex }]}
                    onPress={() => confirmWithColor(c.key)}
                    testID={`review-color-${c.key}`}
                  />
                ))}
              </ThemedView>
            </>
          ) : (
            <>
              <ThemedText type="small">Roleを選ぶ（任意・スキップ可）</ThemedText>
              <ThemedView style={styles.row}>
                {ROLE_OPTIONS.map((r) => (
                  <Pressable
                    key={r.key}
                    style={styles.smallButtonOutline}
                    onPress={() => setRoleAndAdvance(r.key)}
                    testID={`review-role-${r.key}`}
                  >
                    <ThemedText type="small">
                      {r.emoji} {r.label}
                    </ThemedText>
                  </Pressable>
                ))}
                <Pressable style={styles.smallButtonOutline} onPress={() => setRoleAndAdvance(null)} testID="review-role-skip">
                  <ThemedText type="small">スキップ</ThemedText>
                </Pressable>
              </ThemedView>
            </>
          )}
        </ThemedView>

        {Platform.OS === 'web' && (
          <ThemedText type="small" themeColor="textSecondary">
            PC操作: j/k または ↓/↑ で移動、Shift+←/→ で範囲調整、1-5で色を選んで確定、X/Backspaceで却下
          </ThemedText>
        )}
      </View>
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
  card: { borderRadius: Spacing.three, padding: Spacing.four, gap: Spacing.three },
  snippetText: { fontSize: 16, lineHeight: 26 },
  contextText: { opacity: 0.5 },
  highlight: { backgroundColor: '#FFD23D88' },
  row: { flexDirection: 'row', gap: Spacing.two, alignItems: 'center', flexWrap: 'wrap' },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#00000022' },
  smallButton: {
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    alignSelf: 'flex-start',
  },
  smallButtonText: { color: '#fff', fontWeight: '600' },
  smallButtonOutline: {
    borderWidth: 1,
    borderColor: '#999',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
    alignSelf: 'flex-start',
  },
});
