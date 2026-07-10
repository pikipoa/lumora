/**
 * S1画面のファイル選択。expo-document-pickerで選び、
 * プラットフォーム差（Web=File/blob、ネイティブ=ファイルURI）を吸収して
 * インポート層の共通入力（ImportFile＝name+bytes）に変換する。
 */

import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

import type { ImportFile } from '@/import';

export async function pickImportFile(): Promise<ImportFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
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
