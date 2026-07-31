import {
  computeSegments,
  extractContext,
  findSegmentInvariantViolations,
  locateQuotedText,
  resolveMarkerPosition,
  type MarkerLayer,
  type TextSegment,
} from '../markerLayout';

describe('computeSegments', () => {
  it('レイヤーが無ければ全体を1セグメントで返す', () => {
    expect(computeSegments('hello world', [])).toEqual([
      { text: 'hello world', layer: null, start: 0, end: 11 },
    ]);
  });

  it('単一レイヤーで前後を分割する', () => {
    const layer: MarkerLayer = { id: 'm1', start: 6, end: 11, kind: 'confirmed', color: 'pink' };
    expect(computeSegments('hello world', [layer])).toEqual([
      { text: 'hello ', layer: null, start: 0, end: 6 },
      { text: 'world', layer, start: 6, end: 11 },
    ]);
  });

  it('複数の非重複レイヤーを順序通りに処理する', () => {
    const l1: MarkerLayer = { id: 'm1', start: 0, end: 5, kind: 'proposed', color: null };
    const l2: MarkerLayer = { id: 'm2', start: 6, end: 11, kind: 'confirmed', color: 'blue' };
    expect(computeSegments('hello world', [l2, l1])).toEqual([
      { text: 'hello', layer: l1, start: 0, end: 5 },
      { text: ' ', layer: null, start: 5, end: 6 },
      { text: 'world', layer: l2, start: 6, end: 11 },
    ]);
  });

  // status: overruled（2026-07-31）
  //
  // 【当時の判断】重なりはMVPでは「開始位置が早い方が先勝ち」で解決していた。
  // 【覆った理由】この規則では、外側のマーカーが常に先に始まるため**入れ子の内側が必ず
  //   画面から消える**。実データで4件（長い引用の中の特定語に色を引いたもの）が
  //   不可視になっていた。詳細は CHANGELOG.md 2026-07-31。
  // 【新しい判断】各文字位置では、その位置を含むマーカーのうち**最小区間**が勝つ
  //   （DESIGN.md「マーカーの重なり — 表示優先順位」）。覆す判例は下の
  //   「入れ子のマーカーは内側が…」以降。
  //
  // CLAUDE.md 2-7 に従い、**期待結果は書き換えず** skip で残す。実装の都合で判例を
  // 書き換えると「なぜ当時そう決まったか」が失われ、同じ事故を繰り返す。
  it.skip('[overruled] 重なるレイヤーは開始位置が早い方を優先する', () => {
    const l1: MarkerLayer = { id: 'm1', start: 0, end: 8, kind: 'confirmed', color: 'red' };
    const l2: MarkerLayer = { id: 'm2', start: 5, end: 11, kind: 'proposed', color: null };
    const segments = computeSegments('hello world', [l1, l2]);
    expect(segments[0]).toEqual({ text: 'hello wo', layer: l1, start: 0, end: 8 });
    expect(segments[1]).toEqual({ text: 'rld', layer: l2, start: 8, end: 11 });
  });

  it('重なるレイヤーは最小区間が優先される（上のoverruledを覆す判例）', () => {
    const l1: MarkerLayer = { id: 'm1', start: 0, end: 8, kind: 'confirmed', color: 'red' };
    const l2: MarkerLayer = { id: 'm2', start: 5, end: 11, kind: 'proposed', color: null };
    // l1は幅8、l2は幅6。重なる 5-8 では狭いl2が勝つ
    expect(computeSegments('hello world', [l1, l2])).toEqual([
      { text: 'hello', layer: l1, start: 0, end: 5 },
      { text: ' world', layer: l2, start: 5, end: 11 },
    ]);
  });

  // 実際に起きた事件（2026-07-31）：長い引用の中の特定語に引いたマーカーが画面から
  // 消えていた。実データの de75feb0（705-1227・ピンク）と 65ed6796（1106-1110・緑）が該当
  it('入れ子のマーカーは内側も表示される（外側は内側の左右に残る）', () => {
    const outer: MarkerLayer = { id: 'outer', start: 0, end: 11, kind: 'confirmed', color: 'pink' };
    const inner: MarkerLayer = { id: 'inner', start: 6, end: 11, kind: 'confirmed', color: 'green' };
    expect(computeSegments('hello world', [outer, inner])).toEqual([
      { text: 'hello ', layer: outer, start: 0, end: 6 },
      { text: 'world', layer: inner, start: 6, end: 11 },
    ]);
  });

  it('入れ子が本文の中央にある場合、外側が内側の両側に残る', () => {
    const outer: MarkerLayer = { id: 'outer', start: 0, end: 11, kind: 'confirmed', color: 'pink' };
    const inner: MarkerLayer = { id: 'inner', start: 5, end: 6, kind: 'confirmed', color: 'green' };
    expect(computeSegments('hello world', [outer, inner])).toEqual([
      { text: 'hello', layer: outer, start: 0, end: 5 },
      { text: ' ', layer: inner, start: 5, end: 6 },
      { text: 'world', layer: outer, start: 6, end: 11 },
    ]);
  });

  it('3重の入れ子でも各層が表示される（色が細かく切り替わるのは仕様）', () => {
    const a: MarkerLayer = { id: 'a', start: 0, end: 11, kind: 'confirmed', color: 'pink' };
    const b: MarkerLayer = { id: 'b', start: 2, end: 9, kind: 'confirmed', color: 'blue' };
    const c: MarkerLayer = { id: 'c', start: 4, end: 6, kind: 'confirmed', color: 'green' };
    expect(computeSegments('hello world', [a, b, c])).toEqual([
      { text: 'he', layer: a, start: 0, end: 2 },
      { text: 'll', layer: b, start: 2, end: 4 },
      { text: 'o ', layer: c, start: 4, end: 6 },
      { text: 'wor', layer: b, start: 6, end: 9 },
      { text: 'ld', layer: a, start: 9, end: 11 },
    ]);
  });

  it('完全に同じ範囲の重複は、入力順が変わっても常に同じ1件が選ばれる（決定性）', () => {
    const x: MarkerLayer = { id: 'aaa', start: 0, end: 5, kind: 'confirmed', color: 'red' };
    const y: MarkerLayer = { id: 'bbb', start: 0, end: 5, kind: 'confirmed', color: 'blue' };
    // 幅が同じならidで一意に決まる。入力順に依存しない
    const forward = computeSegments('hello world', [x, y]);
    const reverse = computeSegments('hello world', [y, x]);
    expect(forward).toEqual(reverse);
    expect(forward[0].layer).toBe(x);
  });

  it('文末までのレイヤーでも末尾に空セグメントを作らない', () => {
    const layer: MarkerLayer = { id: 'm1', start: 0, end: 11, kind: 'confirmed', color: 'green' };
    expect(computeSegments('hello world', [layer])).toEqual([
      { text: 'hello world', layer, start: 0, end: 11 },
    ]);
  });

  // 以下2件は、不変条件チェック（findSegmentInvariantViolations）を導入した際に
  // 実際に検出されたエッジケース。長さ0のセグメントは情報を持たず start < end も
  // 満たさないため、そもそも生成しない仕様に統一した（2026-07-26）。
  it('本文が空なら空配列を返す（長さ0のセグメントを作らない）', () => {
    expect(computeSegments('', [])).toEqual([]);
    expect(computeSegments('', [{ id: 'm1', start: 0, end: 5, kind: 'confirmed', color: 'pink' }])).toEqual([]);
  });

  it('本文の範囲外にはみ出したレイヤーは空セグメントを作らずに切り詰める', () => {
    const layer: MarkerLayer = { id: 'm1', start: 2, end: 999, kind: 'confirmed', color: 'blue' };
    expect(computeSegments('short', [layer])).toEqual([
      { text: 'sh', layer: null, start: 0, end: 2 },
      { text: 'ort', layer, start: 2, end: 5 },
    ]);
  });

  // ここから下は 2026-07-26 のマーカー位置ズレ不具合に対する回帰テスト。
  // 原因は呼び出し側（Reactのrender内）で `let cursor` を加算しながらセグメントの
  // 開始位置を求めていたことで、React Compiler有効下でDOMに付与される値が
  // 単調増加しなくなっていた（例：358 → 369 → 363）。開始位置を純粋関数側で
  // 確定させたため、以下の性質が常に成り立つことを保証する。
  describe('start/end の整合性（位置ズレ不具合の回帰テスト）', () => {
    const content = '0123456789abcdefghij';
    // 同一範囲の重複マーカーを含む、実データで問題が起きた形に近いレイヤー群
    const layers: MarkerLayer[] = [
      { id: 'a', start: 12, end: 15, kind: 'confirmed', color: 'blue' },
      { id: 'b', start: 2, end: 5, kind: 'confirmed', color: 'pink' },
      { id: 'c', start: 12, end: 15, kind: 'confirmed', color: 'green' },
      { id: 'd', start: 7, end: 9, kind: 'confirmed', color: 'red' },
      { id: 'e', start: 2, end: 5, kind: 'confirmed', color: 'yellow' },
    ];

    it('startは配列順に単調増加し、隙間なく連続する', () => {
      const segments = computeSegments(content, layers);
      for (let i = 1; i < segments.length; i++) {
        expect(segments[i].start).toBeGreaterThan(segments[i - 1].start);
        expect(segments[i].start).toBe(segments[i - 1].end);
      }
    });

    it('各セグメントのtextはcontent.slice(start, end)と一致する', () => {
      const segments = computeSegments(content, layers);
      for (const seg of segments) {
        expect(seg.text).toBe(content.slice(seg.start, seg.end));
      }
    });

    it('先頭は0から始まり、末尾はcontentの終端で終わる', () => {
      const segments = computeSegments(content, layers);
      expect(segments[0].start).toBe(0);
      expect(segments[segments.length - 1].end).toBe(content.length);
    });

    it('全セグメントのtextを連結するとcontentに戻る', () => {
      const segments = computeSegments(content, layers);
      expect(segments.map((s) => s.text).join('')).toBe(content);
    });

    it('同じ引数なら何度呼んでも同じ結果を返す（副作用がない）', () => {
      const first = computeSegments(content, layers);
      const second = computeSegments(content, layers);
      const third = computeSegments(content, layers);
      expect(second).toEqual(first);
      expect(third).toEqual(first);
    });
  });

  // computeSegmentsは開発時（__DEV__）にconsole.assertで不変条件を自己検査する。
  // 検査が素通りしているのに安心してしまう（無言の番人になる）ことを防ぐため、
  // 「開発時に検査が有効になる条件が成立していること」と「computeSegmentsの出力が
  // 常に不変条件を満たすこと」を担保する。検査自体が壊れた入力を検出できるかは
  // 後段の findSegmentInvariantViolations のテストで別途保証している。
  describe('開発時の不変条件チェック', () => {
    it('テスト・開発環境では__DEV__が有効（＝自己検査が実行される条件が成立している）', () => {
      expect(__DEV__).toBe(true);
    });

    it('computeSegmentsの出力はどの入力でも不変条件を満たす', () => {
      const cases: [string, MarkerLayer[]][] = [
        ['hello world', []],
        ['hello world', [{ id: 'm1', start: 6, end: 11, kind: 'confirmed', color: 'pink' }]],
        ['hello world', [{ id: 'm1', start: 0, end: 11, kind: 'confirmed', color: 'green' }]],
        // 実データで問題が起きた形：同一範囲の重複マーカーを多数含む
        [
          '0123456789abcdefghij',
          [
            { id: 'a', start: 12, end: 15, kind: 'confirmed', color: 'blue' },
            { id: 'b', start: 2, end: 5, kind: 'confirmed', color: 'pink' },
            { id: 'c', start: 12, end: 15, kind: 'confirmed', color: 'green' },
            { id: 'd', start: 7, end: 9, kind: 'confirmed', color: 'red' },
            { id: 'e', start: 2, end: 5, kind: 'confirmed', color: 'yellow' },
          ],
        ],
        // 範囲が重なり合うケース
        [
          '0123456789',
          [
            { id: 'x', start: 0, end: 6, kind: 'confirmed', color: 'red' },
            { id: 'y', start: 3, end: 10, kind: 'proposed', color: null },
          ],
        ],
        // 本文の範囲を超えるレイヤー（クランプされること）
        ['short', [{ id: 'z', start: 2, end: 999, kind: 'confirmed', color: 'blue' }]],
        ['', []],
      ];

      for (const [content, layers] of cases) {
        const segments = computeSegments(content, layers);
        expect(findSegmentInvariantViolations(content, segments)).toEqual([]);
      }
    });

    it('正常な入力ではconsole.assertによる警告が一切出ない', () => {
      const assertSpy = jest.spyOn(console, 'assert').mockImplementation(() => {});
      try {
        computeSegments('hello world', [{ id: 'm1', start: 6, end: 11, kind: 'confirmed', color: 'pink' }]);
        // 違反があった時だけconsole.assert(false, ...)が呼ばれる実装のため、
        // 正常系では第1引数がfalsyの呼び出しが1件も無いこと
        const failures = assertSpy.mock.calls.filter((call) => !call[0]);
        expect(failures).toEqual([]);
      } finally {
        assertSpy.mockRestore();
      }
    });
  });
});

