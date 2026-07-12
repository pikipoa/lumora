import { parseChatGpt } from '../parsers/chatgpt';

/** 分岐（regenerate）を含む最小のChatGPTツリーフィクスチャ */
function treeConversation(overrides: Record<string, unknown> = {}) {
  return {
    title: 'テスト会話',
    create_time: 1750000000,
    update_time: 1750000100,
    conversation_id: 'conv-1',
    current_node: 'node-a2', // 採用枝は a系列
    mapping: {
      root: { id: 'root', parent: null, children: ['sys'], message: null },
      sys: {
        id: 'sys',
        parent: 'root',
        children: ['u1'],
        message: {
          author: { role: 'system' },
          content: { content_type: 'text', parts: ['system prompt'] },
        },
      },
      u1: {
        id: 'u1',
        parent: 'sys',
        children: ['node-a1', 'node-b1'], // ここで分岐
        message: {
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['こんにちは'] },
          create_time: 1750000010,
        },
      },
      'node-a1': {
        id: 'node-a1',
        parent: 'u1',
        children: ['node-a2'],
        message: {
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['採用された返答'] },
          metadata: { model_slug: 'gpt-5' },
        },
      },
      'node-a2': {
        id: 'node-a2',
        parent: 'node-a1',
        children: [],
        message: {
          author: { role: 'user' },
          content: { content_type: 'text', parts: ['続きの質問'] },
        },
      },
      'node-b1': {
        id: 'node-b1',
        parent: 'u1',
        children: [],
        message: {
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: ['破棄された返答（別ブランチ）'] },
        },
      },
    },
    ...overrides,
  };
}

describe('parseChatGpt', () => {
  test('current_nodeから採用枝を1本復元し、system/toolは除外する', () => {
    const result = parseChatGpt([JSON.stringify([treeConversation()])]);

    expect(result.failed).toHaveLength(0);
    expect(result.conversations).toHaveLength(1);

    const conv = result.conversations[0];
    expect(conv.title).toBe('テスト会話');
    expect(conv.sourceConversationId).toBe('conv-1');
    expect(conv.model).toBe('gpt-5');
    expect(conv.messages.map((m) => m.content)).toEqual([
      'こんにちは',
      '採用された返答',
      '続きの質問',
    ]);
    // 破棄ブランチのメッセージは含まれない
    expect(conv.messages.some((m) => m.content.includes('破棄'))).toBe(false);
  });

  test('current_nodeが無い場合は最深リーフの枝を採用し、警告を残す', () => {
    const item = treeConversation();
    delete (item as Record<string, unknown>).current_node;
    const result = parseChatGpt([JSON.stringify([item])]);

    expect(result.conversations).toHaveLength(1);
    // a系列（深さ3）がb系列（深さ2）より深いので採用される
    expect(result.conversations[0].messages.map((m) => m.content)).toContain('採用された返答');
    expect(result.warnings.some((w) => w.message.includes('最深リーフ'))).toBe(true);
  });

  test('1件の壊れた会話が他の会話のインポートを止めない', () => {
    const broken = { title: '壊れた会話', mapping: null };
    const result = parseChatGpt([JSON.stringify([treeConversation(), broken, treeConversation({ title: '3件目' })])]);

    expect(result.conversations).toHaveLength(2);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].conversationRef).toBe('壊れた会話');
  });

  test('未知フィールドはエラーにならず無視される', () => {
    const item = treeConversation({ some_future_field: { nested: [1, 2, 3] } });
    const result = parseChatGpt([JSON.stringify([item])]);
    expect(result.failed).toHaveLength(0);
    expect(result.conversations).toHaveLength(1);
  });

  test('text以外のcontent_typeはテキスト片のみ回収しcontentFormatLostを立てる', () => {
    const item = treeConversation();
    (item.mapping as Record<string, any>)['node-a1'].message.content = {
      content_type: 'code',
      parts: ['console.log("hi")', { image: 'binary' }],
    };
    const result = parseChatGpt([JSON.stringify([item])]);

    const assistantMsg = result.conversations[0].messages.find((m) => m.role === 'assistant');
    expect(assistantMsg?.content).toBe('console.log("hi")');
    expect(assistantMsg?.contentFormatLost).toBe(true);
  });

  test('JSON全体が壊れている場合はfailed 1件で返す（例外を投げない）', () => {
    const result = parseChatGpt(['{not valid json']);
    expect(result.conversations).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });

  test('conversations-000.json等に分割された複数ファイルをまとめて1つの結果にする', () => {
    const result = parseChatGpt([
      JSON.stringify([treeConversation({ conversation_id: 'conv-1', title: '1件目' })]),
      JSON.stringify([treeConversation({ conversation_id: 'conv-2', title: '2件目' })]),
    ]);

    expect(result.failed).toHaveLength(0);
    expect(result.conversations).toHaveLength(2);
    expect(result.conversations.map((c) => c.title)).toEqual(['1件目', '2件目']);
  });
});
