import { parseClaudeCode } from '../parsers/claudeCode';

/** 実データ検証（2026-07-21）で確認したスキーマを模した合成フィクスチャ */
function line(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('parseClaudeCode', () => {
  test('user(文字列)とassistant(textブロック)を会話として復元し、ai-titleをタイトルにする', () => {
    const jsonl = [
      line({ type: 'system', sessionId: 'sess-1' }),
      line({
        type: 'user',
        sessionId: 'sess-1',
        timestamp: '2026-07-21T01:00:00.000Z',
        message: { role: 'user', content: '検索の仕様を教えて' },
      }),
      line({
        type: 'assistant',
        sessionId: 'sess-1',
        timestamp: '2026-07-21T01:00:05.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '内部思考なので無視されるはず' },
            { type: 'tool_use', name: 'Read', input: {} },
            { type: 'text', text: '現在の検索は' },
            { type: 'text', text: 'タイトルと本文のみが対象です。' },
          ],
        },
      }),
      line({ type: 'ai-title', sessionId: 'sess-1', aiTitle: '検索仕様の調査' }),
      line({ type: 'ai-title', sessionId: 'sess-1', aiTitle: '横断検索の調査（最終版）' }),
      line({
        type: 'user',
        sessionId: 'sess-1',
        timestamp: '2026-07-21T01:05:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'OK' }] }],
        },
      }),
    ].join('\n');

    const result = parseClaudeCode(jsonl, 'sess-1.jsonl');

    expect(result.source).toBe('claude_code');
    expect(result.failed).toHaveLength(0);
    const conv = result.conversations[0];
    expect(conv.source).toBe('claude_code');
    expect(conv.sourceConversationId).toBe('sess-1');
    // 複数回出現するai-titleは最後の値を採用する
    expect(conv.title).toBe('横断検索の調査（最終版）');

    // tool_resultのみのuserターンは取り込まれず、実際の発言は2件（user1件+assistant1件）
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0].role).toBe('user');
    expect(conv.messages[0].content).toBe('検索の仕様を教えて');
    // thinking/tool_useは無視し、textブロックのみ結合される
    expect(conv.messages[1].role).toBe('assistant');
    expect(conv.messages[1].content).toBe('現在の検索は\n\nタイトルと本文のみが対象です。');
  });

  test('壊れた行が混ざっていても無視して続行する（壊れても落ちない）', () => {
    const jsonl = [
      '{not valid json',
      line({
        type: 'user',
        sessionId: 'sess-2',
        message: { role: 'user', content: '生きている行' },
      }),
    ].join('\n');

    const result = parseClaudeCode(jsonl, 'sess-2.jsonl');

    expect(result.conversations[0].messages).toHaveLength(1);
    expect(result.warnings.some((w) => w.message.includes('行のJSONを解釈できず'))).toBe(true);
  });

  test('textブロックの無いassistantターン（tool_useのみ）は取り込まない', () => {
    const jsonl = [
      line({
        type: 'user',
        sessionId: 'sess-3',
        message: { role: 'user', content: 'ファイルを直して' },
      }),
      line({
        type: 'assistant',
        sessionId: 'sess-3',
        message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: {} }] },
      }),
    ].join('\n');

    const result = parseClaudeCode(jsonl, 'sess-3.jsonl');
    expect(result.conversations[0].messages).toHaveLength(1);
    expect(result.conversations[0].messages[0].role).toBe('user');
  });

  test('タイトルが無い場合はファイル名をタイトルにする', () => {
    const jsonl = line({ type: 'user', sessionId: 's', message: { role: 'user', content: 'hi' } });
    const result = parseClaudeCode(jsonl, 'my-session.jsonl');
    expect(result.conversations[0].title).toBe('my-session');
  });

  test('会話として復元できるメッセージが無い場合はfailedで返す', () => {
    const jsonl = line({ type: 'system', sessionId: 's' });
    const result = parseClaudeCode(jsonl, 'empty-session.jsonl');
    expect(result.conversations).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });

  test('空ファイルはfailedで返す（例外を投げない）', () => {
    const result = parseClaudeCode('   ', 'empty.jsonl');
    expect(result.conversations).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });
});
