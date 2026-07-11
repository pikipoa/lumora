/**
 * 「レビュー待ち」ローカル通知（VISION.md「確定済みの主要判断」表）。
 *
 * 【外部送信の明示】通知そのものはローカル通知（端末内で完結、リモートプッシュ基盤は
 * 使わない）のため、この機能によって外部にデータが送信されることはない。
 *
 * AIジョブは手動起動＋画面内で結果を即時表示する設計（Step4決定）のため、
 * 「今まさに見ている画面の結果」を重ねて通知しても冗長になる。それでも「薄い実装」
 * としてジョブ完了直後に1件だけ通知する構成にしている（VISION.mdの素朴な要求を
 * そのまま満たす最小実装）。将来、未レビュー件数が溜まった時のリマインダー通知を
 * 追加する場合は、この関数をそのまま流用できる設計にしてある。
 *
 * 注意：本機の開発環境（Windows、実機/シミュレータ無し）ではローカル通知の
 * 実配信を検証できていない。ExpoのAPI仕様に基づいて実装したのみで、
 * 実機（iOS/Android）での動作確認が別途必要。
 *
 * Web版は`notifications.web.ts`（no-opスタブ）が使われる。expo-notificationsは
 * Webターゲットのバンドルに失敗するため、Metroのプラットフォーム別解決
 * （*.native.ts / *.web.ts）でWeb側からこのファイルを完全に除外している。
 */

import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let permissionRequested = false;

async function ensurePermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (permissionRequested) return false;
  permissionRequested = true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function notifyReviewPending(summaryLine: string): Promise<void> {
  const granted = await ensurePermission();
  if (!granted) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'レビュー待ちがあります',
      body: summaryLine,
    },
    trigger: null, // 即時通知
  });
}
