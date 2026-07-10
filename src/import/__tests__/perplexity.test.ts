import { parsePerplexity } from '../parsers/perplexity';

const sampleMarkdown = `# 一次情報の調べ方

## RN gesture-handlerのテキスト選択は可能か

React Native標準ではSelection APIに相当する機能はありません[1]。
gesture-handlerで自作する事例は存在します[2]。

## WebViewハイブリッドの前例は

postMessageベースの実装が一般的です。

[1]: https://reactnative.dev/docs/text
[2]: https://example.com/gesture-selection
`;

describe('parsePerplexity', () => {
  test('見出し=質問、本文=回答としてQ/Aを復元し、citationsを抽出する', () => {
    const result = parsePerplexity(sampleMarkdown, 'research.md');

    expect(result.failed).toHaveLength(0);
    const conv = result.conversations[0];
    expect(conv.source).toBe('perplexity');
    expect(conv.title).toBe('一次情報の調べ方');

    const roles = conv.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(conv.messages[0].content).toBe('RN gesture-handlerのテキスト選択は可能か');

    const assistant = conv.messages[1];
    expect(assistant.citations).toEqual([
      'https://reactnative.dev/docs/text',
      'https://example.com/gesture-selection',
    ]);
    // フッターノート行は本文から除去されている
    expect(assistant.content).not.toContain('[1]:');
  });

  test('Q/A構造が読めないファイルは全体を1メッセージとしてフォールバックする', () => {
    const result = parsePerplexity('ただのテキスト。見出しなし。', 'note.md');

    expect(result.conversations[0].messages).toHaveLength(1);
    expect(result.conversations[0].messages[0].role).toBe('assistant');
    expect(result.warnings.some((w) => w.message.includes('フォールバック') || w.message.includes('1メッセージ'))).toBe(true);
  });

  test('タイトル見出しが無い場合はファイル名をタイトルにする', () => {
    const result = parsePerplexity('## 質問\n回答', 'my-thread.md');
    expect(result.conversations[0].title).toBe('my-thread');
  });

  test('空ファイルはfailedで返す（例外を投げない）', () => {
    const result = parsePerplexity('   ', 'empty.md');
    expect(result.conversations).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });
});
