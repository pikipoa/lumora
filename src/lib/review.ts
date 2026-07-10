/**
 * 未レビュー件数バッジ用の集計。「proposed状態のSummary/ConversationTag/Markerを1件以上持つ会話」を
 * 未レビューとみなし、Project/Theme単位で件数を数える（ux-flow-and-screens.md §2-3）。
 */

import { supabase } from '@/lib/supabase';

export interface UnreviewedCounts {
  byProject: Record<string, number>;
  byTheme: Record<string, number>;
  inbox: number;
}

export async function loadUnreviewedCounts(): Promise<UnreviewedCounts> {
  const [{ data: conversations }, { data: proposedSummaries }, { data: proposedTags }, { data: proposedMarkers }] =
    await Promise.all([
      supabase.from('conversations').select('id, project_id, theme_id'),
      supabase.from('summaries').select('conversation_id').eq('status', 'proposed'),
      supabase.from('conversation_tags').select('conversation_id').eq('status', 'proposed'),
      supabase.from('markers').select('conversation_id').eq('status', 'proposed'),
    ]);

  const unreviewedIds = new Set<string>();
  for (const row of proposedSummaries ?? []) unreviewedIds.add(row.conversation_id);
  for (const row of proposedTags ?? []) unreviewedIds.add(row.conversation_id);
  for (const row of proposedMarkers ?? []) unreviewedIds.add(row.conversation_id);

  const byProject: Record<string, number> = {};
  const byTheme: Record<string, number> = {};
  let inbox = 0;

  for (const c of conversations ?? []) {
    if (!unreviewedIds.has(c.id)) continue;
    if (c.theme_id) byTheme[c.theme_id] = (byTheme[c.theme_id] ?? 0) + 1;
    if (c.project_id) byProject[c.project_id] = (byProject[c.project_id] ?? 0) + 1;
    if (!c.project_id) inbox += 1;
  }

  return { byProject, byTheme, inbox };
}
