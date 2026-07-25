/**
 * 検索結果から「元の会話の該当位置」を一瞬で覗きに行くボトムシート（2026-07-12）。
 *
 * 背景：検索結果のスニペットだけでは文脈を誤読し、意味が逆転した文にマーカーを
 * 付けてしまう危険がある。フルページ遷移だと検索結果への往復コストも重い。
 * 本コンポーネントは`search.tsx`のScrollViewをアンマウントしない兄弟要素の
 * オーバーレイとして重なるため、閉じれば検索結果のスクロール位置・並び替え状態は
 * 何もしなくてもそのまま保たれる。実装パターンは`unlock-celebration.tsx`の
 * 「position:absoluteで親いっぱいに重ねる」手法を踏襲し、フェードではなく
 * translateYでスライドインさせる。
 *
 * マーカー作成本体は`ConversationMarkerWorkspace`にそのまま委譲する（S6フルページと
 * 共通のコード。Selection API連携を2箇所に分岐させない）。
 * 詳細：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-12 検索結果からのマーカー作成UX改善（ピーク/ボトムシート化）」
 */

import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Animated, Dimensions, Pressable, ScrollView, StyleSheet, useColorScheme } from 'react-native';

import { ConversationMarkerWorkspace } from '@/components/conversation-marker-workspace';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { t } from '@/i18n';

interface Props {
  conversationId: string;
  searchTerm: string;
  onClose: () => void;
}

export function ConversationPeekSheet({ conversationId, searchTerm, onClose }: Props) {
  const router = useRouter();
  const scheme = useColorScheme();
  // useRef(...).currentではなくuseStateの遅延初期化を使う（2026-07-24、lint対応）。
  // Animated.Valueを1回だけ作って以後は同じインスタンスを使い回すという意図は同じだが、
  // render中のref.currentアクセスは新しいReact Compilerのreact-hooks/refsルールに
  // 抵触するため、render中に読んでも安全なuseStateの値として持つ
  const [translateY] = useState(() => new Animated.Value(Dimensions.get('window').height));
  const [backdropOpacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0, duration: 260, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
    ]).start();
  }, [translateY, backdropOpacity]);

  function handleClose() {
    Animated.parallel([
      Animated.timing(translateY, { toValue: Dimensions.get('window').height, duration: 200, useNativeDriver: true }),
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onClose());
  }

  const backdropColor = scheme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)';

  return (
    <ThemedView style={styles.overlay} testID="conversation-peek-sheet">
      <Animated.View style={[styles.backdrop, { backgroundColor: backdropColor, opacity: backdropOpacity }]}>
        <Pressable style={styles.backdropPressable} onPress={handleClose} testID="peek-sheet-backdrop" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <ThemedView type="background" style={styles.sheetInner}>
          <ScrollView contentContainerStyle={styles.content}>
            <ThemedView style={styles.header}>
              <Pressable onPress={handleClose} testID="peek-sheet-close">
                <ThemedText type="link">{t.searchScreen.peekClose}</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => router.push({ pathname: '/conversation/[id]', params: { id: conversationId } })}
                testID="peek-sheet-view-full"
              >
                <ThemedText type="small" themeColor="textSecondary">
                  {t.searchScreen.peekViewFull}
                </ThemedText>
              </Pressable>
            </ThemedView>
            <ConversationMarkerWorkspace conversationId={conversationId} searchTerm={searchTerm} compact />
          </ScrollView>
        </ThemedView>
      </Animated.View>
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
    zIndex: 100,
    backgroundColor: 'transparent',
  },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  backdropPressable: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: '10%',
  },
  sheetInner: {
    flex: 1,
    borderTopLeftRadius: Spacing.four,
    borderTopRightRadius: Spacing.four,
    overflow: 'hidden',
  },
  content: {
    maxWidth: MaxContentWidth,
    width: '100%',
    alignSelf: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
