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
 *
 * 【position:fixed に戻した経緯（2026-07-24、不具合修正）】expo-routerのStackは内部で
 * `StyleSheet.absoluteFill`を使って画面を描画する（React Navigation由来、flexの兄弟要素配置を
 * 無視する）。そのため「通常のflow内に置いて実スペースを占有させる」当初の実装は機能せず、
 * このバーがStackの描画内容の上に意図しない位置で乗ってしまい、「戻る」操作時に白い帯が
 * 一瞬見える不具合が起きていた（ピキさん実機報告）。position:fixedに戻し、コンテンツ側の
 * 余白は`_layout.tsx`側でこのバーと同じ表示条件を使って確保する（TAB_BAR_HEIGHTを共有）。
 */

import { usePathname, useRouter } from 'expo-router';
import { type ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ChronicleGlyph, RealmGlyph } from '@/components/type-icon';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SeenFlags } from '@/lib/unlocks';

export const TAB_BAR_HEIGHT = 72;

interface Props {
  seenFlags: SeenFlags;
}

export function BottomTabBar({ seenFlags }: Props) {
  const theme = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  const items: { key: string; href: '/' | '/chronicles' | '/projects' | '/settings'; Icon: (p: { size: number; color: string }) => ReactElement }[] = [
    { key: 'home', href: '/', Icon: HomeGlyph },
  ];
  if (seenFlags.arcaChronicle) items.push({ key: 'chronicle', href: '/chronicles', Icon: ChronicleGlyph });
  if (seenFlags.realm) items.push({ key: 'realm', href: '/projects', Icon: RealmGlyph });
  if (seenFlags.arcaChronicle) items.push({ key: 'settings', href: '/settings', Icon: SettingsGlyph });

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
  bar: {
    position: 'fixed',
    bottom: 0,
    left: 0,
    right: 0,
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    zIndex: 40,
    // 操作用のUIはテキスト選択の対象にしない（2026-08-02）。
    // このバーはposition:fixedで本文ScrollViewの下端より下に重なるため、本文を選択中に
    // ハンドルをここまでドラッグすると、アイコン（🏠/⚙）が選択に含まれてしまう。
    // すると選択の共通祖先が本文の外へ出て、オートスクロールも確定ロジックも
    // 「自分の担当外の選択」と判断して停止し、選択が途中で詰まる（実機で確認）。
    userSelect: 'none',
  } as object,
  item: { padding: Spacing.two },
});
