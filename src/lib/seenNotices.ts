/**
 * 一度見せれば十分な案内（Web版の原本キャッシュ非対応など）の既読管理（2026-07-24）。
 * unlocks.tsのSeenFlagsと同じくDBで管理する（AsyncStorage/localStorageは端末単位で
 * 永続してしまい、別ブラウザ・別デバイスで再表示される不具合の原因になるため使わない）。
 */
import { supabase } from '@/lib/supabase';

export async function hasSeenNotice(userId: string, noticeKey: string): Promise<boolean> {
  const { data } = await supabase
    .from('seen_notices')
    .select('notice_key')
    .eq('user_id', userId)
    .eq('notice_key', noticeKey)
    .maybeSingle();
  return !!data;
}

export async function markNoticeSeen(userId: string, noticeKey: string): Promise<void> {
  await supabase.from('seen_notices').upsert({ user_id: userId, notice_key: noticeKey });
}
