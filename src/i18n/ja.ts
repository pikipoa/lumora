/**
 * Lumoraの全UI文言（日本語）。i18nの下地（2026-07-12）。
 *
 * - ユーザーの目に触れる文字列はすべてこのファイルに置く（画面へのハードコード禁止）。
 *   将来`en.ts`を追加して`src/i18n/index.ts`で切り替えれば、翻訳は機械的作業になる
 * - ブランド語（Realm/Wing/Chronicle）は`brand`に集約（CLAUDE.md「ブランド命名はUI表示層のみ」）。
 *   Arca/Ore/TagはUIに出さない内部概念のため、ここには置かない
 * - 文言のトーンはDESIGN.md「名詞は世界観、動詞は日常語」に従う：
 *   場所は固有名詞、操作の動詞は必ず日常語（検索する・収納する・保存する・戻す…）
 * - 可変部分を含む文言は関数にする（語順が言語ごとに違うため、テンプレート結合を画面側でしない）
 */

export const ja = {
  brand: {
    appName: 'Lumora',
    realm: 'Realm',
    wing: 'Wing',
    chronicle: 'Chronicle',
  },

  // ブラウザタブ名（ネイティブヘッダーは全画面非表示のため、これは document.title としてのみ使われる）
  routes: {
    home: 'Lumora',
    login: 'ログイン',
    import: 'インポート',
    importSummary: 'インポート完了',
    inbox: '会話一覧',
    conversation: '会話詳細',
    realms: 'Realm',
    realmDetail: 'Realm',
    search: 'Search',
    chronicles: 'Chronicle',
  },

  sources: {
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    claude: 'Claude',
    perplexity: 'Perplexity',
  } as Record<string, string>,

  common: {
    save: '保存',
    cancel: 'キャンセル',
    create: '作成',
    add: '追加',
    later: '後で',
    back: '← 戻る',
    search: '検索',
    run: '実行する',
    logout: 'ログアウト',
    unknownError: '不明なエラー',
    unknownDate: '日付不明',
    items: (n: number) => `${n}件`,
    error: (detail: string) => `エラー: ${detail}`,
  },

  home: {
    searchPlaceholder: '知識を探す',
    coldStartCopy: 'AIとの会話を、知識に。',
    coldStartCta: '会話をインポート →',
    importLink: 'インポート',
    inboxLink: 'Inbox',
    separator: '・',
  },

  login: {
    help: 'Supabaseダッシュボード（Authentication → Users）で作成したアカウントでログインします',
    connectedTo: (url: string) => `接続先: ${url}`,
    urlUnset: '(未設定)',
    emailPlaceholder: 'メールアドレス',
    passwordPlaceholder: 'パスワード',
    loginButton: 'ログイン',
    failed: (message: string) => `ログインに失敗しました: ${message}`,
  },

  importScreen: {
    title: '会話データのアップロード',
    supportedFormats: '対応形式',
    formatChatgpt: '・ChatGPT：公式エクスポートのZIP（conversations.json）',
    formatGemini: '・Gemini：Google TakeoutのZIP（「My Activity」→「Gemini Apps」、JSON形式を指定）',
    formatClaude: '・Claude：公式エクスポートのZIP（conversations.json）',
    formatPerplexity: '・Perplexity：個別スレッドのMarkdownファイル',
    pickFile: 'ファイルを選択してインポート',
    parsing: (fileName: string) => `${fileName} を解析中…`,
    saving: (done: number, total: number) => `保存中… ${done} / ${total} 件`,
    privacyNote:
      'アップロードした原本ファイルはこの端末内にのみ保存され、クラウドには会話テキスト（正規化済み）だけが保存されます。',
  },

  importSummary: {
    sourceBadge: (label: string) => `出典: ${label}`,
    headline: (total: number, succeeded: number) => `${total}件中${succeeded}件を正常にインポートしました`,
    skipped: (n: number) => `${n}件は形式エラー等のためスキップされました`,
    note: 'インポートした会話は未分類（Inbox）に入っています。Realm（プロジェクト）への割り当てとレビューは、レビュー画面の実装後にここから直接始められるようになります。',
    skippedTitle: 'スキップされた会話',
    warningsTitle: (n: number) => `警告（${n}件）`,
    moreWarnings: (n: number) => `…ほか${n}件`,
    backHome: 'ホームへ戻る',
  },

  inbox: {
    titleInbox: '未分類（Inbox）',
    titleRealm: (name: string) => `${name}：割り当て済みの会話`,
    titleRealmFallback: 'プロジェクト内の会話',
    heldSuffix: (label: string) => `${label}（保留一覧）`,
    showHeld: '保留一覧を見る',
    showNormal: '通常一覧に戻る',
    fallbackNote: '横断検索で見つからない時のフォールバック一覧です。会話を開いて本文を選択するとマーカーを作成できます。',
    emptyHeld: '保留中の会話はありません。',
    empty: '会話がまだありません。',
    monthUnknown: '日付不明',
    monthLabel: (year: number, month: number) => `${year}年${month}月`,
    assignToRealm: 'プロジェクトに割り当てる',
    hold: '保留にする',
    restore: '元に戻す',
    deleteConfirm: '本当に削除しますか？元に戻せません',
    deletePermanently: '完全に削除',
    noRealms: 'プロジェクトがまだありません',
  },

  conversation: {
    unassigned: '未分類',
    bodyTitle: '本文',
    bodyHint:
      '文字をドラッグ選択すると新規マーカーを作成できます。ハイライト済み箇所をタップすると、その場で範囲を左右にドラッグ調整してから承認/却下できます。',
    roleUser: 'あなた',
    roleAssistant: 'AI',
    assignPrompt: 'Realmへ収納：',
    realmPickerPrompt: (excerpt: string) => `このマーカーをどのRealmへ収納しますか？「${excerpt}」`,
    noRealmsHint: 'Realmがまだありません（Realm一覧から作成できます）',
    memoTitle: 'メモ',
    memoPlaceholder: 'この会話についてのメモ',
    memoSaved: '✅ 保存しました',
    notFound: '会話が見つかりませんでした。',
  },

  realms: {
    title: 'Realm',
    conversationCount: (n: number) => `会話${n}件`,
    newRealm: '＋ 新しいRealm',
    newRealmFormTitle: '新しいRealm',
    namePlaceholder: 'Realm名',
    descriptionPlaceholder: '説明（任意）',
    seedTagsLabel: '種タグ（任意・後からいつでも追加できます）',
    seedTagPlaceholder: 'タグ名',
  },

  realmDetail: {
    backToList: '← Realm',
    markersLabel: 'マーカー',
    organizeTitle: 'Knowledge Organize',
    organizeSubtitle: 'AIが知識を整理しています',
    organizeDone: (n: number) => `Wing候補を${n}件提案しました`,
    candidatesHeading: (n: number) => `Wing候補の確認 ${n}`,
    otherWing: '別のWingへ…',
    unorganizedHeading: (n: number) => `未整理 ${n}`,
    toWing: 'Wingへ…',
    newWing: '＋ 新しいWing',
    wingNamePlaceholder: 'Wing名',
    emptyRealm:
      'まだこのRealmにマーカーがありません。横断検索から会話を見つけて本文を選択し、マーカーを作成してからここに収納してください。',
    assignedConversations: (n: number) => `割り当て済みの会話：${n}件`,
    emptyWing: 'このWingにはまだマーカーがありません。',
    edited: '編集済み',
    editRevertHint: '（空にして保存すると原文に戻ります）',
    otherWings: (names: string) => `他のWing: ${names}`,
    viewSource: '原文を見る',
    aiPanelOpen: 'AI分析結果を見る',
    aiPanelClose: 'AI分析結果を閉じる',
    removeFromWing: '✕ このWingから外す',
    aiPanelWing: 'Wing',
    aiPanelTags: 'AI Tags',
    noWingsYet: 'まだWingがありません',
    noTagsYet: 'まだタグがありません',
    tagAddPlaceholder: '＋タグを追加',
    tagRenamePlaceholder: '新しい名前',
    tagRename: 'リネーム',
    tagTypeTopic: 'Topic',
    tagTypeConcept: 'Concept',
  },

  searchScreen: {
    placeholder: 'キーワードで検索',
    empty: '該当する会話が見つかりませんでした。',
    sortNew: '新しい順',
    sortOld: '古い順',
    sortLong: '長い順',
    sortShort: '短い順',
    peekClose: '← 検索結果へ戻る',
    peekViewFull: '会話全体を見る',
  },

  chronicle: {
    title: 'Chronicle',
    pendingHeading: (n: number) => `整理待ち ${n}`,
    empty: 'まだマーカーが付いた会話がありません。',
    markerCount: (n: number) => ` ・ マーカー${n}`,
  },

  celebrations: {
    newLabel: 'NEW',
    chronicle: {
      emoji: '📜',
      title: 'Chronicle',
      body: '一文の記憶をたどる、文脈の図書館が開かれました。',
    },
    realm: {
      emoji: '🌍',
      title: 'Realm',
      body: '知識世界が形成されました。',
    },
    tapNext: 'タップして次へ',
    tapClose: 'タップして閉じる',
  },
};
