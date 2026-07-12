/**
 * organize-wings — マーカー群のWingクラスタリング（Edge Function / Deno）
 *
 * 【Tag/Wingの役割分離（2026-07-11）】TagはAIが検索・分類のために使う内部メタデータ、
 * Wingは人間が読むための「本の目次・章立て」として役割を完全に分離した。詳細経緯：
 * C:\Users\user\.claude\plans\parsed-enchanting-dream.md「2026-07-11 Tag/Wingの役割分離」
 *
 * 役割：**あるRealm（project_id）に属し、既にTagが付いている（marker_tagsが1件以上）が
 * まだWingに未割当（marker_wingsが1件もない）マーカー群**を入力として受け取り、
 * 既存Wing優先マッチング→Topic/Conceptタグを手がかりに新規Wingを提案する。
 * `organize-markers`（Tag提案）とは別の、その後段のクラスタリング処理。
 *
 * Marker↔Wingは多対多（1つのMarkerが複数のWingに所属できる。「勉強ノートの
 * 『詳しくは第7章』」と同じ参照であり、Marker本文を複製しない）。ただし際限なく
 * 増えると意味を失うため、1マーカーあたり1〜2個、多くとも3個までに留めるよう指示する。
 *
 * 【外部送信の明示（CLAUDE.md §4）】
 * 送信対象は、指定されたRealm内マーカーの「引用テキスト（quoted_text）」「Roleタグ」
 * 「確定済みTopic/Conceptタグ」「所属会話のタイトル」と「そのRealmの既存Wing名一覧」のみ。
 *
 * 生成物はMarkerWingとしてproposed状態で保存され、人間の確定操作を経て資産化される
 * （CLAUDE.md 2-1「Proposed/Confirmedの状態管理は妥協しない」を維持）。
 * モデルは環境変数 LUMORA_AI_MODEL で切替可能（デフォルト: claude-sonnet-5）。
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = Deno.env.get('LUMORA_AI_MODEL') ?? 'claude-sonnet-5';

interface OrganizeResult {
  results: {
    marker_id: string;
    wings: { name: string; icon: string; confidence: number }[];
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
        required: ['marker_id', 'wings'],
        properties: {
          marker_id: { type: 'string', description: '入力で渡されたmarker_idをそのまま返す' },
          wings: {
            type: 'array',
            description: 'このマーカーが属するWing（章）の候補。1〜2個、多くとも3個まで',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'icon', 'confidence'],
              properties: {
                name: { type: 'string', description: 'Wing名（本の章タイトルのような粗い単位。例: 技術スタック, 世界観）' },
                icon: { type: 'string', description: 'Wingを象徴する絵文字1文字' },
                confidence: {
                  type: 'integer',
                  // 注意：構造化出力のJSON Schemaはinteger型のminimum/maximumをサポートしない
                  // （400 invalid_request_errorになる）。範囲はdescriptionで指示し、保存時にクランプする
                  description: 'このマーカーがそのWingに属する確度。0〜100の整数のみ。既存Wingへの明確な一致は90以上、妥当な候補は70〜89、可能性程度は50〜69',
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

function systemPrompt(existingWings: { name: string; icon: string }[]): string {
  const wingList =
    existingWings.length > 0
      ? existingWings.map((w) => `- ${w.icon} ${w.name}`).join('\n')
      : '（まだこのRealmにWingはありません）';

  return `あなたはナレッジ管理アプリ「Lumora」のWing編成エンジンです。

# 前提
入力されるマーカーには、既にTag（AIが検索・分類のために付けた内部ラベル）が付いています。
あなたの仕事はTagを手がかりに、**人間が読むための本の目次・章立て（Wing）**へマーカーをまとめることです。
Wingはタグよりずっと粗い単位です。「Supabase」「Postgres」「認証」のような個別のTagではなく、
「🏗 技術スタック」のような、複数のマーカーを束ねる章を考えてください。

# Wingの付け方
1. 既存Wing一覧から合うものを最優先で再利用する（似た章を新規に作らない）
2. 合うものが無い場合のみ新規Wingを提案する（絵文字アイコンも1つ添える）
3. 1マーカーにつき1〜2個、多くても3個まで。何にでも当てはまる曖昧な章を量産しない
4. 各候補にconfidence（確度0〜100）を付ける。最終的な収納の判断はユーザーが行うため、
   自信の無い候補を無理に高くしない（明確な一致=90以上、妥当=70〜89、可能性程度=50〜69）

# このRealmの既存Wing一覧
${wingList}

# 出力
入力された各マーカーについて、marker_idをそのまま返しつつwingsを提案してください。入力された全マーカー分、必ず1件ずつ返すこと。`;
}

Deno.serve(async (req: Request) => {
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

  let projectId: string;
  try {
    const body = await req.json();
    projectId = body.project_id;
    if (!projectId || typeof projectId !== 'string') throw new Error('project_id がありません');
  } catch (e) {
    return json({ error: `リクエストが不正です: ${e instanceof Error ? e.message : e}` }, 400);
  }

  try {
    // 2) Realm所有者チェック
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('id')
      .eq('id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (projectError) return json({ error: `Realm取得に失敗: ${projectError.message}` }, 500);
    if (!project) return json({ error: 'Realmが見つかりません' }, 404);

    // 3) 対象マーカー：このRealmのconfirmed、Tagは1件以上、Wingはまだ0件
    const { data: markers, error: markersError } = await supabase
      .from('markers')
      .select(
        'id, quoted_text, role_tag, conversations(title), marker_tags(status, tags(name, tag_type)), marker_wings(id)',
      )
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .eq('status', 'confirmed');
    if (markersError) return json({ error: `マーカー取得に失敗: ${markersError.message}` }, 500);

    type MarkerJoin = {
      id: string;
      quoted_text: string;
      role_tag: string | null;
      conversations: { title: string } | null;
      marker_tags: { status: string; tags: { name: string; tag_type: string } }[];
      marker_wings: { id: string }[];
    };
    const candidates = ((markers ?? []) as unknown as MarkerJoin[])
      .filter((m) => m.marker_wings.length === 0)
      .filter((m) => m.marker_tags.some((mt) => mt.status !== 'rejected'))
      .slice(0, 50);

    if (candidates.length === 0) {
      return json({ ok: true, markers_processed: 0, wings_proposed: 0, note: 'Wing提案の対象マーカーがありません' });
    }

    const { data: existingWings } = await supabase
      .from('themes')
      .select('id, name, icon')
      .eq('project_id', projectId)
      .eq('user_id', userId);
    const wingRows = existingWings ?? [];

    // 4) Claude呼び出し（構造化出力）
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const markersText = candidates
      .map((m) => {
        const title = m.conversations?.title ?? '';
        const tagNames = m.marker_tags
          .filter((mt) => mt.status !== 'rejected')
          .map((mt) => `${mt.tags.name}(${mt.tags.tag_type})`)
          .join(', ');
        return `- marker_id: ${m.id}\n  出典会話: 「${title}」\n  role_tag: ${m.role_tag ?? '未設定'}\n  tags: ${tagNames}\n  本文: ${m.quoted_text}`;
      })
      .join('\n\n');

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: systemPrompt(wingRows.map((w) => ({ name: w.name, icon: w.icon ?? '📖' }))),
      output_config: {
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `以下の${candidates.length}件のマーカーをWingに編成してください。\n\n${markersText}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return json({ error: `AI応答にテキストがありません (stop_reason: ${response.stop_reason})` }, 500);
    }
    const result: OrganizeResult = JSON.parse(textBlock.text);

    // 5) Wingのfind-or-create（同じRealm内でname一致なら再利用）
    const wingCache = new Map<string, string>();
    for (const w of wingRows) wingCache.set(w.name, w.id);
    const ensureWing = async (name: string, icon: string): Promise<string> => {
      const cached = wingCache.get(name);
      if (cached) return cached;
      const { data: inserted, error } = await supabase
        .from('themes')
        .insert({ user_id: userId, project_id: projectId, name, icon })
        .select('id')
        .single();
      if (error || !inserted) throw new Error(`Wing作成に失敗 (${name}): ${error?.message}`);
      wingCache.set(name, inserted.id);
      return inserted.id;
    };

    // 6) MarkerWing（proposed状態。既提案分は重複エラーを無視）
    const candidateIds = new Set(candidates.map((m) => m.id));
    let wingCount = 0;
    let newWingCount = 0;
    for (const r of result.results) {
      if (!candidateIds.has(r.marker_id)) continue;
      for (const w of r.wings) {
        const wasNew = !wingCache.has(w.name);
        const wingId = await ensureWing(w.name, w.icon || '📖');
        if (wasNew) newWingCount++;
        const { error } = await supabase.from('marker_wings').insert({
          user_id: userId,
          marker_id: r.marker_id,
          wing_id: wingId,
          proposed_by: 'ai',
          confidence: Math.max(0, Math.min(100, Math.round(w.confidence ?? 0))),
        });
        if (!error) wingCount++;
      }
    }

    return json({
      ok: true,
      markers_processed: candidates.length,
      wings_proposed: wingCount,
      new_wings_created: newWingCount,
      model: MODEL,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
