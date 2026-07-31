/**
 * organize-markers — マーカー群のタグ整理（Edge Function / Deno）
 *
 * 【設計思想の転換（2026-07-11）】旧`analyze-conversation`（会話全体を要約・マーカー自動発見）を廃止し、
 * この関数に置き換えた。詳細経緯：C:\Users\user\.claude\plans\parsed-enchanting-dream.md
 * 「2026-07-11 マーカー中心アーキテクチャへの転換」参照。
 *
 * 新しい役割：**人間が既に横断検索→本文選択で作成した（confirmed）マーカー群**を入力として受け取り、
 * Topic/ConceptのMarkerTagを提案するだけ。会話全体の要約・スコープ判定・マーカーの自動発見は行わない
 * （「AIは発見するAIではなく整理するAI」という確定方針）。
 *
 * 【外部送信の明示（CLAUDE.md §4）】
 * 送信対象は、指定されたマーカーの「引用テキスト（quoted_text）」「Roleタグ」「所属会話のタイトル」と
 * 「ユーザーの既存タグ名一覧」のみ。会話の他のメッセージや、他の会話・アカウント情報は送信しない。
 * APIキーはEdge Functionのsecretとしてサーバー側にのみ保存される。
 *
 * 生成物はMarkerTagとしてproposed状態で保存され、人間の確定操作を経て資産化される
 * （CLAUDE.md 2-1「Proposed/Confirmedの状態管理は妥協しない」を維持）。
 * モデルは環境変数 LUMORA_AI_MODEL で切替可能（デフォルト: claude-sonnet-5）。
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

import { checkAndIncrementAiUsage } from '../_shared/ai-usage.ts';
import { captureEdgeFunctionError, captureQuotaExceeded, withSentry } from '../_shared/sentry.ts';

const MODEL = Deno.env.get('LUMORA_AI_MODEL') ?? 'claude-sonnet-5';

type TagType = 'topic' | 'concept';

interface OrganizeResult {
  results: {
    marker_id: string;
    tags: { name: string; tag_type: TagType }[];
  }[];
}

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['marker_id', 'tags'],
        properties: {
          marker_id: { type: 'string', description: '入力で渡されたmarker_idをそのまま返す' },
          tags: {
            type: 'array',
            description: 'このマーカーに付けるTopic/Conceptタグ（0〜3個程度）',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'tag_type'],
              properties: {
                name: { type: 'string', description: 'タグ名（#は付けない）' },
                tag_type: { type: 'string', enum: ['topic', 'concept'] },
              },
            },
          },
        },
      },
    },
  },
} as const;

function systemPrompt(existingTags: { name: string; tag_type: TagType }[]): string {
  const tagList =
    existingTags.length > 0
      ? existingTags.map((t) => `- ${t.name} (${t.tag_type})`).join('\n')
      : '（まだ登録されているタグはありません）';

  return `あなたはナレッジ管理アプリ「Lumora」のタグ整理エンジンです。

# 前提
入力されるマーカー（発見物）は、ユーザーが既に「後で参照する価値がある」と判断して手動で選んだ抜粋です。
価値があるかどうかの判定は済んでいるため、あなたの仕事は**分類・整理**だけです。内容を疑ったり除外したりせず、
すべてのマーカーに対してタグを提案してください（該当タグが無ければ空配列でも構いません）。

# タグの付け方
1. 既存タグ一覧から合うものを最優先で再利用する（表記ゆれの新規タグを作らない）
2. 合うものが無い場合のみ新規タグを提案する
- tag_type "topic" = 何についてか（例: ゲーム, AI, 教育, UI設計, DB設計, 認証）
- tag_type "concept" = 何の概念か・抽象化ラベル（例: 社会変化, パラダイムシフト, 資産化）
- 「#雑談です」のような使い捨てタグは作らない。各マーカー0〜3個程度

# ユーザーの既存タグ一覧
${tagList}

# 出力
入力された各マーカーについて、marker_idをそのまま返しつつtagsを提案してください。入力された全マーカー分、必ず1件ずつ返すこと。`;
}

Deno.serve(withSentry('organize-markers', async (req: Request) => {
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

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // 1) 呼び出しユーザーの特定（JWT検証）
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '');
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData.user) return json({ error: '認証が必要です' }, 401);
  const userId = userData.user.id;

  // 0) AI利用上限チェック（クライアントではなくここで判定。原価防御）
  try {
    const usage = await checkAndIncrementAiUsage(supabase, userId, 'organize-markers');
    if (!usage.allowed) {
      captureQuotaExceeded('organize-markers', userId, usage.currentCount, usage.limit);
      return json(
        { error: `本日のAI整理の上限（${usage.limit}回）に達しました。日付が変わると再度利用できます。` },
        429,
      );
    }
  } catch (e) {
    captureEdgeFunctionError('organize-markers', e, { stage: 'usage_check' });
    // 利用回数の記録自体の失敗では処理を止めない（可用性優先、CLAUDE.md 2-4）
  }

  let markerIds: string[];
  try {
    const body = await req.json();
    markerIds = body.marker_ids;
    if (!Array.isArray(markerIds) || markerIds.length === 0) throw new Error('marker_ids がありません');
    if (markerIds.length > 50) throw new Error('一度に整理できるのは50件までです');
  } catch (e) {
    return json({ error: `リクエストが不正です: ${e instanceof Error ? e.message : e}` }, 400);
  }

  try {
    // 2) マーカーの所有者チェック＋本文ロード（所属会話タイトルも軽い文脈として使う）
    const { data: markers, error: markersError } = await supabase
      .from('markers')
      .select('id, quoted_text, role_tag, user_id, conversation_id, conversations(title)')
      .in('id', markerIds);
    if (markersError) {
      captureEdgeFunctionError('organize-markers', new Error(markersError.message), {
        stage: 'fetch_markers',
        marker_count: markerIds.length,
      });
      return json({ error: `マーカー取得に失敗: ${markersError.message}` }, 500);
    }

    const owned = (markers ?? []).filter((m) => m.user_id === userId);
    if (owned.length === 0) return json({ error: '対象マーカーが見つかりません' }, 404);

    const { data: existingTags } = await supabase.from('tags').select('id, name, tag_type').eq('user_id', userId);
    const tagRows = existingTags ?? [];

    // 3) Claude呼び出し（構造化出力）
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const markersText = owned
      .map((m) => {
        const title = (m as unknown as { conversations: { title: string } | null }).conversations?.title ?? '';
        return `- marker_id: ${m.id}\n  出典会話: 「${title}」\n  role_tag: ${m.role_tag ?? '未設定'}\n  本文: ${m.quoted_text}`;
      })
      .join('\n\n');

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: systemPrompt(tagRows.map((t) => ({ name: t.name, tag_type: t.tag_type }))),
      output_config: {
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `以下の${owned.length}件のマーカーにタグを提案してください。\n\n${markersText}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      captureEdgeFunctionError('organize-markers', new Error(`AI応答にテキストがありません (stop_reason: ${response.stop_reason})`), {
        stage: 'anthropic_response',
        markers_processed: owned.length,
        stop_reason: String(response.stop_reason),
      });
      return json({ error: `AI応答にテキストがありません (stop_reason: ${response.stop_reason})` }, 500);
    }
    const result: OrganizeResult = JSON.parse(textBlock.text);

    // 4) タグのfind-or-create
    const tagCache = new Map<string, string>();
    for (const t of tagRows) tagCache.set(`${t.name}|${t.tag_type}`, t.id);
    const ensureTag = async (name: string, tagType: TagType): Promise<string> => {
      const key = `${name}|${tagType}`;
      const cached = tagCache.get(key);
      if (cached) return cached;
      const { data: inserted, error } = await supabase
        .from('tags')
        .insert({ user_id: userId, name, tag_type: tagType })
        .select('id')
        .single();
      // タグ名（＝ユーザーの知識に由来する文字列）をエラーメッセージへ入れない。
      // このエラーはcaptureEdgeFunctionError経由でSentryへ送られるため、
      // 名前を含めると本文をSentryへ渡さないという方針が破れる（2026-07-31の法務レビュー）。
      // 共通のbeforeSendでも伏せているが、そもそも入れないのが筋
      if (error || !inserted) throw new Error(`タグ作成に失敗 (tag_type=${tagType}): ${error?.message}`);
      tagCache.set(key, inserted.id);
      return inserted.id;
    };

    // 5) MarkerTag（proposed状態。既提案分は重複エラーを無視）
    const ownedIds = new Set(owned.map((m) => m.id));
    let tagCount = 0;
    for (const r of result.results) {
      if (!ownedIds.has(r.marker_id)) continue;
      for (const t of r.tags) {
        const tagId = await ensureTag(t.name, t.tag_type);
        const { error } = await supabase.from('marker_tags').insert({
          user_id: userId,
          marker_id: r.marker_id,
          tag_id: tagId,
          proposed_by: 'ai',
        });
        if (!error) tagCount++;
      }
    }

    return json({
      ok: true,
      markers_processed: owned.length,
      tags_proposed: tagCount,
      model: MODEL,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
  } catch (e) {
    captureEdgeFunctionError('organize-markers', e, { stage: 'unhandled', marker_count: markerIds.length });
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}));
