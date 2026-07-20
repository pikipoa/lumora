-- 「解放演出」の既読フラグ（unlock-celebration.tsx）を、端末ローカルのAsyncStorage/localStorageから
-- DBへ移す（2026-07-13、バグ修正）。
--
-- 不具合：ログアウト→再ログイン（別ブラウザ・別デバイス・localStorage消去等でも同様）すると、
-- 既に達成済みのRealm/Chronicle解放演出が毎回再表示されてしまう。原因は、`hasRealmAssignedMarker`
-- 等の「現在値」はDB由来で永続的にtrueのまま残るのに対し、「もう見たか」の既読フラグだけが
-- 端末ローカル（Web版はlocalStorage、オリジン単位）に閉じており、ブラウザ/デバイスが変わると
-- 消えてしまうため。本来アカウント単位で永続すべき状態が端末単位の一時的な保存先に置かれていた
-- 設計ミスであり、DBへ移すことで根本的に解消する。

create table unlock_flags (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  arca_chronicle boolean not null default false,
  realm boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table unlock_flags enable row level security;
create policy "own rows" on unlock_flags for all using (user_id = auth.uid()) with check (user_id = auth.uid());
