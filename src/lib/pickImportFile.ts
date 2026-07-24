/**
 * S1画面のファイル選択。expo-document-pickerで選び、
 * プラットフォーム差（Web=File/blob、ネイティブ=ファイルURI）を吸収して
 * インポート層の共通入力（ImportFile＝name+bytes）に変換する。
 */

import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import type { ImportFile } from '@/import';

// 対応形式（import-spec.md）のMIMEタイプ＋拡張子を明示する。
// typeを指定しない（デフォルト'*/*'）と、モバイルブラウザ（特にiOS Safari/Android Chrome）が
// 「カメラで撮影」「写真ライブラリ」中心のピッカーを優先表示し、Files/ドライブ等からの選択に
// たどり着きにくくなる不具合があった（2026-07-24、ピキさん実機報告）。具体的な拡張子・MIMEを
// 渡すことで、ブラウザ側にこれが写真・動画ではなく書類の選択であることを伝える。
const IMPORT_FILE_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/json',
  'text/plain',
  'text/markdown',
  '.zip',
  '.json',
  '.jsonl',
  '.md',
  '.markdown',
  '.txt',
];

export async function pickImportFile(): Promise<ImportFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: IMPORT_FILE_TYPES,
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled || !res.assets || res.assets.length === 0) return null;
  const asset = res.assets[0];

  if (Platform.OS === 'web') {
    // Webはpickerが返すFileオブジェクト（無ければblob: URIをfetch）から読む
    if (asset.file) {
      return { name: asset.name, bytes: new Uint8Array(await asset.file.arrayBuffer()) };
    }
    const resp = await fetch(asset.uri);
    return { name: asset.name, bytes: new Uint8Array(await resp.arrayBuffer()) };
  }

  const { File } = await import('expo-file-system');
  const file = new File(asset.uri);
  return { name: asset.name, bytes: await file.bytes() };
}
