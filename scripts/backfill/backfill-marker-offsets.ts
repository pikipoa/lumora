/**
 * マーカーのoffset/文脈バックフィル（2026-07-31・SQL版からの全面書き直し）
 *
 * 【なぜSQLをやめたか】
 * `markers.start_offset` / `end_offset` は **JavaScriptのUTF-16コードユニット** 単位で
 * 保存されている（`content.slice(start, end)` の引数そのもの）。一方 PostgreSQL の
 * `substring(content from N for L)` / `position(x in y)` は **文字（コードポイント）** 単位で
 * 数える。絵文字（サロゲートペア）はJSで2、Postgresで1と数えられるため、両者は一致しない。
 *
 * 旧SQL版はこの違いを踏まえておらず、走らせていれば
 *   - `03` が文字位置を start_offset として書き込み、絵文字より後ろのマーカーが全部ずれる
 *   - `02` がそのずれた位置から文脈を生成し、**自己修復不能な誤りを焼き付ける**
 * という被害が出ていた（2026-07-31、実データで確認。詳細は `CHANGELOG.md`）。
 *
 * この実装は**アプリと同じ関数**（`extractContext`）と同じJS文字列操作を使う。
 * 意味論のずれが原理的に発生しない、というのがSQLに対する唯一かつ決定的な利点である。
 *
 * 【安全設計】
 * - 既定は**ドライラン**。実際に書き込むには `--apply` を明示する
 * - Phase 1（offset）と Phase 2（文脈）は**分けて実行できる**。文脈は「位置が確実に
 *   分かっているマーカー」にしか付けない（誤ったoffsetは文脈があれば訂正できるが、
 *   誤った文脈は永久に訂正されないため。非対称性の詳細は `README.md`）
 * - 冪等：Phase 1 は start_offset が null のもの、Phase 2 は context_before が null の
 *   ものだけを対象にする
 *
 * 【実行方法】
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill/backfill-marker-offsets.ts
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/backfill/backfill-marker-offsets.ts --apply
 *
 * service role キーはRLSを迂回する。**リポジトリにコミットしないこと**。
 */

import { createClient } from '@supabase/supabase-js';

import { extractContext } from '../../src/lib/markerLayout';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes('--apply');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を環境変数で指定してください。');
  process.exit(1);
}

// 上のガードでnullチェック済みだが、TypeScriptの絞り込みはトップレベルのifを跨がないため明示する
const supabase = createClient(SUPABASE_URL as string, SERVICE_ROLE_KEY as string, {
  auth: { persistSession: false },
});

interface MarkerRow {
  id: string;
  message_id: string;
  quoted_text: string | null;
  start_offset: number | null;
  end_offset: number | null;
  context_before: string | null;
  status: string;
}

/** 本文中に quoted_text がちょうど1箇所しか無いか。**重なり合う出現も数える** */
function findUniqueOccurrence(content: string, quoted: string): number | null {
  const first = content.indexOf(quoted);
  if (first === -1) return null;
  // 「最初の一致の1文字先」から再検索する。indexOf(q, first + q.length) にすると
  // 重なり合う出現（"あああ" の中の "ああ"）を数え落とす
  const second = content.indexOf(quoted, first + 1);
  return second === -1 ? first : null;
}

async function loadContents(messageIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  // in句が長くなりすぎないよう分割して取得する
  for (let i = 0; i < messageIds.length; i += 200) {
    const chunk = messageIds.slice(i, i + 200);
    const { data, error } = await supabase.from('messages').select('id, content').in('id', chunk);
    if (error) throw new Error(`messagesの取得に失敗: ${error.message}`);
    for (const row of data ?? []) map.set(row.id, row.content);
  }
  return map;
}

async function fetchMarkers(filter: 'no_offset' | 'no_context'): Promise<MarkerRow[]> {
  let query = supabase
    .from('markers')
    .select('id, message_id, quoted_text, start_offset, end_offset, context_before, status')
    .neq('status', 'rejected');
  query = filter === 'no_offset' ? query.is('start_offset', null) : query.is('context_before', null);
  const { data, error } = await query;
  if (error) throw new Error(`markersの取得に失敗: ${error.message}`);
  return (data ?? []) as MarkerRow[];
}

