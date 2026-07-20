/**
 * 進化するホーム画面（2026-07-11）のUnlock状態モデル。
 * 詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-11 進化するホーム画面（Progressive Unlock UI）」
 *
 * DBの実データから毎回導出する「現在値」（loadUnlockCounts）と、DBに永続化する
 * 「既読フラグ」（getSeenFlags/markSeen、一度trueになったら戻らない）の2層構成。
 * 一度解放したセクションは、対象データが後で0件に戻っても再び隠さない設計（ゲーム的な
 * 「成長は後退しない」感覚を優先する明示的な判断）。
 *
 * 【不具合修正（2026-07-13）】既読フラグは元々AsyncStorage（Web版はlocalStorage、端末/オリジン
 * 単位）に保存していたが、これはアカウント単位で永続すべき状態を端末単位の一時的な保存先に
 * 置いていた設計ミスだった。ログアウト→再ログイン（別ブラウザ・別デバイス・localStorage消去等）
 * のたびに既読フラグだけが消え、Realm等の解放演出が毎回再表示される不具合の原因になっていたため、
 * `unlock_flags`テーブル（DB）へ移した。マイグレーション：`20260713000001_unlock_flags.sql`。
 */

import { t } from '@/i18n';
import { supabase } from '@/lib/supabase';

export interface UnlockCounts {
  hasConversations: boolean;
  markerCount: number;
  chronicleCount: number;
  hasConfirmedMarker: boolean;
  realmCount: number;
  hasRealmAssignedMarker: boolean;
}

export interface SeenFlags {
  arcaChronicle: boolean;
  realm: boolean;
}

const DEFAULT_SEEN_FLAGS: SeenFlags = { arcaChronicle: false, realm: false };

const SEEN_FLAG_COLUMNS: Record<keyof SeenFlags, 'arca_chronicle' | 'realm'> = {
  arcaChronicle: 'arca_chronicle',
  realm: 'realm',
};

export async function loadUnlockCounts(): Promise<UnlockCounts> {
  const [{ count: conversationCount }, { data: confirmedMarkers }, { count: realmCount }] = await Promise.all([
    supabase.from('conversations').select('id', { count: 'exact', head: true }),
    supabase.from('markers').select('conversation_id, project_id').eq('status', 'confirmed'),
    supabase.from('projects').select('id', { count: 'exact', head: true }),
  ]);

  const conversationIds = new Set<string>();
  let hasRealmAssignedMarker = false;
  for (const row of confirmedMarkers ?? []) {
    conversationIds.add(row.conversation_id);
    if (row.project_id) hasRealmAssignedMarker = true;
  }

  return {
    hasConversations: (conversationCount ?? 0) > 0,
    markerCount: confirmedMarkers?.length ?? 0,
    chronicleCount: conversationIds.size,
    hasConfirmedMarker: (confirmedMarkers?.length ?? 0) > 0,
    realmCount: realmCount ?? 0,
    hasRealmAssignedMarker,
  };
}

export async function getSeenFlags(userId: string): Promise<SeenFlags> {
  const { data } = await supabase
    .from('unlock_flags')
    .select('arca_chronicle, realm')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data) return { ...DEFAULT_SEEN_FLAGS };
  return { arcaChronicle: data.arca_chronicle, realm: data.realm };
}

export async function markSeen(userId: string, key: keyof SeenFlags): Promise<void> {
  const column = SEEN_FLAG_COLUMNS[key];
  await supabase.from('unlock_flags').upsert({ user_id: userId, [column]: true, updated_at: new Date().toISOString() });
}

export interface CelebrationCard {
  emoji: string;
  title: string;
  body: string;
}

// v2.1（2026-07-12）：Arcaは内部概念（＝マーカーそのもの）に降格したため、Arcaの解放演出は
// 廃止した。SeenFlagsのキー名`arcaChronicle`はAsyncStorage互換のためそのまま残している。
// コピー本文はi18n辞書（src/i18n/ja.ts）に置く。
export const CHRONICLE_CELEBRATION: CelebrationCard = t.celebrations.chronicle;
export const REALM_CELEBRATION: CelebrationCard = t.celebrations.realm;
