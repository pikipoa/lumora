/**
 * モバイル幅限定の下部タブバー（2026-07-24、DESIGN.md Implementation Rulesレビュー承認済み）。
 *
 * アイコンのみ・テキストラベルなし・枠線/影なし。Homeは常時表示、Chronicle/Realmは
 * 既存の解放システム（unlocks.ts）と同じ判定で解放後にのみ現れる。Settingsは唯一の機能
 * （マーカー色の意味登録）がマーカーを引いた後でないと意味を持たないため、Chronicleと
 * 同じ解放タイミング（最初のマーカー確定）に揃えた。解放が1つも無い間はタブバー自体を
 * 描画しない（Remove Before Add＝Day1は検索のみのホームのまま）。
 *
 * デスクトップ幅ではこのバーは出さず、既存のHomeLink＋Home経由の導線を維持する
 * （settings-ia.md「1. エントリーポイント」参照。デスクトップはHome右上の歯車アイコン）。
 */

import { usePathname, useRouter } from 'expo-router';
import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChronicleIcon, RealmIcon } from '@/components/type-icon';
import { Spacing } from '@/constants/theme';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth-context';
import { getSeenFlags, type SeenFlags } from '@/lib/unlocks';

export function BottomTabBar() {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { session } = useAuth();
  const [seenFlags, setSeenFlags] = useState<SeenFlags | null>(null);

  useEffect(() => {
    if (session) getSeenFlags(session.user.id).then(setSeenFlags);
  }, [session, pathname]);

  if (!isMobile || !session || !seenFlags) return null;

  const items: { key: string; href: '/' | '/chronicles' | '/projects' | '/settings'; Icon: (p: { size: number; color: string }) => ReactElement }[] = [
    { key: 'home', href: '/', Icon: HomeGlyph },
  ];
  if (seenFlags.arcaChronicle) items.push({ key: 'chronicle', href: '/chronicles', Icon: ChronicleIcon });
  if (seenFlags.realm) items.push({ key: 'realm', href: '/projects', Icon: RealmIcon });
  if (seenFlags.arcaChronicle) items.push({ key: 'settings', href: '/settings', Icon: SettingsGlyph });

  // 何も解放していない間はバー自体を出さない（Homeだけでは並び替えの意味が無いため）
  if (items.length <= 1) return null;

  return (
    <View style={[styles.bar, { backgroundColor: theme.background }]}>
      {items.map(({ key, href, Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Pressable key={key} onPress={() => router.push(href)} style={styles.item} testID={`tab-${key}`}>
            <Icon size={22} color={active ? theme.text : theme.textSecondary} />
          </Pressable>
        );
      })}
    </View>
  );
}

function HomeGlyph({ size, color }: { size: number; color: string }) {
  return <ThemedText style={{ fontSize: size, color, lineHeight: size + 4 }}>🏠</ThemedText>;
}

function SettingsGlyph({ size, color }: { size: number; color: string }) {
  return <ThemedText style={{ fontSize: size, color, lineHeight: size + 4 }}>⚙</ThemedText>;
}

const styles = StyleSheet.create({
  // 通常のflow内に置く（position:fixedにしない）。画面ごとにボトム余白を
  // 個別追加せずに済むよう、タブバー自体が実スペースを占有してコンテンツを押し上げる
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: Spacing.three,
    paddingBottom: Spacing.four,
  },
  item: { padding: Spacing.two },
});
