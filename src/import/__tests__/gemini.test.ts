import { parseGemini } from '../parsers/gemini';

describe('parseGemini', () => {
  test('MyActivity.json（一括形式）：1アクティビティ=1会話として取り込む', () => {
    const activity = [
      {
        header: 'Gemini Apps',
        title: 'Prompted 古着ECの世界観について教えて',
        time: '2026-06-15T09:00:00.000Z',
        subtitles: [{ name: 'RPG風の探索マップを軸にした設計が考えられます' }],
        products: ['Gemini Apps'],
      },
    ];
    const result = parseGemini([JSON.stringify(activity)]);

    expect(result.failed).toHaveLength(0);
    expect(result.conversations).toHaveLength(1);
    const conv = result.conversations[0];
    expect(conv.source).toBe('gemini');
    expect(conv.messages[0]).toMatchObject({ role: 'user', content: '古着ECの世界観について教えて' });
    expect(conv.messages[1]).toMatchObject({ role: 'assistant' });
    expect(conv.messages[1].content).toContain('RPG風');
  });

  test('日本語ロケールの「〜」というプロンプト形式も読める', () => {
    const activity = [
      { header: 'Gemini Apps', title: '「闘着場の入口デザイン」というプロンプトを送信しました', time: '2026-06-15T09:00:00.000Z' },
    ];
    const result = parseGemini([JSON.stringify(activity)]);

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].messages[0].content).toBe('闘着場の入口デザイン');
    // 応答が含まれない場合は警告
    expect(result.warnings.some((w) => w.message.includes('応答テキストがエクスポートに含まれていません'))).toBe(true);
  });

  test('Gemini以外の製品のアクティビティは警告してスキップする', () => {
    const activity = [
      { header: 'Maps', title: 'Searched for ramen', time: '2026-06-15T09:00:00.000Z' },
      { header: 'Gemini Apps', title: 'Prompted hello', time: '2026-06-15T09:01:00.000Z' },
    ];
    const result = parseGemini([JSON.stringify(activity)]);

    expect(result.conversations).toHaveLength(1);
    expect(result.warnings.some((w) => w.message.includes('Maps'))).toBe(true);
  });

  test('会話ごと分割ファイル（messages配列）も汎用マッピングで読める', () => {
    const file = {
      id: 'conv-42',
      title: 'テーマ相談',
      messages: [
        { role: 'user', text: '質問です' },
        { role: 'model', text: '回答です' },
      ],
    };
    const result = parseGemini([JSON.stringify(file)]);

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].sourceConversationId).toBe('conv-42');
    expect(result.conversations[0].messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  test('壊れたJSONファイルはfailedになり、他ファイルは処理される', () => {
    const good = [{ header: 'Gemini Apps', title: 'Prompted ok', time: '2026-06-15T09:00:00.000Z' }];
    const result = parseGemini(['{broken', JSON.stringify(good)]);

    expect(result.failed).toHaveLength(1);
    expect(result.conversations).toHaveLength(1);
  });

  test('フィールドが全て欠けた項目はスキップ扱い（例外を投げない）', () => {
    const result = parseGemini([JSON.stringify([{}, { unknown_field: 1 }])]);
    expect(result.conversations).toHaveLength(0);
    // 失敗ではなく警告（プロンプトが取れない）として扱う
    expect(result.failed).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
