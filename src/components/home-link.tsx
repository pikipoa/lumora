/**
 * 常設の「Lumoraへ戻る」リンク。2026-07-11、Arcaに直接遷移した場合など
 * ナビゲーション履歴が無いとブラウザバック/画面内の「← 戻る」系リンクが機能せず
 * 詰んでしまう問題（ピキさん報告）を受けて全画面に追加した。
 * `router.back()`に頼らず常に`/`へ直接遷移するため、どこからでも必ずホームへ戻れる。
 */

import { useRouter } from 'expo-router';
import { Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';

export function HomeLink() {
  const router = useRouter();
  return (
    <Pressable onPress={() => router.push('/')} testID="home-link">
      <ThemedText type="small" themeColor="textSecondary">
        Lumora
      </ThemedText>
    </Pressable>
  );
}
