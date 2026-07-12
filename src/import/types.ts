/**
 * インポート層の共通データモデル（import-spec.md §1）。
 * 各社の生データ構造の違いはパーサーで吸収し、アプリ本体はこのモデルしか見ない。
 */

export type Source = 'chatgpt' | 'gemini' | 'claude' | 'perplexity';

export interface ParsedMessage {
  role: 'user' | 'assistant';
  /** プレーンテキストに正規化した本文 */
  content: string;
  /** 表・コードブロック・添付等が復元できなかった場合 true */
  contentFormatLost: boolean;
  /** ISO8601。元データに無ければ null */
  createdAt: string | null;
  /** 引用元URL（Perplexity等）。無ければ null */
  citations: string[] | null;
}

export interface ParsedConversation {
  source: Source;
  /** 元サービス側の会話ID（取れれば保持） */
  sourceConversationId: string | null;
  title: string;
  createdAt: string | null;
  updatedAt: string | null;
  model: string | null;
  messages: ParsedMessage[];
}

/** 会話1件のパース失敗。全体は止めず、S2サマリーで件数提示する */
export interface ParseFailure {
  /** どの会話か特定する手がかり（タイトル・ID・インデックス等） */
  conversationRef: string;
  error: string;
}

/** 未知フィールド・欠損等、失敗ではないが記録しておく事象 */
export interface ParseWarning {
  conversationRef: string;
  message: string;
}

export interface ParseResult {
  source: Source;
  conversations: ParsedConversation[];
  failed: ParseFailure[];
  warnings: ParseWarning[];
}

/** アップロードされたファイル（ZIP展開前の生バイト列） */
export interface ImportFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * 形式判定の結果。
 * unsupported はユーザーに対処法（例：GeminiはJSON形式で再エクスポート）を案内する。
 */
export type DetectResult =
  | { kind: 'chatgpt'; conversationsJsons: string[] }
  | { kind: 'claude'; conversationsJson: string }
  | { kind: 'gemini'; activityJsons: string[]; warnings: string[] }
  | { kind: 'perplexity'; markdown: string; fileName: string }
  | { kind: 'unsupported'; reason: string; guidance: string };