// 検査そのものが機能するかを検証する。壊れた入力を検出できない番人は、
// いない番人より危険（安心してしまうため）なので、意図的に壊した入力で確認する。
describe('findSegmentInvariantViolations（不変条件チェック自体の検証）', () => {
  const content = 'hello world';
  const seg = (text: string, start: number, end: number): TextSegment => ({ text, layer: null, start, end });

  it('正しいセグメント列では違反を報告しない', () => {
    expect(findSegmentInvariantViolations(content, [seg('hello ', 0, 6), seg('world', 6, 11)])).toEqual([]);
  });

  it('開始位置が前へ戻る（今回の不具合と同じ形）を検出する', () => {
    // 実際にDOMへ付与されていた 358 → 369 → 363 と同じ「戻る」パターン
    const broken = [seg('he', 0, 2), seg('llo wo', 8, 14), seg('rld', 2, 5)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('開始位置が前へ戻った'))).toBe(true);
  });

  it('セグメント間に隙間があるのを検出する', () => {
    const broken = [seg('hello ', 0, 6), seg('orld', 7, 11)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('隙間がある'))).toBe(true);
  });

  it('textとcontent.slice(start,end)の不一致を検出する', () => {
    const broken = [seg('hello ', 0, 6), seg('WORLD', 6, 11)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('content.slice(start,end)と不一致'))).toBe(true);
  });

  it('先頭が0から始まっていないのを検出する', () => {
    const broken = [seg('ello ', 1, 6), seg('world', 6, 11)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('先頭セグメントが0から始まっていない'))).toBe(true);
  });

  it('末尾が本文の終端で終わっていないのを検出する', () => {
    const broken = [seg('hello ', 0, 6), seg('worl', 6, 10)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('末尾セグメントが本文の終端で終わっていない'))).toBe(true);
  });

  it('空または逆順のセグメントを検出する', () => {
    const broken = [seg('hello world', 0, 11), seg('', 11, 11)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('空または逆順のセグメント'))).toBe(true);
  });

  it('startが負の値なのを検出する', () => {
    const broken = [seg('hello ', -1, 6), seg('world', 6, 11)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('startが負の値'))).toBe(true);
  });

  it('endが本文の長さを超えているのを検出する', () => {
    const broken = [seg('hello ', 0, 6), seg('world', 6, 99)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('endが本文の長さを超えている'))).toBe(true);
  });

  it('endが単調増加していないのを検出する', () => {
    // startは前へ戻っていないが、endだけが縮んでいるケース
    const broken = [seg('hello world', 0, 11), seg('d', 11, 8)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('endが単調増加していない'))).toBe(true);
  });

  it('startが単調増加していないのを検出する', () => {
    const broken = [seg('llo ', 3, 7), seg('he', 0, 2)];
    const violations = findSegmentInvariantViolations(content, broken);
    expect(violations.some((v) => v.includes('startが単調増加していない'))).toBe(true);
  });

  it('チェックリストの8条件をすべて検査対象にしている', () => {
    // 1つの壊れたセグメント列に複数の違反を仕込み、それぞれ検出されることを確認する
    const allBroken = [seg('XX', -1, 2), seg('YY', 1, 1), seg('ZZ', 5, 99)];
    const violations = findSegmentInvariantViolations(content, allBroken);
    const joined = violations.join(' / ');
    expect(joined).toContain('startが負の値'); // start >= 0
    expect(joined).toContain('空または逆順のセグメント'); // end >= start ＆ 空セグメント禁止
    expect(joined).toContain('endが本文の長さを超えている'); // end <= content.length
    expect(joined).toContain('content.slice(start,end)と不一致'); // text === slice
    expect(joined).toContain('隙間がある'); // 前セグメントとの連続性
    expect(joined).toContain('末尾セグメントが本文の終端で終わっていない');
  });
});

