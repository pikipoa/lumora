/**
 * S1（インポート実行）→S2（完了サマリー）への結果受け渡し用の一時ストア。
 * サマリーは大きくなりうるためルーターのパラメータではなくメモリで渡す。
 * （永続データはimport_batchesテーブルにあり、これは画面遷移用のキャッシュ）
 */

import type { ImportRunSummary } from '@/lib/importService';

let last: ImportRunSummary | null = null;

export function setLastImportSummary(summary: ImportRunSummary): void {
  last = summary;
}

export function getLastImportSummary(): ImportRunSummary | null {
  return last;
}
