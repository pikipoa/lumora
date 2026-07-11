/**
 * 「知識世界が解放された」演出オーバーレイ。進化するホーム画面（2026-07-11）の一部。
 * 詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-11 進化するホーム画面（Progressive Unlock UI）」
 *
 * 1〜2枚のカードを配列で受け取り、「閉じる」で次のカード（複数ある場合）へ進む。
 * 全カードを閉じ終わるとonDoneを呼ぶ。絶対配置のオーバーレイとして実装し、
 * react-native-webのModal互換性に依存しない（このコードベースは他画面もModalを使っていない）。
 */

import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { CelebrationCard } from '@/lib/unlocks';

interface Props {
  cards: CelebrationCard[];
  onDone: () => void;
}

export function UnlockCelebration({ cards, onDone }: Props) {
  const [index, setIndex] = useState(0);
  if (cards.length === 0) return null;
  const card = cards[index];

  function next() {
    if (index + 1 < cards.length) {
      setIndex(index + 1);
    } else {
      onDone();
    }
  }

  return (
    <ThemedView style={styles.overlay} testID="unlock-celebration">
      <ThemedView type="backgroundElement" style={styles.card}>
        <ThemedText style={styles.badge}>New</ThemedText>
        <ThemedText style={styles.emoji}>{card.emoji}</ThemedText>
        <ThemedText type="subtitle">{card.title}</ThemedText>
        <ThemedText type="small" style={styles.body}>
          {card.body}
        </ThemedText>
        <Pressable style={styles.button} onPress={next} testID="unlock-celebration-dismiss">
          <ThemedText style={styles.buttonText}>
            {index + 1 < cards.length ? '次へ' : '閉じる'}
          </ThemedText>
        </Pressable>
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    padding: Spacing.four,
  },
  card: {
    borderRadius: Spacing.four,
    padding: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
    maxWidth: 360,
    width: '100%',
  },
  badge: { opacity: 0.6, fontWeight: '700', letterSpacing: 2, textTransform: 'uppercase' },
  emoji: { fontSize: 48, lineHeight: 56 },
  body: { textAlign: 'center' },
  button: {
    marginTop: Spacing.three,
    backgroundColor: '#208AEF',
    borderRadius: Spacing.two,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.five,
  },
  buttonText: { color: '#fff', fontWeight: '600' },
});
