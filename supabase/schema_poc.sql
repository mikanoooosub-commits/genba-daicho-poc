-- ============================================================================
-- PoC(P-A″)追加スキーマ定義: 現場を軸にした台帳(地図つき)
--   対象: 原状回復・内装リフォームの小規模事業者向け台帳+地図+集計
--   参照設計: research\shutoken-2026-09\poc\poc-design.html §3,§4 /
--             research\shutoken-2026-09\poc-candidates.md P-A″
--
-- 位置づけ(db-change スキル準拠・append-only):
--   このファイルは supabase/schema.sql(チラシ配布実績管理アプリ本体)に
--   「追記」するものであり、schema.sql の内容は一切変更しない。
--   schools / locations / visits / visit_logs / profiles / map_notes /
--   location_pin_status はそのまま残し、リネーム・型変更・削除はしない。
--   新しいテーブル+ビューを本ファイルに追加する形で対応する。
--   Supabase ダッシュボードの SQL Editor で、schema.sql の後に
--   このファイルを上から順に実行する。何度実行しても安全(冪等)。
--
-- 適用スキーマ: public のみ。
--   schema_demo.sql が用意する `demo` スキーマは flyer-tracker(チラシ配布)自体の
--   ポートフォリオ用デモであり、本PoC(現場台帳)のデモとは無関係。
--   本PoCにもデモ表示モードが要る場合は、別途 schema_poc_demo.sql 相当を
--   新設して demo スキーマにも同じDDLを当てる(db-change原則8)。
--   → docs/SPEC.md「PMに判断を求める点」参照。
--
-- 実行前の予行演習(推奨):
--   begin;
--     \i supabase/schema_poc.sql
--     -- 確認クエリをここに書く
--   rollback;   -- 問題なければ commit; に変えて再実行
--
-- 戻しSQL: supabase/rollback_poc.sql(本ファイルで作った分だけを削除する)
-- ============================================================================

create extension if not exists "pgcrypto";  -- gen_random_uuid() 用(schema.sqlで既に有効化済みだが念のため冪等に)