/**
 * Phase 1：本文中に1箇所しか無いマーカーに offset を付ける。
 * **文脈は書かない**（意図的。位置が一意に定まっただけで、それが元の意図だった保証は
 * 別途あるが、複数箇所ある場合との扱いを混ぜないため工程を分ける）
 */
async function phase1FillOffsets() {
  const markers = (await fetchMarkers('no_offset')).filter((m) => m.quoted_text);
  const contents = await loadContents([...new Set(markers.map((m) => m.message_id))]);

  const updates: { id: string; start: number; end: number }[] = [];
  const stats = { unique: 0, multiple: 0, notFound: 0, noMessage: 0 };

  for (const m of markers) {
    const content = contents.get(m.message_id);
    if (content === undefined) {
      stats.noMessage++;
      continue;
    }
    const quoted = m.quoted_text!;
    const at = findUniqueOccurrence(content, quoted);
    if (at === null) {
      if (content.includes(quoted)) stats.multiple++;
      else stats.notFound++;
      continue;
    }
    stats.unique++;
    updates.push({ id: m.id, start: at, end: at + quoted.length });
  }

  console.log('\n=== Phase 1: offsetの付与 ===');
  console.log(`対象（start_offsetがnull）: ${markers.length}件`);
  console.log(`  Tier 1  1箇所のみ → 確定できる : ${stats.unique}件`);
  console.log(`  Tier 2  複数箇所 → 復元不能    : ${stats.multiple}件`);
  console.log(`  Tier 3  本文に無い → 保留      : ${stats.notFound}件`);
  if (stats.noMessage) console.log(`  メッセージが見つからない        : ${stats.noMessage}件`);

  if (!APPLY) {
    console.log('ドライランのため書き込みません（--apply で実行）。');
    return;
  }
  for (const u of updates) {
    const { error } = await supabase
      .from('markers')
      .update({ start_offset: u.start, end_offset: u.end })
      .eq('id', u.id);
    if (error) console.error(`  更新失敗 ${u.id}: ${error.message}`);
  }
  console.log(`${updates.length}件を更新しました。`);
}

/**
 * Phase 2：**位置が確実に分かっているマーカーだけ**に文脈を付ける。
 * 「確実」の定義＝保存されている offset がJS上で quoted_text を指していること。
 * ここを緩めると、誤った文脈を焼き付けて永久に訂正されなくなる（README参照）。
 */
async function phase2FillContext() {
  const markers = await fetchMarkers('no_context');
  const contents = await loadContents([...new Set(markers.map((m) => m.message_id))]);

  const updates: { id: string; before: string; after: string }[] = [];
  let skippedUnverified = 0;

  for (const m of markers) {
    if (m.start_offset === null || m.end_offset === null || !m.quoted_text) continue;
    const content = contents.get(m.message_id);
    if (content === undefined) continue;
    // アプリの保存時ガードと**まったく同じ検証**。ここが安全性の根拠
    if (content.slice(m.start_offset, m.end_offset) !== m.quoted_text) {
      skippedUnverified++;
      continue;
    }
    const ctx = extractContext(content, m.start_offset, m.end_offset);
    updates.push({ id: m.id, before: ctx.before, after: ctx.after });
  }

  console.log('\n=== Phase 2: 文脈の付与 ===');
  console.log(`対象（context_beforeがnull）    : ${markers.length}件`);
  console.log(`  位置を検証できた → 文脈を付ける: ${updates.length}件`);
  console.log(`  位置を検証できない → 対象外    : ${skippedUnverified}件`);

  if (!APPLY) {
    console.log('ドライランのため書き込みません（--apply で実行）。');
    return;
  }
  for (const u of updates) {
    const { error } = await supabase
      .from('markers')
      .update({ context_before: u.before, context_after: u.after })
      .eq('id', u.id);
    if (error) console.error(`  更新失敗 ${u.id}: ${error.message}`);
  }
  console.log(`${updates.length}件を更新しました。`);
}

async function main() {
  console.log(APPLY ? '*** 書き込みモード（--apply）***' : '--- ドライラン（書き込みません）---');
  await phase1FillOffsets();
  // Phase 1でoffsetが確定したものにも文脈を付けたいので、Phase 2は必ず後に走らせる
  await phase2FillContext();
  console.log('\n完了。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