describe('locateQuotedText', () => {
  it('本文中の一致箇所のoffsetを返す', () => {
    expect(locateQuotedText('hello world', 'world')).toEqual({ start: 6, end: 11 });
  });

  it('一致しない場合はnull', () => {
    expect(locateQuotedText('hello world', 'xyz')).toBeNull();
  });

  it('複数回出現する場合は最初の一致を返す', () => {
    expect(locateQuotedText('abcabc', 'abc')).toEqual({ start: 0, end: 3 });
  });

  it('空文字はnullを返す', () => {
    expect(locateQuotedText('hello', '')).toBeNull();
  });
});

// 2026-07-27追加。「同じ単語の別の場所にマーカーが付く」不具合への対処。
// quoted_textだけで位置を決めると必ず最初の一致になるため、前後の文脈を併せて保存し、
// 3段階（offset → 文脈 → 最初の一致）で解決する。
describe('resolveMarkerPosition', () => {
  // 「Gemini」が3回出てくる本文。実データ（同じ単語が6回出る会話）を模した形
  const content = [
    'AIを3つ使っている。',        // 0-11
    '1つ目はGeminiで下書き用。',   // 12-...
    '2つ目はGeminiで要約用。',
    '3つ目はGeminiで翻訳用。',
  ].join('\n');

  const occurrences: number[] = [];
  {
    let from = 0;
    for (;;) {
      const i = content.indexOf('Gemini', from);
      if (i === -1) break;
      occurrences.push(i);
      from = i + 1;
    }
  }

  it('前提：本文中にGeminiが3回出現する', () => {
    expect(occurrences).toHaveLength(3);
  });

  it('保存されたoffsetと文脈が一致すればそのまま使う（exact）', () => {
    const start = occurrences[2];
    const ctx = extractContext(content, start, start + 6);
    expect(
      resolveMarkerPosition(content, {
        quotedText: 'Gemini',
        startOffset: start,
        endOffset: start + 6,
        contextBefore: ctx.before,
        contextAfter: ctx.after,
      }),
    ).toEqual({ start, end: start + 6, matchType: 'exact' });
  });

  it('【本題】offsetが失われていても、文脈から3つ目のGeminiを特定できる', () => {
    const start = occurrences[2];
    const ctx = extractContext(content, start, start + 6);
    const resolved = resolveMarkerPosition(content, {
      quotedText: 'Gemini',
      startOffset: null, // マイグレーション前の既存マーカーを想定
      endOffset: null,
      contextBefore: ctx.before,
      contextAfter: ctx.after,
    });
    expect(resolved).toEqual({ start, end: start + 6, matchType: 'context' });
    // 最初の一致（＝従来の誤った挙動）に落ちていないこと
    expect(resolved!.start).not.toBe(occurrences[0]);
  });

  it('【本題】offsetが別の出現箇所を指していても、文脈が正しければ訂正される', () => {
    // 保存時に1つ目の位置が計算されてしまったが、文脈は3つ目のもの、という状況。
    // content.slice(start,end)==='Gemini' なので保存時ガードは通過してしまうケース
    const wrongStart = occurrences[0];
    const trueStart = occurrences[2];
    const ctx = extractContext(content, trueStart, trueStart + 6);
    const resolved = resolveMarkerPosition(content, {
      quotedText: 'Gemini',
      startOffset: wrongStart,
      endOffset: wrongStart + 6,
      contextBefore: ctx.before,
      contextAfter: ctx.after,
    });
    expect(resolved).toEqual({ start: trueStart, end: trueStart + 6, matchType: 'context' });
  });

  it('2つ目のGeminiも文脈で正しく特定できる', () => {
    const start = occurrences[1];
    const ctx = extractContext(content, start, start + 6);
    const resolved = resolveMarkerPosition(content, {
      quotedText: 'Gemini',
      startOffset: null,
      endOffset: null,
      contextBefore: ctx.before,
      contextAfter: ctx.after,
    });
    expect(resolved!.start).toBe(start);
  });

  it('文脈が無く複数出現する場合は最初の一致だが、text_onlyとして申告する', () => {
    const resolved = resolveMarkerPosition(content, {
      quotedText: 'Gemini',
      startOffset: null,
      endOffset: null,
      contextBefore: null,
      contextAfter: null,
    });
    expect(resolved).toEqual({ start: occurrences[0], end: occurrences[0] + 6, matchType: 'text_only' });
  });

  it('出現が1回だけなら文脈が無くてもexact', () => {
    const resolved = resolveMarkerPosition(content, {
      quotedText: '翻訳用',
      startOffset: null,
      endOffset: null,
      contextBefore: null,
      contextAfter: null,
    });
    expect(resolved!.matchType).toBe('exact');
    expect(content.slice(resolved!.start, resolved!.end)).toBe('翻訳用');
  });

  it('本文中に見つからなければnull', () => {
    expect(
      resolveMarkerPosition(content, {
        quotedText: '存在しない文字列',
        startOffset: 0,
        endOffset: 8,
        contextBefore: null,
        contextAfter: null,
      }),
    ).toBeNull();
  });

  it('本文が編集されてoffsetがずれても、文脈で追従できる', () => {
    const start = occurrences[2];
    const ctx = extractContext(content, start, start + 6);
    // 先頭に文章が挿入され、全体が後ろへずれた本文
    const shifted = '追記：この会話は再編集されています。\n' + content;
    const resolved = resolveMarkerPosition(shifted, {
      quotedText: 'Gemini',
      startOffset: start, // 旧本文での位置（今は別の場所を指す）
      endOffset: start + 6,
      contextBefore: ctx.before,
      contextAfter: ctx.after,
    });
    expect(shifted.slice(resolved!.start, resolved!.end)).toBe('Gemini');
    expect(resolved!.matchType).toBe('context');
    // ずれた分だけ後ろに来ているはず
    expect(resolved!.start).toBeGreaterThan(start);
  });

  it('解決結果は必ずcontent上で実際にquotedTextを指す（全ケース共通の不変条件）', () => {
    const cases = [
      { startOffset: occurrences[1], endOffset: occurrences[1] + 6 },
      { startOffset: null, endOffset: null },
      { startOffset: 9999, endOffset: 10005 },
    ];
    for (const c of cases) {
      const ctx = extractContext(content, occurrences[1], occurrences[1] + 6);
      const resolved = resolveMarkerPosition(content, {
        quotedText: 'Gemini',
        startOffset: c.startOffset,
        endOffset: c.endOffset,
        contextBefore: ctx.before,
        contextAfter: ctx.after,
      });
      expect(content.slice(resolved!.start, resolved!.end)).toBe('Gemini');
    }
  });
});

describe('extractContext', () => {
  it('前後を指定の長さで切り出す', () => {
    expect(extractContext('0123456789abcdef', 5, 8, 3)).toEqual({ before: '234', after: '89a' });
  });

  it('本文の端では切り詰められる', () => {
    expect(extractContext('abc', 0, 1, 10)).toEqual({ before: '', after: 'bc' });
  });
});
