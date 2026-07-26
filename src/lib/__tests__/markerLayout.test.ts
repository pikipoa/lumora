import {
  computeSegments,
  findSegmentInvariantViolations,
  locateQuotedText,
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

  it('重なるレイヤーは開始位置が早い方を優先する', () => {
    const l1: MarkerLayer = { id: 'm1', start: 0, end: 8, kind: 'confirmed', color: 'red' };
    const l2: MarkerLayer = { id: 'm2', start: 5, end: 11, kind: 'proposed', color: null };
    const segments = computeSegments('hello world', [l1, l2]);
    expect(segments[0]).toEqual({ text: 'hello wo', layer: l1, start: 0, end: 8 });
    expect(segments[1]).toEqual({ text: 'rld', layer: l2, start: 8, end: 11 });
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
