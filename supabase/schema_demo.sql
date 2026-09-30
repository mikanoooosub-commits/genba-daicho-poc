-- ============================================================================
-- デモ用スキーマ定義（demo スキーマ）
--
-- 目的:
--   本番データ（public スキーマ）と完全に分離した「デモ用データ置き場」を、
--   同じ Supabase プロジェクト内に用意する。
--   アプリはログイン画面のチェックボックスで参照スキーマを public / demo に切り替える。
--
-- なぜ「フラグ列（is_demo）」ではなく「別スキーマ」か:
--   参照の切替はアプリ側のチェックボックス（＝クライアント由来）で行うため、RLS では
--   制御できない（RLS は「誰か（JWT）」でしか出し分けられない）。
--   同一テーブルにフラグで同居させると「絞り忘れ＝本番データが出る」事故になるが、
--   スキーマを分ければ demo を参照している限り本番行は物理的に出てこない。
--   さらに切替点が createClient() の1か所に閉じるため、コードの改修も最小になる。
--
-- 前提:
--   1. 先に supabase/schema.sql（public）が適用済みであること
--   2. 適用後、Supabase ダッシュボードで demo スキーマを API に公開すること
--      Settings → API → Exposed schemas に "demo" を追加
--      （これをしないと PostgREST 経由で参照できず、アプリから 404 になる）
--
-- 冪等（idempotent）: 何度実行しても安全。
-- 戻し方: 本ファイル末尾のロールバックSQL（コメントアウト）を参照。
-- ============================================================================

create schema if not exists demo;

-- ────────────────────────────────────────────────────────────────────────────
-- 本番（public）との構造上の差分と、その理由
--   auth.users への外部キーを demo では張らない。
--   理由: デモデータは実在しない架空メンバーが登録したことにするため、
--         auth.users に存在しない user_id を seed する必要がある。
--         FK があると seed できない。デモ内の整合性（visits→locations 等）は維持する。
-- ────────────────────────────────────────────────────────────────────────────

-- ── schools（対象小学校マスタ） ─────────────────────────────────────────────
create table if not exists demo.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  lat        double precision,
  lng        double precision,
  url        text,
  created_at timestamptz not null default now()
);

