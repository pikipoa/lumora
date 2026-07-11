import { computeSegments, locateQuotedText, type MarkerLayer } from '../markerLayout';

describe('computeSegments', () => {
  it('レイヤーが無ければ全体を1セグメントで返す', () => {
    expect(computeSegments('hello world', [])).toEqual([{ text: 'hello world', layer: null }]);
  });

  it('単一レイヤーで前後を分割する', () => {
    const layer: MarkerLayer = { id: 'm1', start: 6, end: 11, kind: 'confirmed', color: 'pink' };
    expect(computeSegments('hello world', [layer])).toEqual([
      { text: 'hello ', layer: null },
      { text: 'world', layer },
    ]);
  });

  it('複数の非重複レイヤーを順序通りに処理する', () => {
    const l1: MarkerLayer = { id: 'm1', start: 0, end: 5, kind: 'proposed', color: null };
    const l2: MarkerLayer = { id: 'm2', start: 6, end: 11, kind: 'confirmed', color: 'blue' };
    expect(computeSegments('hello world', [l2, l1])).toEqual([
      { text: 'hello', layer: l1 },
      { text: ' ', layer: null },
      { text: 'world', layer: l2 },
    ]);
  });

  it('重なるレイヤーは開始位置が早い方を優先する', () => {
    const l1: MarkerLayer = { id: 'm1', start: 0, end: 8, kind: 'confirmed', color: 'red' };
    const l2: MarkerLayer = { id: 'm2', start: 5, end: 11, kind: 'proposed', color: null };
    const segments = computeSegments('hello world', [l1, l2]);
    expect(segments[0]).toEqual({ text: 'hello wo', layer: l1 });
    expect(segments[1]).toEqual({ text: 'rld', layer: l2 });
  });

  it('文末までのレイヤーでも末尾に空セグメントを作らない', () => {
    const layer: MarkerLayer = { id: 'm1', start: 0, end: 11, kind: 'confirmed', color: 'green' };
    expect(computeSegments('hello world', [layer])).toEqual([{ text: 'hello world', layer }]);
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
