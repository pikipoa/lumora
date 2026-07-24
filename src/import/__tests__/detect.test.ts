import { strToU8, zipSync } from 'fflate';
import { detectFormat } from '../detect';
import { parseImportFile } from '../index';
import type { ImportFile } from '../types';

function zipFile(name: string, entries: Record<string, string>): ImportFile {
  const zipEntries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(entries)) {
    zipEntries[path] = strToU8(content);
  }
  return { name, bytes: zipSync(zipEntries), lastModified: null };
}

function textFile(name: string, content: string): ImportFile {
  return { name, bytes: strToU8(content), lastModified: null };
}

const chatgptJson = JSON.stringify([{ title: 't', mapping: {}, current_node: 'x' }]);
const claudeJson = JSON.stringify([{ uuid: 'u', name: 'n', chat_messages: [] }]);
const geminiActivityJson = JSON.stringify([{ header: 'Gemini Apps', title: 'Prompted hi', time: '2026-01-01T00:00:00Z' }]);

describe('detectFormat', () => {
  test('ChatGPTエクスポートZIP（mapping持ちconversations.json）を判定する', () => {
    const file = zipFile('chatgpt-export.zip', {
      'conversations.json': chatgptJson,
      'chat.html': '<html></html>',
    });
    expect(detectFormat(file).kind).toBe('chatgpt');
  });

  test('ClaudeエクスポートZIP（chat_messages持ちconversations.json）を判定する', () => {
    const file = zipFile('claude-export.zip', { 'conversations.json': claudeJson });
    expect(detectFormat(file).kind).toBe('claude');
  });

  test('分割されたChatGPTエクスポート（conversations-000.json等）を1つにまとめて判定する', () => {
    const file = zipFile('chatgpt-export-large.zip', {
      'conversations-000.json': chatgptJson,
      'conversations-001.json': chatgptJson,
      'chat.html': '<html></html>',
    });
    const r = detectFormat(file);
    expect(r.kind).toBe('chatgpt');
    if (r.kind === 'chatgpt') expect(r.conversationsJsons).toHaveLength(2);
  });

  test('Takeout：ネスト階層（My Activity/Gemini Apps）を判定する', () => {
    const file = zipFile('takeout.zip', {
      'Takeout/My Activity/Gemini Apps/MyActivity.json': geminiActivityJson,
    });
    const r = detectFormat(file);
    expect(r.kind).toBe('gemini');
    if (r.kind === 'gemini') expect(r.activityJsons).toHaveLength(1);
  });

  test('Takeout：会話分割階層（Gemini Apps直下の複数JSON）も判定する', () => {
    const file = zipFile('takeout2.zip', {
      'Takeout/Gemini Apps/conversation_001.json': geminiActivityJson,
      'Takeout/Gemini Apps/conversation_002.json': geminiActivityJson,
    });
    const r = detectFormat(file);
    expect(r.kind).toBe('gemini');
    if (r.kind === 'gemini') expect(r.activityJsons).toHaveLength(2);
  });

  test('Gemini Apps以外のデータ混在は警告を付けつつGemini分を取り込む', () => {
    const file = zipFile('takeout3.zip', {
      'Takeout/My Activity/Gemini Apps/MyActivity.json': geminiActivityJson,
      'Takeout/保存済み/行ってみたい.csv': 'a,b,c',
    });
    const r = detectFormat(file);
    expect(r.kind).toBe('gemini');
    if (r.kind === 'gemini') expect(r.warnings.length).toBeGreaterThan(0);
  });

  test('Gemini Appsを含まないTakeout（例：Mapsのみ）は案内付きで弾く', () => {
    const file = zipFile('takeout-maps.zip', {
      'Takeout/保存済み/行ってみたい.csv': 'a,b,c',
    });
    const r = detectFormat(file);
    expect(r.kind).toBe('unsupported');
    if (r.kind === 'unsupported') expect(r.guidance).toContain('Gemini Apps');
  });

  test('GeminiのHTML形式は「JSONで再エクスポート」案内で弾く', () => {
    const file = zipFile('takeout-html.zip', {
      'Takeout/My Activity/Gemini Apps/MyActivity.html': '<html></html>',
    });
    const r = detectFormat(file);
    expect(r.kind).toBe('unsupported');
    if (r.kind === 'unsupported') expect(r.guidance).toContain('JSON');
  });

  test('生JSON：中身の構造で3社を判別する', () => {
    expect(detectFormat(textFile('conversations.json', chatgptJson)).kind).toBe('chatgpt');
    expect(detectFormat(textFile('conversations.json', claudeJson)).kind).toBe('claude');
    expect(detectFormat(textFile('MyActivity.json', geminiActivityJson)).kind).toBe('gemini');
  });

  test('MarkdownはPerplexityとして扱う', () => {
    expect(detectFormat(textFile('thread.md', '# タイトル\n本文')).kind).toBe('perplexity');
  });

  test('壊れたZIPは案内付きで弾く（例外を投げない）', () => {
    const file: ImportFile = {
      name: 'broken.zip',
      bytes: new Uint8Array([0x50, 0x4b, 0x00, 0x00, 0x01]),
      lastModified: null,
    };
    expect(detectFormat(file).kind).toBe('unsupported');
  });
});

describe('parseImportFile（エントリーポイント統合）', () => {
  test('ZIPアップロード→判定→パースまで一気通貫で動く', () => {
    const file = zipFile('claude-export.zip', {
      'conversations.json': JSON.stringify([
        {
          uuid: 'u1',
          name: '統合テスト',
          chat_messages: [{ sender: 'human', text: 'hello' }],
        },
      ]),
    });
    const outcome = parseImportFile(file);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.source).toBe('claude');
      expect(outcome.result.conversations[0].title).toBe('統合テスト');
    }
  });

  test('未対応ファイルはreason+guidanceを返す', () => {
    const outcome = parseImportFile(textFile('photo.png', 'binary'));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.guidance).toBeTruthy();
  });

  test('汎用ドキュメントは本文に日付が無いため、ファイルの最終更新日時をcreatedAtのフォールバックに使う', () => {
    const lastModified = new Date('2024-03-15T00:00:00Z').getTime();
    const file: ImportFile = { name: 'memo.md', bytes: strToU8('# メモ\n本文'), lastModified };
    const outcome = parseImportFile(file);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const conv = outcome.result.conversations[0];
      expect(conv.createdAt).toBe(new Date(lastModified).toISOString());
      expect(conv.messages[0].createdAt).toBe(new Date(lastModified).toISOString());
    }
  });

  test('最終更新日時が取れない場合はcreatedAtがnullのまま（インポート時刻へのフォールバックはService層に委ねる）', () => {
    const outcome = parseImportFile(textFile('memo.md', '# メモ\n本文'));
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.conversations[0].createdAt).toBeNull();
  });
});
