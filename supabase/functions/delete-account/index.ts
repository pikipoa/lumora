/**
 * アカウント削除（2026-07-31、DESIGN.md Implementation Rulesレビュー承認済み）。
 *
 * 【なぜEdge Functionが必要か】
 * `auth.admin.deleteUser()` はservice roleキーを要求する。クライアントにservice roleを
 * 置くことはできないため、削除はサーバー側でしか行えない。
 *
 * 【API契約：自分自身しか削除できない】
 * **user_idを引数で受け取らない。** JWTから取得したIDのみを削除する。引数で受け取ると
 * 他人のIDを渡す攻撃の余地が生まれる。将来クライアントが増えてもこの契約は変わらない。
 *
 * 【データの削除範囲】
 * `auth.users`の1行を削除すると、user_id列を持つ全18テーブルが`on delete cascade`で
 * 連鎖削除される（`20260710000001_initial_schema.sql`ほか）。個別のDELETEは書かない。
 * テーブルを追加する時は、必ず`references auth.users (id) on delete cascade`を付けること
 * ——付け忘れると、そのテーブルだけ削除されずに残る。
 *
 * 【削除されないもの（`docs/data-handling.md`に記載）】
 * - Sentryに送られたエラー情報（user_idを含む）。Sentry側の保持ポリシーに従う
 * - Anthropic APIへ送信済みのマーカー抜粋。Anthropic側の保持ポリシーに従う
 * - Vercelのアクセスログ
 * 端末内のキャッシュはクライアント側で消す（成功レスポンス後）。
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

import { captureEdgeFunctionError, withSentry } from '../_shared/sentry.ts';

Deno.serve(
  withSentry('delete-account', async (req: Request) => {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    if (req.method !== 'POST') return json({ error: 'POSTのみ受け付けます' }, 405);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 呼び出しユーザーの特定（JWT検証）。**ここで得たIDだけを削除対象にする**
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
    if (userError || !userData.user) return json({ error: '認証が必要です' }, 401);
    const userId = userData.user.id;

    const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);
    if (deleteError) {
      captureEdgeFunctionError('delete-account', new Error(deleteError.message), {
        stage: 'delete_user',
      });
      return json({ error: 'アカウントを削除できませんでした' }, 500);
    }

    return json({ ok: true });
  }),
);
