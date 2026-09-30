-- ============================================================================
-- チラシ配布実績管理アプリ  スキーマ定義
-- Supabase ダッシュボードの SQL Editor で、上から順にそのまま実行してください。
-- 何度実行しても安全なように、可能な範囲で冪等（idempotent）に記述しています。
-- ============================================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid() 用

-- ────────────────────────────────────────────────────────────────────────────
-- 4-4. schools（対象小学校マスタ）
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  lat        double precision,  -- 小学校のおおよその座標（任意）
  lng        double precision,
  url        text,              -- 小学校ホームページのURL（任意）
  created_at timestamptz not null default now()
);
-- 既存DB向け: 後からカラムを追加（何度実行してもよい）
alter table public.schools add column if not exists lat double precision;
alter table public.schools add column if not exists lng double precision;
alter table public.schools add column if not exists url text;

-- ────────────────────────────────────────────────────────────────────────────
-- map_notes（マップメモ）
-- 配布実績とは別に、地図上へ色付きの目印＋メモを置く機能。
-- 色＋見出し＋メモの汎用的な目印。色に固定の意味は持たせず、用途は利用者が自由に決める。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.map_notes (
  id         uuid primary key default gen_random_uuid(),
  lat        double precision not null,
  lng        double precision not null,
  color      text not null default 'yellow',  -- 色トークン（アプリ側で色に対応付け）
  label      text,                             -- 見出し（自由入力）
  memo       text,                             -- 詳細メモ
  user_id    uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- 4-1. locations（配布場所マスタ）
-- 同一地点（学校＋立ち位置）への複数回の配布履歴をまとめる単位
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.locations (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid references public.schools(id) on delete restrict,
  spot       text,                 -- 立ち位置（例: 西側、正門西側、丁字路右側）
  label      text,                 -- 任意の場所ラベル（建物名など）
  lat        double precision,     -- 緯度（未配置なら null）
  lng        double precision,     -- 経度（未配置なら null）
  created_at timestamptz not null default now()
);
create index if not exists idx_locations_school on public.locations(school_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4-2. visits（配布履歴）
-- 1つの location に対して複数回登録される個別の配布実績記録
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.visits (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete restrict,
  user_id     uuid references auth.users(id) default auth.uid(),  -- 配布した人
  date        date not null,
  start_time  time,
  end_time    time,
  count       integer,
  rating      text not null default 'normal' check (rating in ('good', 'normal', 'bad')),
  memo        text,
  is_deleted  boolean not null default false,  -- 論理削除（物理削除は行わない）
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_visits_location on public.visits(location_id);
create index if not exists idx_visits_order on public.visits(date desc, start_time desc);

-- ────────────────────────────────────────────────────────────────────────────
-- 4-3. visit_logs（配布履歴の変更ログ / 監査ログ）
-- visits への create / update / delete をトリガーで自動記録する
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.visit_logs (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references public.visits(id) on delete cascade,
  user_id     uuid references auth.users(id),
  action      text not null check (action in ('create', 'update', 'delete')),
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_visit_logs_visit on public.visit_logs(visit_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- profiles（メンバー情報）
-- auth.users は直接参照できないため、表示名・メールを保持する公開プロフィール。
-- 「誰が配布したか」「誰が変更したか」の表示に使う。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- 新規サインアップ時に profiles を自動作成
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, email)
    values (new.id, new.email)
    on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 既存ユーザー分を補完（何度実行してもよい）
insert into public.profiles(id, email)
  select id, email from auth.users
  on conflict (id) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- トリガー: updated_at の自動更新
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_visits_updated_at on public.visits;
create trigger trg_visits_updated_at
  before update on public.visits
  for each row execute function public.set_updated_at();

drop trigger if exists trg_map_notes_updated_at on public.map_notes;
create trigger trg_map_notes_updated_at
  before update on public.map_notes
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- トリガー: visits の変更を visit_logs に自動記録
--   INSERT                        -> action 'create'（before=null）
--   UPDATE で is_deleted false→true -> action 'delete'（after=null）
--   それ以外の UPDATE             -> action 'update'
-- security definer で RLS を跨いで visit_logs に書き込む
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.log_visit_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.visit_logs(visit_id, user_id, action, before_data, after_data)
      values (new.id, auth.uid(), 'create', null, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    if (old.is_deleted = false and new.is_deleted = true) then
      insert into public.visit_logs(visit_id, user_id, action, before_data, after_data)
        values (new.id, auth.uid(), 'delete', to_jsonb(old), null);
    else
      insert into public.visit_logs(visit_id, user_id, action, before_data, after_data)
        values (new.id, auth.uid(), 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_visits_log on public.visits;
create trigger trg_visits_log
  after insert or update on public.visits
  for each row execute function public.log_visit_changes();

-- ────────────────────────────────────────────────────────────────────────────
-- ビュー: location_pin_status
-- 各 location について、未削除 visits のうち「date, start_time が最新」1件の
-- rating を返す。地図のピン色決定に使う。
-- security_invoker=on で、閲覧ユーザーの RLS を適用する。
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.location_pin_status
with (security_invoker = on) as
select distinct on (l.id)
  l.id                as location_id,
  v.id                as latest_visit_id,
  v.rating            as latest_rating,
  v.date              as latest_date,
  v.start_time        as latest_start_time
from public.locations l
left join public.visits v
  on v.location_id = l.id and v.is_deleted = false
order by l.id, v.date desc nulls last, v.start_time desc nulls last;

-- ============================================================================
-- Data API への権限付与（GRANT）
--   Supabase の「Automatically expose new tables」を OFF にしていても
--   アプリ（authenticated ロール）からアクセスできるよう、明示的に付与する。
--   anon（未認証）には一切付与しない＝未ログインはアクセス不可。
--   実際の行レベルの可否は後述の RLS ポリシーで制御する。
-- ============================================================================
grant usage on schema public to authenticated;

grant select, insert, update, delete on public.schools    to authenticated;
grant select, insert, update, delete on public.locations  to authenticated;
grant select, insert, update          on public.visits     to authenticated; -- DELETE は付与しない
grant select                          on public.visit_logs to authenticated; -- 書き込みはトリガー経由のみ
grant select, update                  on public.profiles   to authenticated;
grant select, insert, update, delete  on public.map_notes  to authenticated;
grant select                          on public.location_pin_status to authenticated;

-- ============================================================================
-- Row Level Security（RLS）
--   方針: 認証済み（authenticated）ユーザーはチームで共有・相互編集できる。
--         未認証（anon）ロールは一切アクセス不可。
--         visits は物理 DELETE を許可しない（論理削除で運用）。
--         visit_logs はトリガー（security definer）経由でのみ書き込まれる。
-- ============================================================================
alter table public.schools    enable row level security;
alter table public.locations  enable row level security;
alter table public.visits     enable row level security;
alter table public.visit_logs enable row level security;
alter table public.profiles   enable row level security;
alter table public.map_notes  enable row level security;

-- map_notes: 認証済みは全操作可（チームで共有・相互編集）
drop policy if exists map_notes_select on public.map_notes;
drop policy if exists map_notes_insert on public.map_notes;
drop policy if exists map_notes_update on public.map_notes;
drop policy if exists map_notes_delete on public.map_notes;
create policy map_notes_select on public.map_notes for select to authenticated using (true);
create policy map_notes_insert on public.map_notes for insert to authenticated with check (true);
create policy map_notes_update on public.map_notes for update to authenticated using (true) with check (true);
create policy map_notes_delete on public.map_notes for delete to authenticated using (true);

-- profiles: 認証済みは全員参照可。自分の表示名のみ更新可。
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

-- schools: 認証済みは全操作可（追加・削除あり）
drop policy if exists schools_select on public.schools;
drop policy if exists schools_insert on public.schools;
drop policy if exists schools_update on public.schools;
drop policy if exists schools_delete on public.schools;
create policy schools_select on public.schools for select to authenticated using (true);
create policy schools_insert on public.schools for insert to authenticated with check (true);
create policy schools_update on public.schools for update to authenticated using (true) with check (true);
create policy schools_delete on public.schools for delete to authenticated using (true);

-- locations: 認証済みは全操作可
drop policy if exists locations_select on public.locations;
drop policy if exists locations_insert on public.locations;
drop policy if exists locations_update on public.locations;
drop policy if exists locations_delete on public.locations;
create policy locations_select on public.locations for select to authenticated using (true);
create policy locations_insert on public.locations for insert to authenticated with check (true);
create policy locations_update on public.locations for update to authenticated using (true) with check (true);
create policy locations_delete on public.locations for delete to authenticated using (true);

-- visits: 認証済みは 参照・追加・更新 可。DELETE ポリシーは作らない＝物理削除は不可
drop policy if exists visits_select on public.visits;
drop policy if exists visits_insert on public.visits;
drop policy if exists visits_update on public.visits;
create policy visits_select on public.visits for select to authenticated using (true);
create policy visits_insert on public.visits for insert to authenticated with check (true);
create policy visits_update on public.visits for update to authenticated using (true) with check (true);

-- visit_logs: 認証済みは参照のみ。書き込みはトリガー（security definer）経由のみ
drop policy if exists visit_logs_select on public.visit_logs;
create policy visit_logs_select on public.visit_logs for select to authenticated using (true);