-- ── map_notes（マップメモ） ─────────────────────────────────────────────────
create table if not exists demo.map_notes (
  id         uuid primary key default gen_random_uuid(),
  lat        double precision not null,
  lng        double precision not null,
  color      text not null default 'yellow',
  label      text,
  memo       text,
  user_id    uuid default auth.uid(),   -- 本番と違い auth.users への FK なし（上記理由）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── locations（配布場所マスタ） ─────────────────────────────────────────────
create table if not exists demo.locations (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid references demo.schools(id) on delete restrict,
  spot       text,
  label      text,
  lat        double precision,
  lng        double precision,
  created_at timestamptz not null default now()
);
create index if not exists idx_demo_locations_school on demo.locations(school_id);

-- ── visits（配布履歴） ──────────────────────────────────────────────────────
create table if not exists demo.visits (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references demo.locations(id) on delete restrict,
  user_id     uuid default auth.uid(),   -- 本番と違い auth.users への FK なし（上記理由）
  date        date not null,
  start_time  time,
  end_time    time,
  count       integer,
  rating      text not null default 'normal' check (rating in ('good', 'normal', 'bad')),
  memo        text,
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_demo_visits_location on demo.visits(location_id);
create index if not exists idx_demo_visits_order on demo.visits(date desc, start_time desc);

-- ── visit_logs（監査ログ） ──────────────────────────────────────────────────
create table if not exists demo.visit_logs (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references demo.visits(id) on delete cascade,
  user_id     uuid,                      -- 本番と違い auth.users への FK なし（上記理由）
  action      text not null check (action in ('create', 'update', 'delete')),
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_demo_visit_logs_visit on demo.visit_logs(visit_id, created_at desc);

-- ── profiles（メンバー情報） ────────────────────────────────────────────────
-- 変更履歴の「誰が変えたか」表示に使う（actions.ts の getVisitLogsAction が参照）。
create table if not exists demo.profiles (
  id           uuid primary key,         -- 本番と違い auth.users への FK なし（上記理由）
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- トリガー
--   set_updated_at は public のものをそのまま再利用する。
--   理由: new.updated_at を設定するだけでスキーマに依存しないため、複製する必要がない。
--
--   log_visit_changes は public 版が public.visit_logs に固定で書き込むため、demo 用に別途用意する。
--   理由: 本番で稼働中のトリガー関数には手を触れない（本番の監査ログを壊すリスクを取らない）。
-- ────────────────────────────────────────────────────────────────────────────

drop trigger if exists trg_demo_visits_updated_at on demo.visits;
create trigger trg_demo_visits_updated_at
  before update on demo.visits
  for each row execute function public.set_updated_at();

drop trigger if exists trg_demo_map_notes_updated_at on demo.map_notes;
create trigger trg_demo_map_notes_updated_at
  before update on demo.map_notes
  for each row execute function public.set_updated_at();

create or replace function demo.log_visit_changes()
returns trigger
language plpgsql
security definer
set search_path = demo
as $$
begin
  if (tg_op = 'INSERT') then
    insert into demo.visit_logs(visit_id, user_id, action, before_data, after_data)
      values (new.id, auth.uid(), 'create', null, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    if (old.is_deleted = false and new.is_deleted = true) then
      insert into demo.visit_logs(visit_id, user_id, action, before_data, after_data)
        values (new.id, auth.uid(), 'delete', to_jsonb(old), null);
    else
      insert into demo.visit_logs(visit_id, user_id, action, before_data, after_data)
        values (new.id, auth.uid(), 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_demo_visits_log on demo.visits;
create trigger trg_demo_visits_log
  after insert or update on demo.visits
  for each row execute function demo.log_visit_changes();

-- ────────────────────────────────────────────────────────────────────────────
-- ビュー: demo.location_pin_status（public 版と同じ定義を demo に対して作る）
-- ────────────────────────────────────────────────────────────────────────────
create or replace view demo.location_pin_status
with (security_invoker = on) as
select distinct on (l.id)
  l.id                as location_id,
  v.id                as latest_visit_id,
  v.rating            as latest_rating,
  v.date              as latest_date,
  v.start_time        as latest_start_time
from demo.locations l
left join demo.visits v
  on v.location_id = l.id and v.is_deleted = false
order by l.id, v.date desc nulls last, v.start_time desc nulls last;

-- ============================================================================
-- Data API への権限付与（GRANT）
--   public と同じ方針: authenticated のみ。anon には一切付与しない。
-- ============================================================================
grant usage on schema demo to authenticated;

grant select, insert, update, delete on demo.schools    to authenticated;
grant select, insert, update, delete on demo.locations  to authenticated;
grant select, insert, update          on demo.visits     to authenticated; -- DELETE は付与しない
grant select                          on demo.visit_logs to authenticated; -- 書き込みはトリガー経由のみ
grant select, update                  on demo.profiles   to authenticated;
grant select, insert, update, delete  on demo.map_notes  to authenticated;
grant select                          on demo.location_pin_status to authenticated;

-- ============================================================================
-- Row Level Security（RLS）
--   public と同じ方針: authenticated は共有・相互編集可、anon は不可。
--   visits は物理 DELETE 不可（論理削除で運用）。
-- ============================================================================
alter table demo.schools    enable row level security;
alter table demo.locations  enable row level security;
alter table demo.visits     enable row level security;
alter table demo.visit_logs enable row level security;
alter table demo.profiles   enable row level security;
alter table demo.map_notes  enable row level security;

drop policy if exists demo_map_notes_select on demo.map_notes;
drop policy if exists demo_map_notes_insert on demo.map_notes;
drop policy if exists demo_map_notes_update on demo.map_notes;
drop policy if exists demo_map_notes_delete on demo.map_notes;
create policy demo_map_notes_select on demo.map_notes for select to authenticated using (true);
create policy demo_map_notes_insert on demo.map_notes for insert to authenticated with check (true);
create policy demo_map_notes_update on demo.map_notes for update to authenticated using (true) with check (true);
create policy demo_map_notes_delete on demo.map_notes for delete to authenticated using (true);

drop policy if exists demo_profiles_select on demo.profiles;
drop policy if exists demo_profiles_update on demo.profiles;
create policy demo_profiles_select on demo.profiles for select to authenticated using (true);
create policy demo_profiles_update on demo.profiles for update to authenticated
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists demo_schools_select on demo.schools;
drop policy if exists demo_schools_insert on demo.schools;
drop policy if exists demo_schools_update on demo.schools;
drop policy if exists demo_schools_delete on demo.schools;
create policy demo_schools_select on demo.schools for select to authenticated using (true);
create policy demo_schools_insert on demo.schools for insert to authenticated with check (true);
create policy demo_schools_update on demo.schools for update to authenticated using (true) with check (true);
create policy demo_schools_delete on demo.schools for delete to authenticated using (true);

drop policy if exists demo_locations_select on demo.locations;
drop policy if exists demo_locations_insert on demo.locations;
drop policy if exists demo_locations_update on demo.locations;
drop policy if exists demo_locations_delete on demo.locations;
create policy demo_locations_select on demo.locations for select to authenticated using (true);
create policy demo_locations_insert on demo.locations for insert to authenticated with check (true);
create policy demo_locations_update on demo.locations for update to authenticated using (true) with check (true);
create policy demo_locations_delete on demo.locations for delete to authenticated using (true);

drop policy if exists demo_visits_select on demo.visits;
drop policy if exists demo_visits_insert on demo.visits;
drop policy if exists demo_visits_update on demo.visits;
create policy demo_visits_select on demo.visits for select to authenticated using (true);
create policy demo_visits_insert on demo.visits for insert to authenticated with check (true);
create policy demo_visits_update on demo.visits for update to authenticated using (true) with check (true);

drop policy if exists demo_visit_logs_select on demo.visit_logs;
create policy demo_visit_logs_select on demo.visit_logs for select to authenticated using (true);

-- ============================================================================
-- ロールバック用SQL（戻すときだけ、コメントを外して実行）
--   注意: demo スキーマ内のデータはすべて消える。
--        本番（public）には影響しないが、実行前に内容を確認すること。
-- ============================================================================
-- drop schema if exists demo cascade;
