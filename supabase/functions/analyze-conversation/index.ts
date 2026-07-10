/**
 * analyze-conversation — ③AI要約生成・タグ提案・重要箇所抽出（Edge Function / Deno）
 *
 * 【外部送信の明示（CLAUDE.md §4）】
 * この関数は、対象会話の「タイトル」と「全メッセージ本文」および「ユーザーの既存タグ名一覧」を
 * Anthropic Claude API (api.anthropic.com) に送信する。これ以外のデータ（他の会話、
 * メールアドレス等のアカウント情報）は送信しない。APIキーはEdge Functionのsecretとして
 * サーバー側にのみ保存され、アプリ（クライアント）には配布されない。
 *
 * 生成物はすべて proposed 状態で保存され、人間の確定操作を経て資産化される（VISION.md 3-2）。
 * モデルは環境変数 LUMORA_AI_MODEL で切替可能（デフォルト: claude-sonnet-5）。
 */

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = Deno.env.get('LUMORA_AI_MODEL') ?? 'claude-sonnet-5';

type TagType = 'topic' | 'concept';
type RoleTag = 'idea' | 'hypothesis' | 'decision' | 'strategy' | 'learning';

interface AnalysisResult {
  summary: string;
  should_tag: boolean;
  conversation_tags: { name: string; tag_type: TagType }[];
  markers: {
    message_seq: number;
    quoted_text: string;
    role_tag: RoleTag | null;
    tags: { name: string; tag_type: TagType }[];
  }[];
}

