/**
 * 型チェック用のエントリ（tscはMetroのプラットフォーム別解決を認識しないため）。
 * 実際のバンドルでは、Metroが常に`notifications.native.ts`（iOS/Android）
 * または`notifications.web.ts`（Web）を優先して解決するため、このファイルの
 * 実装が実行されることはない。
 */

export * from './notifications.native';
