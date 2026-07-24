/**
 * 常設の「Lumoraへ戻る」リンク。2026-07-11、Arcaに直接遷移した場合など
 * ナビゲーション履歴が無いとブラウザバック/画面内の「← 戻る」系リンクが機能せず
 * 詰んでしまう問題（ピキさん報告）を受けて全画面に追加した。
 * `router.back()`に頼らず常に`/`へ直接遷移するため、どこからでも必ずホームへ戻れる。
 */

import { useRouter } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { t } from '@/i18n';

export function HomeLink() {
  const router = useRouter();
  return (
    // 直下に別のボタン（保留一覧トグル等）が並ぶ画面が多く、隙間が狭いと誤タップで
    // 意図せずホームへ飛ばされる報告があった（2026-07-24）。marginBottomで実際の
    // 余白を広げつつ、hitSlopは下方向だけ広げず、隣接ボタンを侵食しないようにする
    <Pressable
      onPress={() => router.push('/')}
      hitSlop={{ top: 8, left: 8, right: 8 }}
      style={styles.link}
      testID="home-link"
    >
      <ThemedText type="small" themeColor="textSecondary">
        {t.brand.appName}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'flex-start', marginBottom: Spacing.two },
});
