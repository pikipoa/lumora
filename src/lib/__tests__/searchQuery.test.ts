import { parseSearchQuery } from '@/lib/searchQuery';

/**
 * `search-spec.md` 3-1「検索文法」の契約テスト（2026-08-09）。
 *
 * ここに書かれた期待値は、仕様が **MUST** と定めたユーザーとの約束そのものであり、
 * 実装の都合で書き換えてはならない（CLAUDE.md 2-7「歴史を書き換えない」）。
 * 検索基盤を差し替える場合も、この期待値を満たせないものは採用しない
 * （3-6「決定性は実装ではなく契約である」）。
 */
describe('parseSearchQuery — search-spec.md 3-1', () => {
  describe('MUST：スペース区切りでトークンに分割し、AND', () => {
    it('2語をトークンに分ける', () => {
      expect(parseSearchQuery('古着 技術').terms).toEqual(['古着', '技術']);
    });

    it('実機で確認された事例：AI ChatGPT は2語である', () => {
      // v2実装では入力全体を1つの文字列として ILIKE していたため、
      // 「AI ChatGPT」という連続文字列にしか一致しなかった
      expect(parseSearchQuery('AI ChatGPT').terms).toEqual(['AI', 'ChatGPT']);
    });

    it('連続した空白は1つの区切りとして扱う', () => {
      expect(parseSearchQuery('古着   技術').terms).toEqual(['古着', '技術']);
    });

    it('全角スペースでも区切る', () => {
      expect(parseSearchQuery('古着　技術').terms).toEqual(['古着', '技術']);
    });

    it('前後の空白は語を生まない', () => {
      expect(parseSearchQuery('  古着  ').terms).toEqual(['古着']);
    });

    it('空白のみの入力は語を生まない', () => {
      expect(parseSearchQuery('   ').terms).toEqual([]);
    });

    it('空文字は語を生まない', () => {
      expect(parseSearchQuery('').terms).toEqual([]);
    });
  });

  describe('MUST：引用符は1つのフレーズとして扱い、語順・隣接を保持する', () => {
    it('引用符の中の空白は保持され、1語になる', () => {
      expect(parseSearchQuery('"技術 スタック"').terms).toEqual(['技術 スタック']);
    });

    it('引用符そのものは検索文字に含めない', () => {
      const { terms } = parseSearchQuery('"AI ChatGPT"');
      expect(terms).toEqual(['AI ChatGPT']);
      expect(terms[0]).not.toContain('"');
    });

    it('通常の語とフレーズを混ぜられる', () => {
      expect(parseSearchQuery('古着 "技術 スタック"').terms).toEqual(['古着', '技術 スタック']);
    });

    it('フレーズは複数書ける', () => {
      expect(parseSearchQuery('"a b" "c d"').terms).toEqual(['a b', 'c d']);
    });

    it('フレーズの直前に接した語は別の語として確定する', () => {
      expect(parseSearchQuery('古着"技術 スタック"').terms).toEqual(['古着', '技術 スタック']);
    });

    it('空のフレーズは語を生まない', () => {
      expect(parseSearchQuery('""').terms).toEqual([]);
    });

    it('MUST：フレーズはオプトインである（引用符が無ければ全体を1フレーズにしない）', () => {
      // 「現行実装のように入力全体を常にフレーズとして扱うことはしない」（3-1）
      expect(parseSearchQuery('技術 スタック').terms).not.toEqual(['技術 スタック']);
    });
  });

  describe('閉じられていない引用符', () => {
    it('終端で閉じたものとして扱い、事実を返す', () => {
      const parsed = parseSearchQuery('古着 "技術 スタック');
      expect(parsed.terms).toEqual(['古着', '技術 スタック']);
      expect(parsed.hasUnclosedQuote).toBe(true);
    });

    it('正しく閉じていればフラグは立たない', () => {
      expect(parseSearchQuery('"技術 スタック"').hasUnclosedQuote).toBe(false);
    });
  });

  describe('Phase2以降の演算子は、まだ演算子ではない', () => {
    // 3-1「演算子を追加する時の必須条件」：リテラル検索の手段を同時に定義するまで導入しない。
    // 日本語の本文に普通に現れる文字なので、今日から特定の文字列が検索できなくなることを防ぐ
    it('- は除外演算子ではなく、ただの文字として扱う', () => {
      expect(parseSearchQuery('-Shopify').terms).toEqual(['-Shopify']);
    });

    it(': はフィールド指定ではなく、ただの文字として扱う', () => {
      expect(parseSearchQuery('17:30').terms).toEqual(['17:30']);
    });

    it('メモ:のような日本語の慣用表現も壊さない', () => {
      expect(parseSearchQuery('メモ:買い物').terms).toEqual(['メモ:買い物']);
    });
  });

  describe('ILIKEのワイルドカードは、ただの文字として検索できなければならない', () => {
    // 解析器は素通しし、エスケープはSQL側の責務。ここでは「解析で壊さない」ことを固定する
    it('% を含む語をそのまま返す', () => {
      expect(parseSearchQuery('50%').terms).toEqual(['50%']);
    });

    it('_ を含む語をそのまま返す', () => {
      expect(parseSearchQuery('user_id').terms).toEqual(['user_id']);
    });

    it('バックスラッシュを含む語をそのまま返す', () => {
      expect(parseSearchQuery('C:\\Users').terms).toEqual(['C:\\Users']);
    });
  });

  describe('決定性：同じ入力からは常に同じ語が出る', () => {
    it('30回解析しても結果が変わらない', () => {
      const input = '古着 "技術 スタック" -Shopify 50%';
      const first = parseSearchQuery(input).terms;
      for (let i = 0; i < 30; i++) {
        expect(parseSearchQuery(input).terms).toEqual(first);
      }
    });
  });
});
