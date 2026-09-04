-- 検索契約の検証（2026-08-09）
--
-- `search-spec.md` 3章のうち、**DBが無いと確かめられない**契約を検証する。
-- 文法（トークン分割・フレーズ）は `src/lib/__tests__/searchQuery.test.ts` が
-- jestで固定しているので、ここでは扱わない。
--
-- 【使い方】Supabase SQL Editor に貼って実行する。
-- 全体が1つのトランザクションで、**最後に必ず ROLLBACK する**ため、
-- 実データは一切変更されない。失敗した検証は例外で止まる。
--
-- 【前提】20260809000001_search_v3_contract.sql が適用済みであること。

begin;

-- 検証用のユーザー。既存の1人を借りるだけで、行は作らない
create temporary table _v_user on commit drop as
  select id from auth.users limit 1;

do $$
declare
  v_user uuid;
  v_conv_and uuid  := gen_random_uuid();   -- 2語が別メッセージに分かれている会話
  v_conv_phrase uuid := gen_random_uuid(); -- フレーズが隣接して存在する会話
  v_conv_apart uuid  := gen_random_uuid(); -- 同じ2語が離れて存在する会話
  v_conv_partial uuid := gen_random_uuid();-- 片方の語しか無い会話
  v_conv_tie_a uuid := '00000000-0000-4000-8000-00000000000a';
  v_conv_tie_b uuid := '00000000-0000-4000-8000-00000000000b';
  v_conv_null uuid := gen_random_uuid();   -- created_at が NULL の会話
  v_rows integer;
  v_first_run uuid[];
  v_this_run uuid[];
  v_total bigint;