-- ────────────────────────────────────────────────────────────────────────────
-- clients(発注元マスタ)
--   管理会社・FC本部・マッチングサイト・紹介元など、仕事の発注元。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.clients (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         text not null check (type in ('管理会社', 'FC本部', 'マッチング', '紹介', 'その他')),
  format_memo  text,  -- 様式メモ(請求書パターン・指定アプリ等の自由記述)
  is_deleted   boolean not null default false,  -- 論理削除
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_clients_type on public.clients(type);

-- ────────────────────────────────────────────────────────────────────────────
-- sites(現場)
--   物件単位。発注元・集客経路・座標を持つ(地図のピンの単位)。
--   注意: 入居者名・発注元担当者名の列は作らない(データ最小化・SPEC.md参照)。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.sites (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients(id) on delete restrict,
  building_name text not null,  -- 建物名
  room_no       text,           -- 部屋番号(任意)
  address_memo  text,           -- 住所メモ(丁目レベル等の自由記述。個人が特定できる情報は入れない)
  lat           double precision,
  lng           double precision,
  lead_source   text not null default 'その他'
                 check (lead_source in ('本部紹介', '自前チラシ', '管理会社', '紹介', 'マッチング', 'その他')),
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_sites_client on public.sites(client_id);
create index if not exists idx_sites_lead_source on public.sites(lead_source);

-- ────────────────────────────────────────────────────────────────────────────
-- jobs(施工)
--   1つの site に対して複数回登録される個別の施工記録。チラトラの visits に相当。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.jobs (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete restrict,
  user_id        uuid references auth.users(id) default auth.uid(),  -- 記録した人
  job_date       date not null,
  work_type      text,     -- 工種(クロス・床・水回り 等の自由記述)
  content        text,     -- 施工内容
  assignee_name  text,     -- 担当(従業員・外注。ログインアカウントを持たない場合があるため自由記述)
  photo_urls     text[] not null default '{}',
  rating         text not null default 'normal' check (rating in ('good', 'normal', 'bad')),  -- 仕上がり/手応え
  memo           text,
  is_deleted     boolean not null default false,  -- 論理削除(物理削除は行わない)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_jobs_site on public.jobs(site_id);
create index if not exists idx_jobs_order on public.jobs(job_date desc, created_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- invoices(請求)
--   1つの site に対する請求。PoC初手は「1請求=1現場」を前提とする(★要検証。
--   複数現場をまとめた月次請求が実態なら expand/contract で invoice_jobs 等へ拡張)。
--   client_id は持たない(sites.client_id から導出する。二重管理によるズレを避けるため)。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.invoices (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites(id) on delete restrict,
  amount         numeric(12, 2) not null default 0,
  format_pattern text,   -- 請求書様式パターン名(自由記述。例: 管理会社Aの雛形)
  issue_date     date,
  memo           text,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_invoices_site on public.invoices(site_id);
create index if not exists idx_invoices_issue_date on public.invoices(issue_date desc);

-- ────────────────────────────────────────────────────────────────────────────
-- payments(入金)
--   1つの invoice に対する入金。複数回の分割入金・過入金の記録にも対応する。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references public.invoices(id) on delete restrict,
  payment_date          date not null,
  amount                numeric(12, 2) not null default 0,
  reconciliation_status text not null default 'unmatched'
                        check (reconciliation_status in ('unmatched', 'matched', 'disputed')),
  memo                  text,
  is_deleted            boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists idx_payments_invoice on public.payments(invoice_id);

-- ────────────────────────────────────────────────────────────────────────────
-- audit_logs(監査ログ: jobs / invoices / payments 共通)
--   visit_logs のパターン(create/update/delete + before/after jsonb)を
--   3テーブルに拡張する。entity_type で対象テーブルを区別する1本のログテーブルにし、
--   トリガー関数を1つに共通化して重複を避ける(tg_table_name を entity_type に使う)。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('jobs', 'invoices', 'payments')),
  entity_id   uuid not null,
  user_id     uuid references auth.users(id),
  action      text not null check (action in ('create', 'update', 'delete')),
  before_data jsonb,
  after_data  jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────────────
-- トリガー: updated_at の自動更新(新テーブル4つに適用)
-- ────────────────────────────────────────────────────────────────────────────
-- set_updated_at() 関数は schema.sql で既に定義済み(public.set_updated_at)。
-- 未適用環境向けに冪等に再定義しておく(schema.sql と同一内容)。
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

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();

drop trigger if exists trg_sites_updated_at on public.sites;
create trigger trg_sites_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at
  before update on public.jobs
  for each row execute function public.set_updated_at();

drop trigger if exists trg_invoices_updated_at on public.invoices;
create trigger trg_invoices_updated_at
  before update on public.invoices
  for each row execute function public.set_updated_at();

drop trigger if exists trg_payments_updated_at on public.payments;
create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- トリガー: jobs / invoices / payments の変更を audit_logs に自動記録
--   INSERT                          -> action 'create'(before=null)
--   UPDATE で is_deleted false→true -> action 'delete'(after=null)
--   それ以外の UPDATE               -> action 'update'
--   security definer で RLS を跨いで audit_logs に書き込む(visit_logs と同じ設計)。
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.log_entity_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into public.audit_logs(entity_type, entity_id, user_id, action, before_data, after_data)
      values (tg_table_name, new.id, auth.uid(), 'create', null, to_jsonb(new));
    return new;
  elsif (tg_op = 'UPDATE') then
    if (old.is_deleted = false and new.is_deleted = true) then
      insert into public.audit_logs(entity_type, entity_id, user_id, action, before_data, after_data)
        values (tg_table_name, new.id, auth.uid(), 'delete', to_jsonb(old), null);
    else
      insert into public.audit_logs(entity_type, entity_id, user_id, action, before_data, after_data)
        values (tg_table_name, new.id, auth.uid(), 'update', to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_jobs_log on public.jobs;
create trigger trg_jobs_log
  after insert or update on public.jobs
  for each row execute function public.log_entity_changes();

drop trigger if exists trg_invoices_log on public.invoices;
create trigger trg_invoices_log
  after insert or update on public.invoices
  for each row execute function public.log_entity_changes();

drop trigger if exists trg_payments_log on public.payments;
create trigger trg_payments_log
  after insert or update on public.payments
  for each row execute function public.log_entity_changes();

-- ────────────────────────────────────────────────────────────────────────────
-- ビュー: site_status(現場の最新状態。地図のピン色決定に使う)
--   location_pin_status の考え方を「現場の請求・入金状況」に広げたもの。
--   計算列は coalesce で NULL を作らない(db-change原則3)。
--   security_invoker=on で、閲覧ユーザーの RLS を適用する。
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.site_status
with (security_invoker = on) as
select
  s.id                    as site_id,
  j.latest_job_date,
  j.latest_rating,
  coalesce(inv.total_invoiced, 0) as total_invoiced,
  coalesce(pay.total_paid, 0)     as total_paid,
  case
    when coalesce(inv.total_invoiced, 0) = 0 then '未請求'
    when coalesce(pay.total_paid, 0) >= inv.total_invoiced then '入金済'
    else '請求済_未入金'
  end as status
from public.sites s
left join lateral (
  select j2.job_date as latest_job_date, j2.rating as latest_rating
  from public.jobs j2
  where j2.site_id = s.id and j2.is_deleted = false
  order by j2.job_date desc, j2.created_at desc
  limit 1
) j on true
left join lateral (
  select sum(i.amount) as total_invoiced
  from public.invoices i
  where i.site_id = s.id and i.is_deleted = false
) inv on true
left join lateral (
  select sum(p.amount) as total_paid
  from public.payments p
  join public.invoices i2 on i2.id = p.invoice_id
  where i2.site_id = s.id and p.is_deleted = false and i2.is_deleted = false
) pay on true
where s.is_deleted = false;

-- ────────────────────────────────────────────────────────────────────────────
-- ビュー: invoice_ledger(台帳画面の契約ビュー)
--   請求1件=1行。発注元・集客経路・入金状況を持ち、台帳画面はこのビューだけを
--   select する(db-change原則6: 内部テーブルではなくビューを公開契約にする)。
--   月次集計(発注元別・経路別)はアプリ側でこのビューを issue_month/client_id/
--   lead_source で group by する。
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.invoice_ledger
with (security_invoker = on) as
select
  i.id                                     as invoice_id,
  i.site_id,
  s.building_name,
  s.client_id,
  c.name                                   as client_name,
  c.type                                   as client_type,
  s.lead_source,
  i.amount,
  i.format_pattern,
  i.issue_date,
  date_trunc('month', i.issue_date)::date  as issue_month,
  coalesce(pay.total_paid, 0)              as paid_amount,
  case
    when coalesce(pay.total_paid, 0) <= 0 then '未入金'
    when coalesce(pay.total_paid, 0) >= i.amount then '入金済'
    else '一部入金'
  end                                       as payment_status
from public.invoices i
join public.sites s   on s.id = i.site_id
join public.clients c on c.id = s.client_id
left join lateral (
  select sum(p.amount) as total_paid
  from public.payments p
  where p.invoice_id = i.id and p.is_deleted = false
) pay on true
where i.is_deleted = false and s.is_deleted = false and c.is_deleted = false;

-- ============================================================================
-- Data API への権限付与(GRANT)
--   anon(未認証)には一切付与しない。authenticated のみ。
--   物理 DELETE は付与しない(clients/sites/jobs/invoices/payments すべて論理削除運用)。
--   audit_logs はトリガー(security definer)経由のみ書き込み可、参照は authenticated。
-- ============================================================================
grant usage on schema public to authenticated;

grant select, insert, update on public.clients        to authenticated;  -- DELETE は付与しない
grant select, insert, update on public.sites           to authenticated;  -- DELETE は付与しない
grant select, insert, update on public.jobs            to authenticated;  -- DELETE は付与しない
grant select, insert, update on public.invoices        to authenticated;  -- DELETE は付与しない
grant select, insert, update on public.payments        to authenticated;  -- DELETE は付与しない
grant select                 on public.audit_logs      to authenticated;  -- 書き込みはトリガー経由のみ
grant select                 on public.site_status      to authenticated;
grant select                 on public.invoice_ledger   to authenticated;

-- ============================================================================
-- Row Level Security(RLS)
--   方針: schema.sql と同じく「認証済み(authenticated)はチームで共有・相互編集」。
--   単一事業者・少人数チームでの利用を前提とし、行ごとのユーザー分離はしない
--   (schema.sql の schools/locations/visits と同じモデル)。
--   複数の異なる事業者(テナント)がこのPoCを共用する場合は tenant_id 列と
--   ポリシーの拡張が必要 → docs/SPEC.md「PMに判断を求める点」参照。
-- ============================================================================
alter table public.clients    enable row level security;
alter table public.sites      enable row level security;
alter table public.jobs       enable row level security;
alter table public.invoices   enable row level security;
alter table public.payments   enable row level security;
alter table public.audit_logs enable row level security;

-- clients
drop policy if exists clients_select on public.clients;
drop policy if exists clients_insert on public.clients;
drop policy if exists clients_update on public.clients;
create policy clients_select on public.clients for select to authenticated using (true);
create policy clients_insert on public.clients for insert to authenticated with check (true);
create policy clients_update on public.clients for update to authenticated using (true) with check (true);

-- sites
drop policy if exists sites_select on public.sites;
drop policy if exists sites_insert on public.sites;
drop policy if exists sites_update on public.sites;
create policy sites_select on public.sites for select to authenticated using (true);
create policy sites_insert on public.sites for insert to authenticated with check (true);
create policy sites_update on public.sites for update to authenticated using (true) with check (true);

-- jobs(物理DELETEポリシーは作らない=論理削除のみ)
drop policy if exists jobs_select on public.jobs;
drop policy if exists jobs_insert on public.jobs;
drop policy if exists jobs_update on public.jobs;
create policy jobs_select on public.jobs for select to authenticated using (true);
create policy jobs_insert on public.jobs for insert to authenticated with check (true);
create policy jobs_update on public.jobs for update to authenticated using (true) with check (true);

-- invoices(物理DELETEポリシーは作らない=論理削除のみ)
drop policy if exists invoices_select on public.invoices;
drop policy if exists invoices_insert on public.invoices;
drop policy if exists invoices_update on public.invoices;
create policy invoices_select on public.invoices for select to authenticated using (true);
create policy invoices_insert on public.invoices for insert to authenticated with check (true);
create policy invoices_update on public.invoices for update to authenticated using (true) with check (true);

-- payments(物理DELETEポリシーは作らない=論理削除のみ)
drop policy if exists payments_select on public.payments;
drop policy if exists payments_insert on public.payments;
drop policy if exists payments_update on public.payments;
create policy payments_select on public.payments for select to authenticated using (true);
create policy payments_insert on public.payments for insert to authenticated with check (true);
create policy payments_update on public.payments for update to authenticated using (true) with check (true);

-- audit_logs(参照のみ。書き込みはトリガー経由のみ)
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated using (true);
