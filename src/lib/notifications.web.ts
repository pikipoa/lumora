/**
 * Web版のスタブ。expo-notificationsはWebターゲットでのバンドルに問題があるため
 * （Metro解決エラー：内部モジュールunregisterForNotificationsAsyncが解決できない）、
 * Web用エントリではexpo-notifications自体をimportしない。
 * Web版はそもそもローカル通知の対象外（notifications.native.ts参照）。
 */

export async function notifyReviewPending(_summaryLine: string): Promise<void> {
  // no-op（Web版は非対応）
}
