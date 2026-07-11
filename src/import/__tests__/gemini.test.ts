import { parseGemini } from '../parsers/gemini';

describe('parseGemini', () => {
  test('MyActivity.json（一括形式）：1アクティビティ=1会話として取り込む（実データ形式：safeHtmlItem）', () => {
    const activity = [
      {
        header: 'Gemini アプリ',
        title: '送信したメッセージ: 古着ECの世界観について教えて',
        time: '2026-06-15T09:00:00.000Z',
        safeHtmlItem: [{ html: '<p>RPG風の探索マップを軸にした設計が考えられます</p>' }],
        products: ['Gemini アプリ'],
      },
    ];
    const result = parseGemini([JSON.stringify(activity)]);

    expect(result.failed).toHaveLength(0);
    expect(result.conversations).toHaveLength(1);
    const conv = result.conversations[0];
    expect(conv.source).toBe('gemini');
    expect(conv.messages[0]).toMatchObject({ role: 'user', content: '古着ECの世界観について教えて' });
    expect(conv.messages[1]).toMatchObject({ role: 'assistant' });
    expect(conv.messages[1].content).toContain('RPG風の探索マップ');
  });

  test('safeHtmlItemが複数要素の場合は連結する', () => {
    const activity = [
      {
        header: 'Gemini アプリ',
        title: '送信したメッセージ: 続きを教えて',
        time: '2026-06-15T09:00:00.000Z',
        safeHtmlItem: [{ html: '<p>前半の回答</p>' }, { html: '<p>後半の回答</p>' }],
      },
    ];
    const result = parseGemini([JSON.stringify(activity)]);
    expect(result.conversations[0].messages[1].content).toContain('前半の回答');
    expect(result.conversations[0].messages[1].content).toContain('後半の回答');
  });

  test('HTMLタグはプレーンテキストに変換される（見出し・リスト・強調等）', () => {
    const activity = [
      {
        header: 'Gemini アプリ',
        title: '送信したメッセージ: 整形テスト',
        time: '2026-06-15T09:00:00.000Z',
        safeHtmlItem: [
          { html: '<h2>見出し</h2><ul><li>項目1</li><li>項目2</li></ul><p><strong>太字</strong>の本文</p>' },
        ],
      },
    ];
    const result = parseGemini([JSON.stringify(activity)]);
    const content = result.conversations[0].messages[1].content;
    expect(content).toContain('見出し');
    expect(content).toContain('- 項目1');
    expect(content).toContain('太字の本文');
    expect(content).not.toMatch(/<[a-z]/i);
  });

  test('添付ファイルはcitationsとしてファイル名を記録する（原本は取り込まない）', () => {
    const activity = [
      {
        header: 'Gemini アプリ',
        title: '送信したメッセージ: この画像を見て',
        time: '2026-06-15T09:00:00.000Z',
        safeHtmlItem: [{ html: '<p>画像を確認しました</p>' }],
        attachedFiles: ['1000002256-e2669d7e39a642e3.jpg'],
        imageFile: '1000002256-e2669d7e39a642e3.jpg',
      },
    ];
    const result = parseGemini([JSON.stringify(activity)]);
    expect(result.conversations[0].messages[0].citations).toEqual([
      '添付ファイル: 1000002256-e2669d7e39a642e3.jpg',
    ]);
  });

  test('safeHtmlItemが無くsubtitlesのみの場合はフォールバックとして使う（Gemini Canvas作成等）', () => {
    const activity = [
      {
        header: 'Gemini アプリ',
        title: '〇〇 というタイトルの Gemini Canvas を作成しました',
        time: '2026-06-15T09:00:00.000Z',
        subtitles: [{ name: '<html>生成されたコード</html>' }],
      },
    ];
    const result = parseGemini([JSON.stringify(activity)]);
    expect(result.conversations).toHaveLength(1);
    // 既知のプロンプト形式に一致しないが応答があるため、タイトル全体をプロンプト扱いにする
    expect(result.conversations[0].messages[0].content).toContain('Gemini Canvas を作成しました');
    expect(result.conversations[0].messages[1].content).toContain('生成されたコード');
  });

  test('プロンプトも応答も無い純粋な使用ログはスキップする', () => {
    const activity = [
      { header: 'Gemini アプリ', title: '使用: Gemini アプリ', time: '2026-06-15T09:00:00.000Z' },
      {
        header: 'Gemini アプリ',
        title: '送信したメッセージ: hello',
        time: '2026-06-15T09:01:00.000Z',
        safeHtmlItem: [{ html: '<p>hi</p>' }],
      },
    ];
    const result = parseGemini([JSON.stringify(activity)]);
    expect(result.conversations).toHaveLength(1);
    expect(result.warnings.some((w) => w.message.includes('使用ログ'))).toBe(true);
  });

  test('応答が含まれない場合は警告を残しつつプロンプトのみ取り込む', () => {
    const activity = [
      { header: 'Gemini アプリ', title: '送信したメッセージ: 闘着場の入口デザイン', time: '2026-06-15T09:00:00.000Z' },
    ];
    const result = parseGemini([JSON.stringify(activity)]);

    expect(result.conversations).toHaveLength(1);
    expect(result.conversations[0].messages[0].content).toBe('闘着場の入口デザイン');
    expect(result.warnings.some((w) => w.message.includes('応答テキストがエクスポートに含まれていません'))).toBe(true);
  });

  test('Gemini以外の製品のアクティビティは警告してスキップする', () => {
    const activity = [
      { header: 'Maps', title: 'Searched for ramen', time: '2026-06-15T09:00:00.000Z' },
      {
        header: 'Gemini アプリ',
        title: '送信したメッセージ: hello',
        time: '2026-06-15T09:01:00.000Z',
        safeHtmlItem: [{ html: '<p>hi</p>' }],
      },
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
    const good = [
      {
        header: 'Gemini アプリ',
        title: '送信したメッセージ: ok',
        time: '2026-06-15T09:00:00.000Z',
        safeHtmlItem: [{ html: '<p>ok!</p>' }],
      },
    ];
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
