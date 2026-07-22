import { parsePerplexity } from '../parsers/perplexity';

/**
 * 実データ検証（2026-07-22、実際にPerplexityでエクスポートした1ターン/6ターンの2スレッドで確認）
 * した構造を模した合成フィクスチャ。ロゴ画像・脚注形式・ターン区切り(`---`)・小見出し(`##`)の
 * 使われ方は実データと同じにしてある（本文の内容自体はテスト用の架空トピック）。
 */
const LOGO =
  '<img src="https://r2cdn.perplexity.ai/pplx-full-logo-primary-dark%402x.png" style="height:64px;margin-right:32px"/>';

describe('parsePerplexity', () => {
  test('単一ターン：##小見出しはユーザーの追加質問にならず、1つのassistantメッセージに統合される', () => {
    const md = `${LOGO}

# サンプル魚の生態について教えて

サンプル魚は淡水域に生息する架空の魚です。詳細は以下の通りです[^1_1]。

## 生息域

主に河川の中流域に生息します[^1_1]。

## 特徴

体長は最大30cmほどです[^1_2]。

<span style="display:none">[^1_3][^1_4]</span>

<div align="center">⁂</div>

[^1_1]: https://example.com/fish-habitat
[^1_2]: https://example.com/fish-size
`;
    const result = parsePerplexity(md, 'sample-fish.md');

    expect(result.failed).toHaveLength(0);
    const conv = result.conversations[0];
    expect(conv.source).toBe('perplexity');
    expect(conv.title).toBe('サンプル魚の生態について教えて');

    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0].role).toBe('user');
    expect(conv.messages[0].content).toBe('サンプル魚の生態について教えて');

    const assistant = conv.messages[1];
    expect(assistant.role).toBe('assistant');
    // ##見出しは別ターンにならず、1つのassistantメッセージ内にそのまま残る
    expect(assistant.content).toContain('## 生息域');
    expect(assistant.content).toContain('## 特徴');
    // ロゴ画像・非表示脚注リスト・装飾区切りは除去される
    expect(assistant.content).not.toContain('r2cdn.perplexity.ai');
    expect(assistant.content).not.toContain('display:none');
    expect(assistant.content).not.toContain('⁂');
    // 脚注定義行は本文から除去される
    expect(assistant.content).not.toContain('https://example.com/fish-habitat');
    expect(assistant.citations).toEqual([
      'https://example.com/fish-habitat',
      'https://example.com/fish-size',
    ]);
  });

  test('複数ターン：`---`区切りで質問ごとにuser/assistantが分かれ、引用はターンごとに独立する', () => {
    const md = `${LOGO}

# サンプル魚の生態について教えて

どこに生息するのか
何を食べるのか

サンプル魚は河川に生息し、主に藻類を食べます[^1_1]。

[^1_1]: https://example.com/fish-diet

---

# 天敵は何ですか？

サンプル魚の天敵はサンプル鳥です[^2_1]。

[^2_1]: https://example.com/fish-predator
`;
    const result = parsePerplexity(md, 'sample-fish-thread.md');

    const conv = result.conversations[0];
    expect(conv.messages).toHaveLength(4);
    expect(conv.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    // 1ターン目：見出し＋補足行がuserメッセージにまとまる
    expect(conv.messages[0].content).toBe('サンプル魚の生態について教えて\n\nどこに生息するのか\n何を食べるのか');
    expect(conv.messages[1].citations).toEqual(['https://example.com/fish-diet']);

    // 2ターン目：見出しのみ（補足行なし）
    expect(conv.messages[2].content).toBe('天敵は何ですか？');
    // 引用はターンごとに独立している（1ターン目の引用が混ざらない）
    expect(conv.messages[3].citations).toEqual(['https://example.com/fish-predator']);
  });

  test('引用マーカーが無いターンは、境界不明のため本文全体をassistant回答として扱う', () => {
    const md = `${LOGO}

# 簡単な質問

はい、その通りです。特に出典はありません。
`;
    const result = parsePerplexity(md, 'no-citation.md');
    const conv = result.conversations[0];
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages[0].content).toBe('簡単な質問');
    expect(conv.messages[1].role).toBe('assistant');
    expect(conv.messages[1].content).toContain('はい、その通りです');
  });

  test('Perplexityのシグネチャ（ロゴ画像/引用マーカー）が無いファイルは汎用ドキュメント（source: document）として取り込む', () => {
    const result = parsePerplexity('ただのテキスト。見出しなし。', 'note.md');

    expect(result.source).toBe('document');
    expect(result.conversations[0].source).toBe('document');
    expect(result.conversations[0].messages).toHaveLength(1);
    expect(result.conversations[0].messages[0].role).toBe('user');
    expect(result.conversations[0].messages[0].content).toBe('ただのテキスト。見出しなし。');
    expect(result.warnings.some((w) => w.message.includes('汎用ドキュメント'))).toBe(true);
  });

  test('##見出しを使った汎用ドキュメントも、Perplexityのシグネチャが無ければdocument扱いになる', () => {
    // 旧実装は「##見出しがあればPerplexity」と誤判定していたが、実データ検証によりシグネチャ
    // （ロゴ画像/引用マーカー）ベースの判定に訂正した（##は汎用文書でも使われるため）
    const result = parsePerplexity('# ロードマップ\n\n## Phase1\n内容\n\n## Phase2\n内容', 'roadmap.md');
    expect(result.source).toBe('document');
  });

  test('タイトル見出しが無い場合はファイル名をタイトルにする', () => {
    const result = parsePerplexity(`${LOGO}\n\n本文のみ[^1_1]。\n\n[^1_1]: https://example.com`, 'my-thread.md');
    expect(result.conversations[0].title).toBe('my-thread');
  });

  test('空ファイルはfailedで返す（例外を投げない）', () => {
    const result = parsePerplexity('   ', 'empty.md');
    expect(result.conversations).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });
});
