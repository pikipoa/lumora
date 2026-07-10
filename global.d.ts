// expo-env.d.ts（expo start時に自動生成・gitignore対象）が無い状態でも
// tsc --noEmit が通るようにするためのCSSモジュール宣言。
declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}
declare module '*.css';
