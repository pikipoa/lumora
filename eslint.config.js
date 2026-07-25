// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // 2026-07-24、CI導入時の判断（docs/infra.md「開発フローの原則」参照）：
    // react-hooks/set-state-in-effectとreact-hooks/preserve-manual-memoizationは、
    // このアプリ全体で一貫して使っているデータ取得パターン
    // （useEffect(() => { load() }, [session, load])）そのものを指摘するもので、
    // 個別のバグではなくアーキテクチャ全体の設計判断に関わる。全ファイル書き換えは
    // Phase1開発中のリスクの方が大きいため、CIを止めない警告に留める。
    // react-hooks/refs（render中のref.current直接アクセス）は実際のバグにつながり
    // うるため、errorのまま維持し、既存の違反は個別に修正した
    // （conversation-peek-sheet.tsx、unlock-celebration.tsx：useRef(...).current→
    // useState(() => ...)の遅延初期化に変更）。
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]);
