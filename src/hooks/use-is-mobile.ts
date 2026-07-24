import { useWindowDimensions } from 'react-native';

// 下部タブバー等、モバイル幅限定のUIを出し分けるための共通ブレークポイント。
// デスクトップ幅ではHomeLink＋Home経由の既存導線をそのまま維持する（2026-07-24）。
const MOBILE_BREAKPOINT = 700;

export function useIsMobile(): boolean {
  const { width } = useWindowDimensions();
  return width < MOBILE_BREAKPOINT;
}
