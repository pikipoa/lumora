import { computeSegments, locateQuotedText, type MarkerLayer } from '../markerLayout';

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
