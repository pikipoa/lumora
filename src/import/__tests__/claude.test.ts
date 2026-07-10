import { parseClaude } from '../parsers/claude';

const baseConversation = {
  uuid: 'uuid-1',
  name: '闘着場の設計相談',
  created_at: '2026-06-01T10:00:00Z',
  updated_at: '2026-06-01T11:00:00Z',
  model: 'claude-sonnet-5',
  chat_messages: [
    { uuid: 'm1', sender: 'human', text: '受付カウンターのUIをどうするか', created_at: '2026-06-01T10:00:00Z' },
    { uuid: 'm2', sender: 'assistant', text: '世界観の入口として設計しましょう', created_at: '2026-06-01T10:01:00Z' },
  ],
};

describe('parseClaude', () => {
  test('フラットなconversations.jsonを共通モデルに変換する', () => {
    const result = parseClaude(JSON.stringify([baseConversation]));

    expect(result.failed).toHaveLength(0);
    const conv = result.conversations[0];
    expect(conv.source).toBe('claude');
    expect(conv.sourceConversationId).toBe('uuid-1');
    expect(conv.title).toBe('闘着場の設計相談');
    expect(conv.model).toBe('claude-sonnet-5');
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0]).toMatchObject({ role: 'user', contentFormatLost: false });
    expect(conv.messages[1].role).toBe('assistant');
  });

  test('content配列形式（新形式）のメッセージも読める', () => {
    const item = {
      ...baseConversation,
      chat_messages: [
        {
          uuid: 'm1',
          sender: 'assistant',
          content: [
            { type: 'text', text: '前半' },
            { type: 'tool_use', name: 'search' },
            { type: 'text', text: '後半' },
          ],
        },
      ],
    };
    const result = parseClaude(JSON.stringify([item]));

    const msg = result.conversations[0].messages[0];
    expect(msg.content).toBe('前半\n後半');
    expect(msg.contentFormatLost).toBe(true); // tool_useブロックは復元不能
  });

  test('未知のsenderは警告を残してスキップし、会話全体は失敗にしない', () => {
    const item = {
      ...baseConversation,
      chat_messages: [
        ...baseConversation.chat_messages,
        { uuid: 'm3', sender: 'moderator', text: '未知ロール' },
      ],
    };
    const result = parseClaude(JSON.stringify([item]));

    expect(result.conversations[0].messages).toHaveLength(2);
    expect(result.warnings.some((w) => w.message.includes('moderator'))).toBe(true);
  });

  test('chat_messagesが無い会話はfailedになり、他は取り込まれる', () => {
    const result = parseClaude(JSON.stringify([{ uuid: 'x', name: '壊れた' }, baseConversation]));
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].conversationRef).toBe('壊れた');
    expect(result.conversations).toHaveLength(1);
  });

  test('無題の会話はUntitledになる', () => {
    const item = { ...baseConversation, name: '' };
    const result = parseClaude(JSON.stringify([item]));
    expect(result.conversations[0].title).toBe('Untitled');
  });
});
