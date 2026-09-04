-- 検索契約の回復（2026-08-09）
--
-- 【なぜ必要か】
-- `20260712000002_search_v2.sql` は、v1にあった `order by` を落とし、入力文字列を
-- そのまま1本の ILIKE へ渡している。その結果、`search-spec.md` が **MUST** と定めた
-- 次の契約が成立していない：
--
--   3-1  スペース区切りでトークンに分割し、AND       … 未実装（入力全体が1つの文字列）
--   3-1  引用符付きフレーズ（オプトイン）            … 未実装（常に全体がフレーズ扱い）
--   3-3  着地点：一致箇所を message_id と位置で返す  … 未実装（返り値に無い）
--   3-6  一意なタイブレーカー / NULL順の明示         … SQL側に order by が無い
--
-- 実機でも `AI ChatGPT` が1件、`"AI ChatGPT"` が0件になることが確認されている。
--
-- 【v2を書き換えない理由】
-- 本番に適用済みのマイグレーションを後から書き換えると、適用済み環境と新規環境で
-- 履歴が食い違う。前進マイグレーションとして新しい関数を追加し、v2は残す
-- （呼び出し元を切り替えるまでv2は動き続ける）。
--
-- 【並び順の定義がTypeScript側にもある件】
-- `src/lib/searchSort.ts` が同じ並び順（時刻 → id昇順、created_atはimported_atへフォールバック）を
-- 実装している。**定義が2箇所にある状態は決定性にとって危険**であり、呼び出し元を
-- この関数へ切り替える際に、並び替えはSQL側へ一本化すること。
-- ここでは searchSort.ts と**完全に同じ順序**を返すよう合わせてある。
--
-- 【match_count を返していない理由（SHOULDからの意図的な逸脱・記録）】
-- 3-3 は match_count を SHOULD としつつ、「数え方はハイライト表示の数え方と一致していなければ
-- ならない（MUST）」を課している。重なり合う出現（本文"あああ"の中の"ああ"は2箇所）を
-- SQLとクライアントで別々に実装すると、この MUST を静かに破る。
-- したがってここでは**出現回数を返さない**。代わりに、意味が一義に決まる
-- `matched_message_count`（その語を含むメッセージの件数）を返す。
-- 出現回数版は、ハイライトと共通の実装を1つ用意してから追加する。

