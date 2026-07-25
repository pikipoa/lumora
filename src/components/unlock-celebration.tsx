/**
 * 「知識世界が解放された」演出オーバーレイ。docs/DESIGN.md準拠の静音版（2026-07-11再設計）。
 *
 * 設計判断（レビュー承認済み）：黒背景＋青ボタンのモーダルカードをやめ、
 * テーマ色に沿った半透明の全面オーバーレイ＋タイポグラフィのみで構成する。
 * フェードイン/アウトは状態変化（解放された）を伝えるためだけの最小のモーション
 * （DESIGN.md「Motion Has Meaning」）。画面のどこをタップしても次へ進む。
 * 1〜2枚のカードを配列で受け取り、全て見終わるとonDoneを呼ぶ。
 */

import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, useColorScheme } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { t } from '@/i18n';
import type { CelebrationCard } from '@/lib/unlocks';

interface Props {
  cards: CelebrationCard[];
  onDone: () => void;
}

export function UnlockCelebration({ cards, onDone }: Props) {
  const [index, setIndex] = useState(0);
  // useRef(...).currentではなくuseStateの遅延初期化を使う（2026-07-24、lint対応。
  // 詳細はconversation-peek-sheet.tsxの同種コメント参照）
  const [opacity] = useState(() => new Animated.Value(0));
  const scheme = useColorScheme();

  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [opacity]);

  if (cards.length === 0) return null;
  const card = cards[index];

  function next() {
    if (index + 1 < cards.length) {
      setIndex(index + 1);
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => onDone());
    }
  }

  const overlayColor = scheme === 'dark' ? 'rgba(0,0,0,0.92)' : 'rgba(255,255,255,0.94)';

  return (
    <Animated.View style={[styles.overlay, { opacity, backgroundColor: overlayColor }]} testID="unlock-celebration">
      <Pressable style={styles.pressable} onPress={next} testID="unlock-celebration-dismiss">
        <ThemedText themeColor="textSecondary" style={styles.badge}>
          {t.celebrations.newLabel}
        </ThemedText>
        <ThemedText style={styles.emoji}>{card.emoji}</ThemedText>
        <ThemedText type="subtitle">{card.title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
          {card.body}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.hint}>
          {index + 1 < cards.length ? t.celebrations.tapNext : t.celebrations.tapClose}
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 100,
  },
  pressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.five,
  },
  badge: { fontSize: 11, fontWeight: '600', letterSpacing: 3 },
  emoji: { fontSize: 40, lineHeight: 48 },
  body: { textAlign: 'center', maxWidth: 320 },
  hint: { marginTop: Spacing.five, opacity: 0.6 },
});
