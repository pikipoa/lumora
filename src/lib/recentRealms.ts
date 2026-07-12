/**
 * Realm選択チップの並び順用：直近マーカーを収納したRealmの履歴（端末ローカル）。
 * unlocks.tsのSeenFlagsと同じAsyncStorageパターン。
 * 「あとで」を先頭、続けて直近使用順、という表示順の判断材料として使う。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const MAX_ENTRIES = 20;

function storageKey(userId: string): string {
  return `lumora:recentRealms:${userId}`;
}

export async function getRecentRealmIds(userId: string): Promise<string[]> {
  const raw = await AsyncStorage.getItem(storageKey(userId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export async function markRealmUsed(userId: string, projectId: string): Promise<void> {
  const current = await getRecentRealmIds(userId);
  const next = [projectId, ...current.filter((id) => id !== projectId)].slice(0, MAX_ENTRIES);
  await AsyncStorage.setItem(storageKey(userId), JSON.stringify(next));
}

/** 直近使用順→残りは渡された順（既定はcreated_at降順）で並び替える */
export function sortByRecency<T extends { id: string }>(items: T[], recentIds: string[]): T[] {
  const rank = new Map(recentIds.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return 0; // どちらも未使用：呼び出し側の元の順序を保つ
  });
}