-- ---------------------------------------------------------------------------
-- ILIKE のワイルドカードをエスケープする
--
-- ユーザーが `50%` や `user_id` を検索したとき、`%` `_` がワイルドカードとして
-- 解釈されると、本人の入力と違うものが一致する。v2にはこの処理が無い。
-- ---------------------------------------------------------------------------
create or replace function lumora_ilike_pattern(term text)
returns text
language sql
immutable
strict
as $$
  select '%' || replace(replace(replace(term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

comment on function lumora_ilike_pattern(text) is
  'ILIKEのワイルドカード(% _ \)をエスケープし、前後に%を付けた部分一致パターンを返す。search-spec.md 3-4「デフォルトは厳密な部分一致」';

-- ---------------------------------------------------------------------------
-- 横断検索（search-spec.md 3章の契約実装）
--
-- search_terms : 解析済みの語の配列（src/lib/searchQuery.ts が生成）。
--                フレーズは内部の空白を保持したまま1要素。全要素をANDで満たす
-- sort_key     : 'new' | 'old' | 'long' | 'short'（src/lib/searchSort.ts と同じ軸）
-- page_limit   : 1ページの件数。PostgRESTの既定1000行による**暗黙の切り捨て**を避けるため、
--                明示的にページを取る（v2は .limit() 無しで呼ばれており、1000件を超えると
--                「どの1000件か」がプラン依存＝非決定的だった）
-- page_offset  : 取得開始位置
--
-- total_count  : 条件を満たす**総件数**（ページの件数ではない）。全行で同じ値が入る。
--                「取得できた件数」を総件数として表示しないために分けている
-- ---------------------------------------------------------------------------
create or replace function search_conversations_v3(
  search_terms text[],
  sort_key text default 'new',
  page_limit integer default 50,
  page_offset integer default 0
)
returns table (
  id uuid,
  title text,
  source source_type,
  project_id uuid,
  created_at timestamptz,
  imported_at timestamptz,
  total_chars integer,
  -- 着地点（3-3 MUST）。検索からMarker作成へ位置を繋ぐために必須
  hit_message_id uuid,
  hit_seq integer,
  -- 【単位に注意】Postgresの position() は**コードポイント**単位、JSの文字列添字は
  -- UTF-16コードユニット単位。絵文字などサロゲートペアを含む本文ではずれる。
  -- 2026-07-26のマーカー位置ズレ調査と同じ罠なので、名前に単位を書いて取り違えを防ぐ。
  -- クライアントは着地（スクロール）の手がかりとして使い、保存する位置には使わないこと
  hit_offset_codepoints integer,
  hit_excerpt text,
  -- 出現回数ではなく「その語を含むメッセージの件数」。冒頭のコメント参照
  matched_message_count integer,
  total_count bigint
)
language sql
stable
security invoker
as $$
  with matched as (
    select c.*
    from conversations c
    -- 厳密AND（3-2）：**満たされない語が1つも無い**ことを条件にする。
    -- 判定の単位は会話全体——タイトルまたはいずれかのメッセージのどこかに一致すればよく、
    -- 1つのメッセージに全語が揃っている必要はない
    where array_length(search_terms, 1) is not null
      and not exists (
        select 1
        from unnest(search_terms) as t(term)
        where c.title not ilike lumora_ilike_pattern(t.term) escape '\'
          and not exists (
            select 1 from messages m
            where m.conversation_id = c.id
              and m.content ilike lumora_ilike_pattern(t.term) escape '\'
          )
      )
  ),
  -- 着地点：最初の語が最初に現れるメッセージ（seq順）。
  -- 「どこかに一致した」ではなく「ここへ行けばいい」を返すのが3-3の要求
  landing as (
    select
      mt.id as conversation_id,
      m.id as message_id,
      m.seq,
      position(search_terms[1] in m.content) as offset_codepoints,
      substring(
        m.content,
        greatest(1, position(search_terms[1] in m.content) - 40),
        length(search_terms[1]) + 80
      ) as excerpt,
      row_number() over (partition by mt.id order by m.seq) as rn
    from matched mt
    join messages m on m.conversation_id = mt.id
    where m.content ilike lumora_ilike_pattern(search_terms[1]) escape '\'
  ),
  counted as (
    select
      mt.id as conversation_id,
      count(*)::integer as matched_message_count
    from matched mt
    join messages m on m.conversation_id = mt.id
    where exists (
      select 1 from unnest(search_terms) as t(term)
      where m.content ilike lumora_ilike_pattern(t.term) escape '\'
    )
    group by mt.id
  )
  select
    mt.id,
    mt.title,
    mt.source,
    mt.project_id,
    mt.created_at,
    mt.imported_at,
    (select coalesce(sum(length(m.content)), 0)::integer
     from messages m where m.conversation_id = mt.id) as total_chars,
    l.message_id,
    l.seq,
    l.offset_codepoints,
    l.excerpt,
    coalesce(cnt.matched_message_count, 0),
    count(*) over () as total_count
  from matched mt
  left join landing l on l.conversation_id = mt.id and l.rn = 1
  left join counted cnt on cnt.conversation_id = mt.id
  -- 決定性（3-6）：
  --   MUST 1 一意なタイブレーカー … 最後に必ず id 昇順を置く（並び順に関わらず常に昇順）
  --   MUST 2 NULLの位置を明示     … created_at は null を取りうるため coalesce で
  --                                 imported_at へ寄せ、NULLを作らないことで満たす
  --                                 （src/lib/searchSort.ts の conversationTime と同じ扱い）
  order by
    case when sort_key = 'new'   then coalesce(mt.created_at, mt.imported_at) end desc,
    case when sort_key = 'old'   then coalesce(mt.created_at, mt.imported_at) end asc,
    case when sort_key = 'long'  then (select coalesce(sum(length(m.content)), 0)
                                       from messages m where m.conversation_id = mt.id) end desc,
    case when sort_key = 'short' then (select coalesce(sum(length(m.content)), 0)
                                       from messages m where m.conversation_id = mt.id) end asc,
    mt.id asc
  limit page_limit
  offset page_offset;
$$;

comment on function search_conversations_v3(text[], text, integer, integer) is
  '横断検索。search-spec.md 3章の契約実装：厳密AND(3-2)・フレーズ(3-1)・着地点(3-3)・決定的な順序(3-6)。語の解析は src/lib/searchQuery.ts が行う';
