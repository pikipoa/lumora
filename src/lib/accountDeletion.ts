/**
 * アカウント削除（2026-07-31、DESIGN.md Implementation Rulesレビュー承認済み）。
 *
 * サーバー側の削除はEdge Function `delete-account` が行う（service roleが必要なため）。
 * user_idは渡さない——Edge FunctionがJWTから取得したIDだけを削除する。
 *
 * 【端末には何も残さない】
 * サーバーの削除が成功したら、**端末内のキャッシュを全部消す**。AsyncStorageだけでなく、
 * Web版のlocalStorage/sessionStorageも対象にする（RNWのAsyncStorageはlocalStorage実装だが、
 * Supabaseのセッションなど別経路で書かれたものも残るため）。
 * 「削除したのに、次に開いたら前のRealmが選ばれている」を起こさない。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { Sentry } from '@/lib/sentry';
import { supabase } from '@/lib/supabase';

/** 確認画面に出す「何が消えるか」の件数 */
export interface DeletionSummary {
  chronicles: number;
  arcas: number;
  realms: number;
}

export async function fetchDeletionSummary(userId: string): Promise<DeletionSummary> {
  const [conv, markers, projects] = await Promise.all([
    supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase
      .from('markers')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'confirmed'),
    supabase.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);
  return {
    chronicles: conv.count ?? 0,
    arcas: markers.count ?? 0,
    realms: projects.count ?? 0,
  };
}

/**
 * 端末内のキャッシュを全消去する。
 * 削除**成功後**にのみ呼ぶ（失敗時に消すと、ログイン状態だけ壊れて復旧できなくなる）。
 */
export async function clearAllLocalCaches(): Promise<void> {
  // AsyncStorage：直近使用Realm（recentRealms.ts）など
  try {
    await AsyncStorage.clear();
  } catch (e) {
    Sentry.captureException(e);
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    // Supabaseのセッション・その他のWeb固有のキャッシュ。
    // AsyncStorage.clear()はRNWが管理するキーしか消さないため別途消す
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch (e) {
      Sentry.captureException(e);
    }
  }
}

export type DeleteAccountResult = { ok: true } | { ok: false; message: string };

export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) return { ok: false, message: 'auth_required' };

  try {
    // user_idは渡さない。Edge FunctionがJWTから取得したIDのみを削除する
    const { error } = await supabase.functions.invoke('delete-account', {
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    });
    if (error) {
      Sentry.captureMessage('アカウント削除に失敗', { level: 'error', extra: { message: error.message } });
      return { ok: false, message: 'delete_failed' };
    }
  } catch (e) {
    Sentry.captureException(e);
    return { ok: false, message: 'delete_failed' };
  }

  // 順序が重要：サーバーの削除が成功してから端末を消す
  await clearAllLocalCaches();
  await supabase.auth.signOut();
  return { ok: true };
}
