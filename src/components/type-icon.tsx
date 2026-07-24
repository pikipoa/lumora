/**
 * Realm/Chronicle/Beaconの型アイコン（VISION.md 8章）。
 *
 * Unicode文字（○/□等）は縦横比がフォントのグリフデザイン依存で保証されないため
 * 採用しなかった（type="subtitle"のfontSize 32で□が潰れて見える不具合が実際にあった）。
 * SVGでベクター描画することで比率を保証し、双三角錐のような複雑な形も描ける。
 *
 * アニメーションは形ごとに意味を変える（DESIGN.md原則5「Motion Has Meaning」）：
 * - Realm（○）：波紋+弾む＝「世界に入る」
 * - Chronicle（□）：ページがめくれる＝「記録を開く」
 * - Beacon（◇◇双三角錐）：形のみ実装済み。検索中の演出（三角が離れて逆回転、
 *   中央に光が集まる）はBeacon機能自体がPhase2未実装のため、着手時に設計する
 *   （CLAUDE.md 2-2「思弁的な機能を先回りして実装しない」）
 *
 * pressTriggerが渡された場合のみ、値が変わるたびに演出を1回再生する
 * （Pressableの中で使う場合はonPressInでカウンタをインクリメントする。
 * 一覧見出しのような非インタラクティブな文脈ではpressTriggerを渡さず静的に表示する）。
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

interface TypeIconProps {
  size?: number;
  color: string;
  pressTrigger?: number;
}

/** Realm：円（自分が育てる世界のイメージ）。押すと波紋が広がり、軽く弾む */
export function RealmIcon({ size = 16, color, pressTrigger }: TypeIconProps) {
  const scale = useSharedValue(1);
  const ripple = useSharedValue(0);

  useEffect(() => {
    if (pressTrigger === undefined) return;
    scale.value = withSequence(
      withTiming(1.25, { duration: 140, easing: Easing.out(Easing.quad) }),
      withTiming(1, { duration: 220, easing: Easing.out(Easing.back(2)) }),
    );
    ripple.value = 0;
    ripple.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressTrigger]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: (1 - ripple.value) * 0.5,
    transform: [{ scale: 1 + ripple.value * 0.9 }],
  }));

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.View style={[styles.ring, rippleStyle, { borderColor: color, width: size, height: size }]} />
      <Animated.View style={iconStyle}>
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.6} />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** Chronicle：正方形（本のページのイメージ）。押すとページをめくるように開く */
export function ChronicleIcon({ size = 16, color, pressTrigger }: TypeIconProps) {
  const scaleX = useSharedValue(1);

  useEffect(() => {
    if (pressTrigger === undefined) return;
    scaleX.value = withSequence(
      withTiming(0.15, { duration: 180, easing: Easing.in(Easing.quad) }),
      withTiming(1, { duration: 220, easing: Easing.out(Easing.quad) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pressTrigger]);

  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: scaleX.value }] }));

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Animated.View style={iconStyle}>
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x={4} y={4} width={16} height={16} stroke={color} strokeWidth={1.6} />
        </Svg>
      </Animated.View>
    </View>
  );
}

/**
 * RealmIcon/ChronicleIconの静止版（アニメーションなし）。
 *
 * 【2026-07-24、不具合修正】react-native-reanimatedのAnimated.Viewが、条件付きレンダーで
 * 大きなサブツリーごと一括アンマウントされる文脈（例：Realm詳細画面のWing表示⇄Realm概要の
 * 切り替え、下部タブバーの項目リスト変化）に置かれると、React側のDOM除去とReanimated側の
 * Web実装（DOM要素を直接操作するworklet相当の仕組み）が競合し、
 * `NotFoundError: Failed to execute 'removeChild' on 'Node'`で画面全体がクラッシュする
 * 不具合が実機で確認された（Sentryのスタックトレースで特定）。pressTriggerを渡さず
 * アニメーション自体を使わない箇所（Wingカードのインラインアイコン、下部タブバーの
 * ナビゲーションアイコン等）では、この静止版を使うことでReanimatedへの依存を断ち切る。
 * pressTriggerで実際に演出させたい箇所（ホーム画面の統計行）は引き続きRealmIcon/
 * ChronicleIconを使う。
 */
export function RealmGlyph({ size = 16, color }: { size?: number; color: string }) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={1.6} />
      </Svg>
    </View>
  );
}

export function ChronicleGlyph({ size = 16, color }: { size?: number; color: string }) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Rect x={4} y={4} width={16} height={16} stroke={color} strokeWidth={1.6} />
      </Svg>
    </View>
  );
}

/**
 * Beacon（Phase2バックログ、VISION.md 9章）：双三角錐。形のみ実装済み。
 * Beacon機能自体がまだ存在しないため、どの画面からも呼ばれていない（未使用エクスポート）。
 * 検索中の演出（上下の三角が離れて逆回転、中央に光が集まる）はBeacon着手時に設計する。
 */
export function BeaconIcon({ size = 16, color }: TypeIconProps) {
  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <Path d="M12 2 L20 12 L12 22 L4 12 Z M4 12 L20 12" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center' },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1.2,
  },
});
