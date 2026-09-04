/**
 * 検索クエリの解析（2026-08-09）。`search-spec.md` 3-1「検索文法」の実装。
 *
 * 【なぜ必要か】
 * RPC `search_conversations`（20260712000002_search_v2.sql）は入力文字列を**そのまま**
 * `ILIKE '%…%'` へ渡している。つまり `古着 技術` は「古着 技術」という連続した文字列としてしか
 * 一致せず、仕様が **MUST** と定めた次の2つがどちらも成立していない：
 *
 *   `古着 技術`      … スペース区切りでトークンに分割し、AND
 *   `"技術 スタック"` … 1つのフレーズとして扱う（語順・隣接を保持）
 *
 * 実機でも `AI ChatGPT` が1件、`"AI ChatGPT"` が0件になることが確認されている。
 *
 * 【なぜ解析をTypeScript側に置くか】
 * 仕様は実装技術を規定していない（3-4「どの技術でこれを実現するかは実装側の判断」）。
 * SQLの中で文字列を分割すると、**文法の正しさをDBなしでは検証できない**。
 * 文法はユーザーとの契約の中心なので、単体テストで固定できる場所に置く。
 * SQLへは解析済みの配列を渡し、SQL側は「与えられた語をANDで判定する」だけに徹する。
 *
 * 【トークンとフレーズを同じ型で返す理由】
 * 一致は両方とも「部分一致」である（3-4）。`"技術 スタック"` は内部の空白を保持したまま
 * 1つの文字列として部分一致させれば、**語順と隣接は自動的に保たれる**。
 * したがって解析後は両者を区別する必要がなく、`terms` の各要素をANDで満たせばよい。
 * 違いは「入力をどこで切るか」だけであり、そこがこの関数の責務のすべてになる。
 */

export interface ParsedQuery {
  /**
   * AND で満たすべき語。フレーズは内部の空白を保持したまま1要素になる。
   * 空配列＝検索すべき語が無い（空白のみの入力など）。
   */
  terms: string[];
  /**
   * 閉じられていない引用符があったか。入力の終端で閉じたものとして扱うが、
   * UI側が「引用符が閉じていません」と伝えられるように事実だけ返す
   * （検索条件をこちらで勝手に変えない——5章「検索条件はAIが自動変更しない」の精神）。
   */
  hasUnclosedQuote: boolean;
}

/**
 * 検索入力を解析する。
 *
 *   `古着 技術`        → { terms: ['古着', '技術'] }
 *   `"技術 スタック"`   → { terms: ['技術 スタック'] }
 *   `古着 "技術 スタック"` → { terms: ['古着', '技術 スタック'] }
 *
 * 引用符そのものは検索文字に含めない。連続する空白は区切りとしてまとめる。
 * `-` や `:` は Phase2 以降の演算子候補だが、**現時点では普通の文字として扱う**
 * （3-1「演算子を追加する時の必須条件」に従い、リテラル検索の手段を用意しないまま
 * 演算子を導入しない）。
 */
export function parseSearchQuery(input: string): ParsedQuery {
  const terms: string[] = [];
  let current = '';
  let inPhrase = false;
  let hasUnclosedQuote = false;

  const flush = (): void => {
    if (current.length > 0) terms.push(current);
    current = '';
  };

  for (const char of input) {
    if (char === '"') {
      if (inPhrase) {
        // フレーズの終わり。空のフレーズ（""）は語を生まない
        inPhrase = false;
        flush();
      } else {
        // フレーズの始まり。直前まで溜めていた語はここで確定する（`古着"技術 x"`）
        flush();
        inPhrase = true;
      }
      continue;
    }
    if (!inPhrase && /\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
  }

  if (inPhrase) {
    // 閉じられていない引用符は、入力の終端で閉じたものとして扱う。
    // 「打ち終わる前は検索できない」より「打った分で検索できる」ほうが実害が小さい
    hasUnclosedQuote = true;
  }
  flush();

  return { terms, hasUnclosedQuote };
}
