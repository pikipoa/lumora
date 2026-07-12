/**
 * 進化するホーム画面（2026-07-11）のUnlock状態モデル。
 * 詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-11 進化するホーム画面（Progressive Unlock UI）」
 *
 * DBの実データから毎回導出する「現在値」（loadUnlockCounts）と、AsyncStorageに永続化する
 * 「既読フラグ」（getSeenFlags/markSeen、一度trueになったら戻らない）の2層構成。
 * 一度解放したセクションは、対象データが後で0件に戻っても再び隠さない設計（ゲーム的な
 * 「成長は後退しない」感覚を優先する明示的な判断）。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

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

function storageKey(userId: string): string {
  return `lumora:unlocks:${userId}`;
}

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
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return { ...DEFAULT_SEEN_FLAGS };
  try {
    return { ...DEFAULT_SEEN_FLAGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SEEN_FLAGS };
  }
}

export async function markSeen(userId: string, key: keyof SeenFlags): Promise<void> {
  const current = await getSeenFlags(userId);
  if (current[key]) return;
  const next = { ...current, [key]: true };
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
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