// 構造化出力スキーマ（output_config.format）— レスポンスが必ずこの形になる
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'should_tag', 'conversation_tags', 'markers'],
  properties: {
    summary: {
      type: 'string',
      description: '会話全体の要約（日本語、3〜6文程度）',
    },
    should_tag: {
      type: 'boolean',
      description:
        '後で参照したくなる意思決定・仕様検討・設計判断・アイデアを含むか。純粋な雑談のみならfalse（タグ提案をスキップ）',
    },
    conversation_tags: {
      type: 'array',
      description: '会話全体への大まかなタグ（should_tag=falseなら空配列）',
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
    markers: {
      type: 'array',
      description: '重要箇所（発見物）の抽出結果',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['message_seq', 'quoted_text', 'role_tag', 'tags'],
        properties: {
          message_seq: { type: 'integer', description: '対象メッセージの番号（本文中の[#N]）' },
          quoted_text: {
            type: 'string',
            description: '重要箇所の原文。対象メッセージ本文からの正確な連続した抜粋（一字一句そのまま）であること',
          },
          role_tag: {
            anyOf: [
              { type: 'string', enum: ['idea', 'hypothesis', 'decision', 'strategy', 'learning'] },
              { type: 'null' },
            ],
            description: '知識内での役割の推定。自信がなければnull',
          },
          tags: {
            type: 'array',
            description: 'この発見物単位のTopic/Conceptタグ',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'tag_type'],
              properties: {
                name: { type: 'string' },
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

  return `あなたはナレッジ管理アプリ「Lumora」の分析エンジンです。ユーザーがAIチャットサービスから取り込んだ会話を分析し、要約・タグ提案・重要箇所抽出を行います。

# 前提となる思想
AIは意味を「推測」できるが、意味を「確定する権利」は人間にある。あなたの出力はすべて「提案」であり、人間のレビューを経て確定される。過剰に確信的である必要はないが、提案の質がユーザーの資産の質を決める。

# 要約 (summary)
会話の内容を日本語で3〜6文に要約する。何について議論し、何が決まり（または決まらず）、どんなアイデアが出たかを中心に。

# タグ提案の判定 (should_tag)
Step1: この会話に「後で参照したくなる意思決定・仕様検討・設計判断・アイデア」が含まれるか判定する。純粋な世間話・雑談のみの場合はfalse（conversation_tagsは空配列にする）。試行錯誤やトラブルシューティングの過程は、結論が出ていなくても対象に含める（プロセス自体に資産価値がある）。

# タグの付け方（conversation_tags / markers内のtags共通）
Step2: 以下の優先順位でタグを決める：
1. 既存タグ一覧から合うものを最優先で再利用する（表記ゆれの新規タグを作らない）
2. 合うものが無い場合のみ新規タグを提案する
- tag_type "topic" = 何についてか（例: ゲーム, AI, 教育, UI設計）
- tag_type "concept" = 何の概念か・抽象化ラベル（例: 社会変化, パラダイムシフト, 資産化）
- 「#雑談です」「#今日の話」のような使い捨てタグは作らない
- 会話全体タグ(conversation_tags)は大まかな分類として0〜4個程度、発見物タグ(markers.tags)は各0〜3個程度

# ユーザーの既存タグ一覧
${tagList}

# 重要箇所抽出 (markers)
後で参照する価値がある文・段落を抽出する。意思決定、仕様の確定、核心的なアイデア、重要な学びが対象。
- quoted_text は対象メッセージ本文からの【一字一句正確な連続した抜粋】であること。改変・要約・結合は不可
- 長すぎる抜粋は避ける（1〜3文程度が目安）
- 件数は会話の密度次第で0〜10個程度。無理に抽出しない
- role_tag はその箇所の「知識内での役割」の推定: idea(アイデア) / hypothesis(仮説) / decision(決定) / strategy(戦略) / learning(学び)。判断が難しければnull`;
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

  let conversationId: string;
  try {
    const body = await req.json();
    conversationId = body.conversation_id;
    if (typeof conversationId !== 'string') throw new Error('conversation_id がありません');
  } catch (e) {
    return json({ error: `リクエストが不正です: ${e instanceof Error ? e.message : e}` }, 400);
  }

  // 2) 会話の所有者チェック
  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, user_id, title, source')
    .eq('id', conversationId)
    .single();
  if (!conversation || conversation.user_id !== userId) {
    return json({ error: '会話が見つかりません' }, 404);
  }

  // 3) ジョブ記録（running）
  const { data: job, error: jobError } = await supabase
    .from('ai_jobs')
    .insert({
      user_id: userId,
      conversation_id: conversationId,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (jobError || !job) return json({ error: `ジョブ作成に失敗: ${jobError?.message}` }, 500);

  const failJob = async (message: string) => {
    await supabase
      .from('ai_jobs')
      .update({ status: 'error', error: message, finished_at: new Date().toISOString() })
      .eq('id', job.id);
    return json({ error: message }, 500);
  };

  try {
    // 4) メッセージと既存タグをロード
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('id, seq, role, content')
      .eq('conversation_id', conversationId)
      .order('seq');
    if (msgError || !messages || messages.length === 0) {
      return await failJob('メッセージの取得に失敗しました');
    }

    const { data: existingTags } = await supabase
      .from('tags')
      .select('id, name, tag_type')
      .eq('user_id', userId);
    const tagRows = existingTags ?? [];

    // 5) Claude呼び出し（構造化出力）
    const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const conversationText = messages
      .map((m) => `[#${m.seq}] ${m.role === 'user' ? 'Human' : 'Assistant'}:\n${m.content}`)
      .join('\n\n');

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt(tagRows.map((t) => ({ name: t.name, tag_type: t.tag_type }))),
      output_config: {
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: `以下の会話（タイトル:「${conversation.title}」、出典: ${conversation.source}）を分析してください。\n\n${conversationText}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return await failJob(`AI応答にテキストがありません (stop_reason: ${response.stop_reason})`);
    }
    const result: AnalysisResult = JSON.parse(textBlock.text);

    // 6) タグのfind-or-create（(user_id, name, tag_type)単位）
    const tagCache = new Map<string, string>(); // "name|type" -> id
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
      if (error || !inserted) throw new Error(`タグ作成に失敗 (${name}): ${error?.message}`);
      tagCache.set(key, inserted.id);
      return inserted.id;
    };

    // 7) Summary（Phase1は上書き運用：既存があればproposedで上書き）
    const { data: existingSummary } = await supabase
      .from('summaries')
      .select('id')
      .eq('conversation_id', conversationId)
      .maybeSingle();
    if (existingSummary) {
      await supabase
        .from('summaries')
        .update({ body: result.summary, status: 'proposed', updated_at: new Date().toISOString() })
        .eq('id', existingSummary.id);
    } else {
      await supabase
        .from('summaries')
        .insert({ user_id: userId, conversation_id: conversationId, body: result.summary });
    }

    // 8) ConversationTag（should_tag=falseならスキップ＝提案0件）
    let conversationTagCount = 0;
    if (result.should_tag) {
      for (const t of result.conversation_tags) {
        const tagId = await ensureTag(t.name, t.tag_type);
        const { error } = await supabase
          .from('conversation_tags')
          .insert({
            user_id: userId,
            conversation_id: conversationId,
            tag_id: tagId,
            proposed_by: 'ai',
          });
        if (!error) conversationTagCount++;
        // 重複(unique制約)エラーは既提案済みとして無視
      }
    }

    // 9) Marker + MarkerTag（quoted_textの原文一致を検証、非一致は破棄）
    const messageBySeq = new Map<number, { id: string; content: string }>();
    for (const m of messages) messageBySeq.set(m.seq, { id: m.id, content: m.content });

    let markerCount = 0;
    let droppedMarkers = 0;
    for (const marker of result.markers) {
      const msg = messageBySeq.get(marker.message_seq);
      const quoted = marker.quoted_text?.trim();
      if (!msg || !quoted || !msg.content.includes(quoted)) {
        droppedMarkers++;
        continue;
      }
      const { data: insertedMarker, error } = await supabase
        .from('markers')
        .insert({
          user_id: userId,
          conversation_id: conversationId,
          message_id: msg.id,
          quoted_text: quoted,
          proposed_by: 'ai',
          role_tag: marker.role_tag,
        })
        .select('id')
        .single();
      if (error || !insertedMarker) {
        droppedMarkers++;
        continue;
      }
      markerCount++;
      for (const t of marker.tags) {
        const tagId = await ensureTag(t.name, t.tag_type);
        await supabase.from('marker_tags').insert({
          user_id: userId,
          marker_id: insertedMarker.id,
          tag_id: tagId,
          proposed_by: 'ai',
        });
      }
    }

    // 10) ジョブ完了
    const resultSummary = {
      should_tag: result.should_tag,
      conversation_tags: conversationTagCount,
      markers: markerCount,
      dropped_markers: droppedMarkers,
      model: MODEL,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
    };
    await supabase
      .from('ai_jobs')
      .update({
        status: 'done',
        result_summary: resultSummary,
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id);

    return json({ ok: true, ...resultSummary });
  } catch (e) {
    return await failJob(e instanceof Error ? e.message : String(e));
  }
});