begin
  select id into v_user from _v_user;
  if v_user is null then
    raise exception '検証にはauth.usersに1人以上必要です';
  end if;

  -- ---------------------------------------------------------------
  -- 固定データ
  -- ---------------------------------------------------------------
  insert into conversations (id, user_id, title, source, created_at, imported_at) values
    (v_conv_and,     v_user, 'AND検証',    'chatgpt', '2026-01-01', now()),
    (v_conv_phrase,  v_user, 'フレーズ検証', 'chatgpt', '2026-01-02', now()),
    (v_conv_apart,   v_user, '離散検証',    'chatgpt', '2026-01-03', now()),
    (v_conv_partial, v_user, '部分検証',    'chatgpt', '2026-01-04', now()),
    (v_conv_tie_a,   v_user, '同時刻A',     'chatgpt', '2026-02-01', now()),
    (v_conv_tie_b,   v_user, '同時刻B',     'chatgpt', '2026-02-01', now()),
    (v_conv_null,    v_user, 'NULL日時',    'chatgpt', null,        now());

  insert into messages (user_id, conversation_id, role, content, seq) values
    -- 3-2：全語が会話のどこかにあればよい。1メッセージに揃っている必要はない
    (v_user, v_conv_and, 'user', 'ゼツボウ的な話', 1),
    (v_user, v_conv_and, 'assistant', 'キボウの話', 2),
    -- 3-1：フレーズは語順・隣接を保持する
    (v_user, v_conv_phrase, 'user', 'ゼツボウ キボウ が並んでいる', 1),
    -- 同じ2語があるが隣接していない＝フレーズには一致しない
    (v_user, v_conv_apart, 'user', 'ゼツボウ。間に文章。キボウ。', 1),
    -- 片方しか無い＝厳密ANDでは対象外
    (v_user, v_conv_partial, 'user', 'ゼツボウだけ', 1),
    -- 決定性検証用（同時刻・NULL日時）にも両語を入れておく
    (v_user, v_conv_tie_a, 'user', 'ゼツボウ キボウ', 1),
    (v_user, v_conv_tie_b, 'user', 'ゼツボウ キボウ', 1),
    (v_user, v_conv_null,  'user', 'ゼツボウ キボウ', 1);

  -- ---------------------------------------------------------------
  -- 1. 厳密AND：別メッセージにまたがっても成立する（3-2 MUST）
  -- ---------------------------------------------------------------
  select count(*) into v_rows
  from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 100, 0)
  where id = v_conv_and;
  if v_rows <> 1 then
    raise exception 'FAIL 1: 別メッセージにまたがるANDが成立していない (rows=%)', v_rows;
  end if;

  -- ---------------------------------------------------------------
  -- 2. 厳密AND：1語でも欠けたら対象外（3-2 MUST）
  -- ---------------------------------------------------------------
  select count(*) into v_rows
  from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 100, 0)
  where id = v_conv_partial;
  if v_rows <> 0 then
    raise exception 'FAIL 2: 全語を満たさない会話が結果に含まれている';
  end if;

  -- ---------------------------------------------------------------
  -- 3. フレーズ：隣接している場合だけ一致する（3-1 MUST）
  -- ---------------------------------------------------------------
  select count(*) into v_rows
  from search_conversations_v3(array['ゼツボウ キボウ'], 'new', 100, 0)
  where id = v_conv_phrase;
  if v_rows <> 1 then
    raise exception 'FAIL 3a: 隣接フレーズが一致していない';
  end if;

  select count(*) into v_rows
  from search_conversations_v3(array['ゼツボウ キボウ'], 'new', 100, 0)
  where id = v_conv_apart;
  if v_rows <> 0 then
    raise exception 'FAIL 3b: 離れて出現する語がフレーズとして一致してしまっている';
  end if;

  -- ---------------------------------------------------------------
  -- 4. 決定性：30回実行して順序が完全一致する（3-6 MUST）
  --    同時刻の会話とNULL日時の会話を含めた状態で確かめる
  -- ---------------------------------------------------------------
  select array_agg(id order by ord) into v_first_run
  from (select id, row_number() over () as ord
        from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 100, 0)) s;

  for i in 1..30 loop
    select array_agg(id order by ord) into v_this_run
    from (select id, row_number() over () as ord
          from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 100, 0)) s;
    if v_this_run is distinct from v_first_run then
      raise exception 'FAIL 4: %回目で順序が変わった', i;
    end if;
  end loop;

  -- ---------------------------------------------------------------
  -- 5. 同値時刻でも id 昇順で固定される（3-6 MUST 1）
  -- ---------------------------------------------------------------
  if array_position(v_first_run, v_conv_tie_a) > array_position(v_first_run, v_conv_tie_b) then
    raise exception 'FAIL 5: 同時刻のタイブレーカーがid昇順になっていない';
  end if;

  -- ---------------------------------------------------------------
  -- 6. created_at が NULL でも結果に含まれ、位置が固定される（3-6 MUST 2）
  -- ---------------------------------------------------------------
  if array_position(v_first_run, v_conv_null) is null then
    raise exception 'FAIL 6: created_atがNULLの会話が結果から落ちている';
  end if;

  -- ---------------------------------------------------------------
  -- 7. 着地点：message_id と位置が返る（3-3 MUST）
  -- ---------------------------------------------------------------
  select count(*) into v_rows
  from search_conversations_v3(array['キボウ'], 'new', 100, 0)
  where id = v_conv_and
    and hit_message_id is not null
    and hit_seq = 2
    and hit_offset_codepoints > 0;
  if v_rows <> 1 then
    raise exception 'FAIL 7: 着地点(message_id/seq/offset)が正しく返っていない';
  end if;

  -- ---------------------------------------------------------------
  -- 8. total_count は「取得できた件数」ではなく総件数（監査P0-1）
  -- ---------------------------------------------------------------
  select total_count into v_total
  from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 2, 0) limit 1;
  select count(*) into v_rows
  from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 2, 0);
  if v_rows <> 2 then
    raise exception 'FAIL 8a: page_limitが効いていない (rows=%)', v_rows;
  end if;
  if v_total <= 2 then
    raise exception 'FAIL 8b: total_countがページの件数と同じになっている (total=%)', v_total;
  end if;

  -- ---------------------------------------------------------------
  -- 9. ページ境界で重複・欠落が無い（3-6 MUST 1の実害）
  -- ---------------------------------------------------------------
  select array_agg(id order by ord) into v_this_run
  from (
    select id, row_number() over () as ord from (
      select id from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 2, 0)
      union all
      select id from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 2, 2)
      union all
      select id from search_conversations_v3(array['ゼツボウ','キボウ'], 'new', 2, 4)
    ) p
  ) s;
  if (select count(distinct x) from unnest(v_this_run) x) <> array_length(v_this_run, 1) then
    raise exception 'FAIL 9: ページ境界で会話が重複している';
  end if;

  -- ---------------------------------------------------------------
  -- 10. ワイルドカードがリテラルとして扱われる（v2に無かった処理）
  -- ---------------------------------------------------------------
  insert into conversations (id, user_id, title, source, created_at, imported_at)
    values (gen_random_uuid(), v_user, '進捗は50%です', 'chatgpt', '2026-03-01', now());
  select count(*) into v_rows
  from search_conversations_v3(array['%'], 'new', 1000, 0);
  if v_rows = 0 then
    raise exception 'FAIL 10a: リテラルの%%が検索できない';
  end if;
  select count(*) into v_rows
  from search_conversations_v3(array['ゼツボウ_キボウ'], 'new', 1000, 0);
  if v_rows <> 0 then
    raise exception 'FAIL 10b: _ がワイルドカードとして解釈されている';
  end if;

  raise notice 'すべての契約検証をPASSしました';
end $$;

-- 実データを一切変更しない
rollback;
