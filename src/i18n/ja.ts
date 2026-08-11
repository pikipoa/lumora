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
    exportGuide: 'エクスポート手順',
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
    // 対応形式を読んで「で、それはどこで手に入るのか」と詰まる位置に置く導線
    exportGuideLink: 'エクスポート方法が分からない方はこちら',
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
    // タッチでの確定バー（2026-08-02）。時間による自動確定を廃止したことに伴う。
    // 動詞は日常語のまま（DESIGN.md原則8）。「確定」「適用」のような操作語は使わない
    // 文字数を常に表示する（2026-08-05）。モバイルの選択ハンドルは、ドラッグ中に指を
    // 離すと伸長ではなく新しい選択の開始と解釈されることがあり、意図せず選択が縮んで
    // いても見た目のバーは変わらないため気づけない。ルールを知らない人でも
    // 「思ったより少ない」と気づけるよう、常に数を出す
    markSelection: (count: number) => `この範囲にマーカー（${count}文字）`,
    // 確定シートは引用を常に全文表示する（2026-08-03）。長文でも「全部見えている」ことが
    // 分かるよう、文字数を添える
    quoteLength: (count: number) => `${count}文字`,
    // 複数メッセージにまたがる選択（2026-08-03）。markerはmessage_idを1つしか持てないため
    // 作成できない。原因ではなく「次にどうすればよいか」を先に書く（DESIGN.md原則9）
    crossMessage: '1つの発言の中で選び直してください。',
    crossMessageNote: '複数の発言にまたがるマーカーは作成できません。',
    confirmColor: 'この色にする',
    removeMarker: 'このマーカーを外す',
    realmStepTitle: 'どのRealmへ',
    newRealmOption: '＋ 新しいRealm',
    createRealmAndAssign: '作成して収納',
    // シート内のエラー（2026-07-28）。コードから文言へはここで解決する。
    // 文面はDESIGN.md原則9「エラーは、配慮 → 行動 → 必要なら理由」に従う。
    // messageは謝罪＋次の行動、noteは必要な時だけ添える理由（無ければnull）。
    //
    // selection_lostとposition_mismatchのmessageが同一なのは意図的：
    // ユーザーにとって両者の違いは意味を持たず、やることは「選び直す」で同じ。
    // 内部ではコードを分けたままSentryで追跡する。
    // position_mismatchにだけnoteがあるのは、拡張機能が原因の場合「選び直す」を
    // 何度繰り返しても必ず同じ結果になり、理由を知らないと無限に繰り返すため
    sheetError: {
      selection_lost: { message: 'すみません。もう一度テキストを選択してください。', note: null },
      position_mismatch: {
        message: 'すみません。もう一度テキストを選択してください。',
        note: '翻訳・文章校正などのブラウザ拡張機能が原因のことがあります。',
      },
      auth_required: { message: 'サインインを確認してください。', note: null },
      realm_create_failed: {
        message: 'すみません。Realmを作成できませんでした。もう一度お試しください。',
        note: null,
      },
      save_failed: { message: 'すみません。保存できませんでした。もう一度お試しください。', note: null },
      remove_failed: {
        message: 'すみません。マーカーを外せませんでした。もう一度お試しください。',
        note: null,
      },
      realm_assign_failed: {
        message: 'すみません。Realmへ収納できませんでした。もう一度お試しください。',
        note: null,
      },
    },
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

    // アカウント削除（2026-07-31・レビュー承認済み）。
    // 何が消えるかを件数で示す。「本当によろしいですか？」より情報量がある。
    // エクスポート未実装であることを隠さない（trust-model.md）
    deleteAccount: {
      entry: 'アカウントを削除',
      title: 'アカウントを削除します',
      countChronicle: 'Chronicle',
      countArca: 'Arca',
      countRealm: 'Realm',
      irreversible: '取り消せません。',
      noExport: '現在、データのエクスポート機能はありません。削除すると内容を取り出せなくなります。',
      confirmPrompt: '確認のため、メールアドレスを入力してください',
      emailPlaceholder: 'メールアドレス',
      submit: '削除する',
      cancel: 'キャンセル',
      deleting: '削除しています…',
      error: {
        auth_required: 'サインインを確認してください。',
        delete_failed: 'すみません。アカウントを削除できませんでした。もう一度お試しください。',
      },
    },
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

  /**
   * S3.5 エクスポート手順（2026-08-09）。原本は`export-guide.md`。
   *
   * 【なぜアプリ内に持つか】Lumoraは最初のユーザー行動が「他社のサイトで設定画面を辿り、
   * 形式を正しく選び、最大7日待って戻ってくる」であり、製品が何かを返す前に長い前提作業がある。
   * ここで外部リンクへ逃がすと戻ってこない。
   *
   * 【blockの形をそろえている理由】`body`と`steps`のどちらか片方だけを持つ形にすると、
   * 配列の要素型がユニオンになり参照側で型が絞れない。使わない側は空にする。
   */
  exportGuide: {
    title: 'エクスポート手順',
    intro: '取り込むためのファイルを、各サービスから取り出す手順です。',
    chooserTitle: 'どれを選べばいい？',
    chooserWhat: '取り出せるもの',
    chooserTime: 'かかる時間',
    chooserRows: [
      { service: 'ChatGPT', what: '全会話をまとめて', time: '数分〜最大7日' },
      { service: 'Gemini', what: '全会話をまとめて', time: '数分〜数時間' },
      { service: 'Claude', what: '全会話をまとめて', time: '数時間' },
      { service: 'Perplexity', what: '1スレッドずつ', time: 'すぐ' },
    ],
    chooserNote:
      'できあがったファイルを、前の画面の「ファイルを選択してインポート」から渡せば取り込めます。',
    takeoutUrl: 'https://takeout.google.com',
    takeoutLinkLabel: 'takeout.google.com を開く',
    sections: [
      {
        name: 'ChatGPT',
        blocks: [
          {
            heading: 'Android / iPhone・iPad（アプリ）',
            body: '',
            steps: [
              'サイドバー（☰）を開く',
              'プロフィールアイコンをタップ',
              'データ管理（Data Controls）',
              'データをエクスポート（Export Data）',
              '確認画面で実行',
            ],
          },
          {
            heading: 'Windows / Mac（ブラウザ）',
            body: '',
            steps: [
              'プロフィールアイコンをクリック',
              'Settings',
              'Data Controls',
              'Export Data',
              '確認画面で実行',
            ],
          },
          {
            heading: 'スマホのブラウザからでもできます',
            body: 'ChatGPTのWeb版にログインすれば、上のPC版と同じ手順で進められます。入口が違うのはアプリ版だけです。',
            steps: [],
          },
          {
            heading: '実行したあと',
            body: '',
            steps: [
              '確認メールが届く',
              'メール内の「Download data export」を開く',
              'ZIPファイルがダウンロードされる',
              'このZIPをそのままLumoraへ渡す（解凍しなくて構いません）',
            ],
          },
        ],
        warnings: [
          '準備に最大7日かかることがあります。ダウンロードリンクには有効期限があるので、メールが届いたら早めに受け取ってください。',
          'たくさん使っている方は、ZIPの中のconversations.jsonが番号付きで複数に分かれていることがあります。そのまま渡して大丈夫です。',
        ],
      },
      {
        name: 'Gemini（Google Takeout経由）',
        blocks: [
          {
            heading: '',
            body: 'Geminiの会話は、Google Takeoutという別のサービスから取り出します。途中に2つ間違えやすい箇所があります。',
            steps: [],
          },
          {
            heading: '',
            body: '',
            steps: [
              'takeout.google.com を開く',
              '「選択をすべて解除」を押す',
              '一覧から「マイ アクティビティ」だけにチェックを入れる',
              '「マイ アクティビティ」の中の「HTML形式」ボタンを押し、JSONに変更してOK',
              '同じく中の「すべてのアクティビティデータが含まれます」ボタン →「選択をすべて解除」→「Gemini アプリ」だけにチェックしてOK',
              '一番下の「次のステップ」→ 配信方法とファイル形式（.zip）を選んで「エクスポートを作成」',
              'メールで通知が届いたらZIPをダウンロードし、解凍する',
              'Takeout / マイアクティビティ / Gemini アプリ / MyActivity.json をLumoraへ渡す',
            ],
          },
        ],
        warnings: [
          '手順4が最重要です。HTML形式のままだとLumoraは読み込めません。',
          '手順5が間違えやすい箇所です。一覧の上のほうにある単独の「Gemini」項目には、Gemsの設定データしか入っておらず、チャット履歴は含まれません。かならず「マイ アクティビティ」の中から「Gemini アプリ」を選んでください。',
        ],
      },
      {
        name: 'Claude',
        blocks: [
          {
            heading: 'Web版、またはClaude Desktopから',
            body: '',
            steps: [
              '設定',
              'プライバシー',
              'データをエクスポート',
              '数時間後、メールでダウンロードリンクが届く',
              'ZIPをダウンロードして、そのままLumoraへ渡す',
            ],
          },
        ],
        warnings: [
          'ダウンロードリンクの有効期限は24時間です。メールが届いたその日のうちに受け取ってください。',
          'iOS / Androidアプリからはエクスポートできません。Web版かDesktop版を使ってください。',
        ],
      },
      {
        name: 'Perplexity',
        blocks: [
          {
            heading: '',
            body: 'Perplexityには全件をまとめて取り出す機能がありません。残しておきたいスレッドを、1つずつ保存します。',
            steps: [],
          },
          {
            heading: '',
            body: '',
            steps: [
              'ログインし、Libraryなどから対象のスレッドを開く',
              '回答エリアの右上あたりの共有アイコン、またはその隣の「…」を開く',
              'Export as Markdown / PDF / DOCX から、Markdownを選ぶ',
            ],
          },
          {
            heading: 'メニューが見つからないとき',
            body: '',
            steps: [
              'ページを再読み込みする',
              '回答を最後まで表示させる（途中だとメニューが出ないことがあります）',
              '個別の回答の上部にある共有アイコンを確認する',
              'それでも無ければ、本文を全選択してテキストエディタに貼り付けて保存する（最終手段）',
            ],
          },
        ],
        warnings: [
          '「Copy link」は保存になりません。参照用のURLを作る機能なので、リンク先が消えれば内容も見られなくなります。ファイルとして手元に残してください。',
        ],
      },
    ],
    troubleTitle: '困ったとき',
    troubles: [
      {
        q: 'ファイルを選んでもエラーになる',
        a: 'Geminiの場合、形式がHTMLのままの可能性があります。JSONで取り直してください。',
      },
      {
        q: 'Geminiの会話が1件も入っていない',
        a: '単独の「Gemini」項目を選んでいる可能性があります。「マイ アクティビティ」→「Gemini アプリ」で取り直してください。',
      },
      {
        q: 'ダウンロードリンクが切れた',
        a: 'もう一度エクスポートを申請してください。',
      },
    ],
    footnote: '各サービスの画面は更新されることがあります。手順が合わない場合はお知らせください。',
  },
};
