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
    resetPassword: 'パスワード再設定',
    import: 'インポート',
    importSummary: 'インポート完了',
    inbox: '会話一覧',
    conversation: '会話詳細',
    realms: 'Realm',
    realmDetail: 'Realm',
    search: 'Search',
    chronicles: 'Chronicle',
    settings: '設定',
  },

  sources: {
    chatgpt: 'ChatGPT',
    gemini: 'Gemini',
    claude: 'Claude',
    perplexity: 'Perplexity',
    document: 'ドキュメント',
    claude_code: 'Claude Code',
  } as Record<string, string>,

  common: {
    save: '保存',
    edit: '編集',
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
    crashTitle: '問題が発生しました',
    crashBody: 'エラーが記録されました。再読み込みしてお試しください。',
    reload: '再読み込み',
    expand: 'もっと見る',
    collapse: '閉じる',
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
    emailPlaceholder: 'メールアドレス',
    passwordPlaceholder: 'パスワード',
    loginButton: 'ログイン',
    failed: (message: string) => `ログインに失敗しました: ${message}`,

    modeLoginTab: 'ログイン',
    modeSignupTab: '新規登録',

    signupHelp: 'メールアドレスとパスワードで登録します',
    signupButton: '新規登録',
    signupSuccess: '確認メールを送信しました。メール内のリンクを開いて登録を完了してください。',
    signupFailed: (message: string) => `登録に失敗しました: ${message}`,

    forgotPasswordLink: 'パスワードをお忘れですか？',
    resetHelp: '登録したメールアドレスに、パスワード再設定用のリンクを送ります',
    resetButton: '再設定メールを送る',
    resetSuccess: 'パスワード再設定用のメールを送信しました。メール内のリンクを開いてください。',
    resetFailed: (message: string) => `送信に失敗しました: ${message}`,
    backToLogin: '← ログインに戻る',

    whySupabaseToggle: 'なぜSupabase（Postgres）を使っているのか？',
    whySupabaseBody:
      'Lumoraは、AIとのチャット履歴という個人的な記録を預かるアプリです。だからこそ、自社製ではなく実績のある技術の上に作っています。\n\n' +
      '・データは東京リージョンのPostgreSQL（業界標準のオープンなデータベース）に、行レベルセキュリティ（RLS）という仕組みで保存されます。データベースの設計上、他のユーザーのデータにはアクセスできない仕組みになっています。\n\n' +
      '・会話の原本ファイル（エクスポートしたZIP/JSON）自体はお使いの端末に留まり、クラウドには送信されません。クラウドに保存されるのは、そこから取り出した会話のテキスト内容（検索やマーカー作成に必要な分）のみです。\n\n' +
      '・ログイン機能は自社製ではなく、実績のあるSupabase Authという仕組みを使っています。',
  },

  resetPassword: {
    title: '新しいパスワードを設定',
    newPasswordPlaceholder: '新しいパスワード',
    confirmButton: '設定する',
    success: 'パスワードを変更しました。',
    goHome: 'ホームへ',
    failed: (message: string) => `変更に失敗しました: ${message}`,
    invalidSession: 'このリンクは無効か、有効期限が切れています。もう一度パスワード再設定メールを送信してください。',
  },

  importScreen: {
    title: '会話データのアップロード',
    supportedFormats: '対応形式',
    formatChatgpt: '・ChatGPT：公式エクスポートのZIP（conversations.json）',
    formatGemini: '・Gemini：Google TakeoutのZIP（「My Activity」→「Gemini Apps」、JSON形式を指定）',
    formatClaude: '・Claude：公式エクスポートのZIP（conversations.json）',
    formatPerplexity: '・Perplexity：個別スレッドのMarkdownファイル',
    formatDocument: '・その他のメモ/ドキュメント：Markdown（.md）・テキスト（.txt）ファイル',
    formatClaudeCode: '・Claude Code：セッション記録（.jsonl）',
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
    note: '取り込んだ会話は、下のボタンから今すぐ確認できます。横断検索から見つけて本文を選択すると、マーカー（Arca）を作成できます。',
    skippedTitle: 'スキップされた会話',
    warningsTitle: (n: number) => `警告（${n}件）`,
    moreWarnings: (n: number) => `…ほか${n}件`,
    viewImported: (n: number) => `取り込んだ${n}件の会話を見る`,
    backHome: 'ホームへ戻る',
  },

  inbox: {
    titleInbox: '未分類（Inbox）',
    titleImportBatch: '今回インポートした会話',
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
    // 選択位置の検証に失敗した時の案内（2026-07-26）。実地調査の結果、原因はほぼ
    // ブラウザ拡張機能によるページ書き換えだったため、真っ先にそれを案内する
    // マーカー確定シート（2026-07-28）。動詞は日常語のまま（DESIGN.md原則8）
    confirmColor: 'この色にする',
    removeMarker: 'このマーカーを外す',
    realmStepTitle: 'どのRealmへ',
    newRealmOption: '＋ 新しいRealm',
    createRealmAndAssign: '作成して収納',
    // シート内のエラー1行（2026-07-28）。コードから文言へはここで解決する。
    // 原因を1つに決めつけず、経路ごとに「次に何をすればよいか」だけを書く。
    // 旧 positionMismatchTitle/Body は`Alert`（react-native-webでは空実装）専用だったため削除し、
    // 拡張機能の可能性だけを「断定しない補足」として position_mismatch に残した
    sheetError: {
      selection_lost: '選択が失われました。もう一度選択してください。',
      auth_required: 'サインイン状態を確認してください。',
      position_mismatch:
        '選択位置を確認できませんでした。もう一度選択してください。' +
        '（翻訳・文章校正などのブラウザ拡張機能が原因のことがあります）',
      realm_create_failed: 'Realmを作成できませんでした。',
    } as const,
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
    organizeQuotaExceeded: '本日のAI整理はすでに上限まで使いました。日付が変わると再度使えます。',
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
    aiPanelOpen: 'AIの理解を確認',
    aiPanelClose: '閉じる',
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
    filterAll: 'すべて',
    peekClose: '← 検索結果へ戻る',
    peekViewFull: '会話全体を見る',
  },

  chronicle: {
    title: 'Chronicle',
    pendingHeading: (n: number) => `整理待ち ${n}`,
    empty: 'まだマーカーが付いた会話がありません。',
    markerCount: (n: number) => ` ・ マーカー${n}`,
  },

  settings: {
    title: '色の意味',
    subtitle: 'すでに無意識に使い分けている色に、自分の言葉で意味をつけておけます。未設定のままでも、今まで通り色だけで使えます。',
    descriptionPlaceholder: '補足があれば',
    saved: '保存しました',
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
