-- ============================================================================
-- migration_006_dryrun.sql — 予行演習用(WO-011 段階2・D82・D87)
--   migration_006_cases.sql の本体を流し、件数・権限・トリガーを確かめて、最後に rollback する。
--   何も残らない(テーブルも移行データも確認用の案件も消える)。先にこれを流し、ok が全部 true なら
--   migration_006_cases.sql(本番用)を流す。
--   このファイルは本番用から作った写し。本番用の本体を直したら作り直す:
--     python supabase/tools/make_dryrun_006.py
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. audit_logs の entity_type に 'cases' を足す(既存7値は残す)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.audit_logs
  drop constraint if exists audit_logs_entity_type_check;

alter table public.audit_logs
  add constraint audit_logs_entity_type_check
  check (entity_type in ('jobs', 'invoices', 'payments', 'sites', 'clients', 'buildings', 'units', 'cases'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. doc_counters(採番の台帳)と next_doc_no()
--    画面(authenticated)からは直接書かせない。関数 next_doc_no() だけが書く(security definer)。
--    1つの文(insert … on conflict … do update … returning)で番号を取るので、
--    途中で失敗して番号の無い行が残ることはない(reuse-printing-poc.md の指摘)。
--    doc_type: K=案件、M=見積(段階3)、S=請求(段階4)。年は暦年(日本時間)。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.doc_counters (
  doc_type text    not null check (doc_type in ('K', 'M', 'S')),
  year     integer not null,
  last_no  integer not null default 0,
  primary key (doc_type, year)
);

revoke all on public.doc_counters from anon, authenticated;
alter table public.doc_counters enable row level security;  -- ポリシーを作らない = authenticated は読み書きできない

create or replace function public.next_doc_no(p_doc_type text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  y integer := extract(year from (now() at time zone 'Asia/Tokyo'))::integer;
  n integer;
begin
  if p_doc_type is null or p_doc_type not in ('K', 'M', 'S') then
    raise exception '採番の種類が正しくありません: %', p_doc_type;
  end if;
  insert into public.doc_counters as d (doc_type, year, last_no)
  values (p_doc_type, y, 1)
  on conflict (doc_type, year) do update set last_no = d.last_no + 1
  returning d.last_no into n;
  return p_doc_type || y::text || '-' || lpad(n::text, 4, '0');
end;
$$;

-- 関数には既定で public(誰でも)に実行権限が付く。anon を含めて外し、authenticated だけに与える
revoke execute on function public.next_doc_no(text) from public, anon;
grant execute on function public.next_doc_no(text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. cases(案件)
--    入居者名・発注元の担当者名の列は作らない。request_summary にも書かない(入力欄の注記で伝える)。
--    status は人が動かす6つ。請求済・入金済は請求と入金から計算する(ビュー case_overview.display_status)。
--    site_id は、案件が作る(または移行で結びつける)sites 行。1案件 = 1現場なので unique。
--    client_id は請求先。「経由」の列(via_client_id)は実ヒアリングの後に決める(SPEC-v2 §3.10)ので足さない。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.cases (
  id              uuid primary key default gen_random_uuid(),
  case_no         text not null unique default public.next_doc_no('K'),
  building_id     uuid not null references public.buildings(id) on delete restrict,
  unit_id         uuid references public.units(id) on delete restrict,   -- NULL は物件全体・共用部
  site_id         uuid not null unique references public.sites(id) on delete restrict,  -- トリガーが埋める(案A)
  client_id       uuid not null references public.clients(id) on delete restrict,       -- 請求先
  lead_source     text not null default 'その他'
                   check (lead_source in ('本部紹介', '自前チラシ', '管理会社', '紹介', 'マッチング', 'その他')),
  work_kind       text not null default '原状回復'
                   check (work_kind in ('原状回復', 'リフォーム', 'クリーニング', '修繕', 'その他')),
  received_on     date not null default current_date,
  request_summary text,   -- 依頼の内容(短く。入居者名は書かない)
  status          text not null default '依頼'
                   check (status in ('依頼', '見積中', '受注', '施工中', '完了', '失注')),
  lost_reason     text,
  memo            text,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_cases_building on public.cases(building_id);
create index if not exists idx_cases_unit     on public.cases(unit_id);
create index if not exists idx_cases_client   on public.cases(client_id);
create index if not exists idx_cases_status   on public.cases(status);
create index if not exists idx_cases_received on public.cases(received_on desc);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. jobs・invoices に case_id を足す(NULL 可。FK。足すだけ)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.jobs     add column if not exists case_id uuid references public.cases(id) on delete restrict;
alter table public.invoices add column if not exists case_id uuid references public.cases(id) on delete restrict;
create index if not exists idx_jobs_case     on public.jobs(case_id);
create index if not exists idx_invoices_case on public.invoices(case_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. トリガー(案A の中身)
-- ────────────────────────────────────────────────────────────────────────────

-- 5-1. cases の書き込み前:
--   - 部屋が、選んだ物件の部屋であることを確かめる。
--   - 登録のとき: sites 行を1つ作って site_id に入れる。
--       ただし、v1 の現場から移した行(units.legacy_site_id)で、その案件の部屋の行だけは、そのまま使う
--       (移行用。それ以外の site_id が渡されても使わず、新しく作る = 画面から他の現場に結びつけられない)。
--   - 更新のとき: site_id・case_no は変えられない。取り消しは、生きている請求・入金が無いときだけ。
create or replace function public.cases_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  b_name text;
  u_building uuid;
  u_room text;
begin
  select name into b_name from public.buildings where id = new.building_id;

  if new.unit_id is not null then
    select building_id, room_no into u_building, u_room from public.units where id = new.unit_id;
    if u_building is distinct from new.building_id then
      raise exception '選んだ部屋は、この物件の部屋ではありません';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.site_id := old.site_id;
    new.case_no := old.case_no;
    if old.is_deleted = false and new.is_deleted = true then
      if exists (select 1 from public.invoices i where i.case_id = new.id and i.is_deleted = false)
         or exists (select 1 from public.payments p join public.invoices i on i.id = p.invoice_id
                    where i.case_id = new.id and p.is_deleted = false) then
        raise exception '生きている請求または入金があるため、案件を取り消せません。先に請求・入金を取り消してください';
      end if;
    end if;
    return new;
  end if;

  -- 登録
  if new.site_id is not null
     and not exists (select 1 from public.units u
                     where u.legacy_site_id = new.site_id and u.id is not distinct from new.unit_id) then
    new.site_id := null;
  end if;
  if new.site_id is null then
    insert into public.sites (client_id, building_name, room_no, lead_source, is_deleted)
    values (new.client_id, b_name, u_room, new.lead_source, new.is_deleted)
    returning id into new.site_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cases_before_write on public.cases;
create trigger trg_cases_before_write
  before insert or update on public.cases
  for each row execute function public.cases_before_write();

drop trigger if exists trg_cases_updated_at on public.cases;
create trigger trg_cases_updated_at
  before update on public.cases
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cases_log on public.cases;
create trigger trg_cases_log
  after insert or update on public.cases
  for each row execute function public.log_entity_changes();

-- 5-2. 案件の発注元・集客経路・物件・部屋・取り消しを直したら、その案件の sites 行に写す
create or replace function public.cases_sync_site()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.sites s
     set client_id     = new.client_id,
         lead_source   = new.lead_source,
         building_name = b.name,
         room_no       = u.room_no,
         is_deleted    = new.is_deleted
    from public.buildings b
    left join public.units u on u.id = new.unit_id
   where b.id = new.building_id
     and s.id = new.site_id
     and (s.client_id, s.lead_source, s.building_name, s.room_no, s.is_deleted)
         is distinct from (new.client_id, new.lead_source, b.name, u.room_no, new.is_deleted);
  return new;
end;
$$;

drop trigger if exists trg_cases_sync_site on public.cases;
create trigger trg_cases_sync_site
  after update of client_id, lead_source, building_id, unit_id, is_deleted on public.cases
  for each row execute function public.cases_sync_site();

-- 5-3. 物件名・部屋番号を直したら、その物件・部屋の案件の sites 行に写す
create or replace function public.buildings_sync_sites()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.sites s
     set building_name = new.name
    from public.cases c
   where c.site_id = s.id
     and c.building_id = new.id
     and s.building_name is distinct from new.name;
  return new;
end;
$$;

drop trigger if exists trg_buildings_sync_sites on public.buildings;
create trigger trg_buildings_sync_sites
  after update of name on public.buildings
  for each row execute function public.buildings_sync_sites();

create or replace function public.units_sync_sites()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  update public.sites s
     set room_no = new.room_no
    from public.cases c
   where c.site_id = s.id
     and c.unit_id = new.id
     and s.room_no is distinct from new.room_no;
  return new;
end;
$$;

drop trigger if exists trg_units_sync_sites on public.units;
create trigger trg_units_sync_sites
  after update of room_no on public.units
  for each row execute function public.units_sync_sites();

-- 5-4. 施工・請求に case_id が入ったら、site_id は案件のものに揃える(食い違う値は直す。入っていなくても埋まる)
create or replace function public.force_case_site()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.case_id is not null then
    new.site_id := (select c.site_id from public.cases c where c.id = new.case_id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_force_case_site on public.jobs;
create trigger trg_jobs_force_case_site
  before insert or update of case_id, site_id on public.jobs
  for each row execute function public.force_case_site();

drop trigger if exists trg_invoices_force_case_site on public.invoices;
create trigger trg_invoices_force_case_site
  before insert or update of case_id, site_id on public.invoices
  for each row execute function public.force_case_site();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. 権限と RLS(anon には与えない。DELETE などは与えない。D84)
--    Supabase は public に作った新しい表へ、anon・authenticated に全権限を自動で付ける。
--    作った直後に revoke してから、必要な分だけ grant する。
-- ────────────────────────────────────────────────────────────────────────────
revoke all on public.cases from anon;
revoke delete, truncate, references, trigger on public.cases from authenticated;
grant select, insert, update on public.cases to authenticated;  -- DELETE は付与しない

alter table public.cases enable row level security;

drop policy if exists cases_select on public.cases;
drop policy if exists cases_insert on public.cases;
drop policy if exists cases_update on public.cases;
create policy cases_select on public.cases for select to authenticated using (true);
create policy cases_insert on public.cases for insert to authenticated with check (true);
create policy cases_update on public.cases for update to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 7. 既存データの移行(SPEC-v2 §8)
--    sites ごとに「移行案件」を1件作る(取り消し済みの現場には、取り消し済みの案件)。
--    - 部屋: units.legacy_site_id で結びつく部屋(移行 SQL 005 で全現場に1対1で作ってある)
--    - 受付日: 最初の施工日。施工が無ければ現場を作った日(日本時間)
--    - 依頼の内容: 'v1 からの移行分'、種類: 'その他'(v1 には種類の情報が無い。決めつけない)
--    - 状態: 施工か請求があれば '完了'、なければ '依頼'
--    - 発注元・集客経路: sites の値
--    案件ができたら、jobs・invoices の case_id を埋める(site_id は元々同じ)。
-- ────────────────────────────────────────────────────────────────────────────
insert into public.cases
  (building_id, unit_id, site_id, client_id, lead_source, work_kind,
   received_on, request_summary, status, is_deleted)
select
  u.building_id,
  u.id,
  s.id,
  s.client_id,
  s.lead_source,
  'その他',
  coalesce(
    (select min(j.job_date) from public.jobs j where j.site_id = s.id and j.is_deleted = false),
    (s.created_at at time zone 'Asia/Tokyo')::date
  ),
  'v1 からの移行分',
  case
    when exists (select 1 from public.jobs j where j.site_id = s.id and j.is_deleted = false)
      or exists (select 1 from public.invoices i where i.site_id = s.id and i.is_deleted = false)
    then '完了' else '依頼'
  end,
  s.is_deleted
from public.sites s
join public.units u on u.legacy_site_id = s.id
where not exists (select 1 from public.cases c where c.site_id = s.id)
order by s.created_at, s.id;

update public.jobs j
   set case_id = c.id
  from public.cases c
 where c.site_id = j.site_id and j.case_id is null;

update public.invoices i
   set case_id = c.id
  from public.cases c
 where c.site_id = i.site_id and i.case_id is null;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. ビュー case_overview(案件の一覧の契約ビュー。画面はこのビューの決まった列だけを読む)
--    計算列は coalesce で NULL を作らない(db-change 原則3)。取り消し済みの案件は出さない。
--    金額は v1 の invoices.amount(numeric。旧データの請求額は税込とみなす・D79-7)のまま。
--    未入金は請求ごとに計算し、他の請求とは相殺しない(SPEC-v2 §3.9)。
--    display_status: 失注 → 失注 / 請求があり未入金が無い → 入金済 / 請求がある → 請求済 / それ以外は status。
--    needs_invoice: 状態が完了で、生きている請求が無い案件(「請求が未作成」)。
--    is_migrated: v1 の現場から移した案件(sites 行が units.legacy_site_id にある)。
--    期日・見積・原価の列は、段階3・4 で足す(既存の列は変えない)。
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.case_overview
with (security_invoker = on) as
select
  c.id                             as case_id,
  c.case_no,
  c.building_id,
  b.name                           as building_name,
  c.unit_id,
  u.room_no,
  c.client_id,
  cl.name                          as client_name,
  c.lead_source,
  c.work_kind,
  c.received_on,
  c.request_summary,
  c.status,
  case
    when c.status = '失注' then '失注'
    when coalesce(inv.invoice_count, 0) > 0 and coalesce(inv.unpaid_total, 0) = 0 then '入金済'
    when coalesce(inv.invoice_count, 0) > 0 then '請求済'
    else c.status
  end                              as display_status,
  coalesce(jb.job_count, 0)        as job_count,
  jb.last_job_date,
  coalesce(inv.invoice_count, 0)   as invoice_count,
  coalesce(inv.invoiced_total, 0)  as invoiced_total,
  coalesce(inv.paid_total, 0)      as paid_total,
  coalesce(inv.unpaid_total, 0)    as unpaid_total,
  (c.status = '完了' and coalesce(inv.invoice_count, 0) = 0) as needs_invoice,
  exists (select 1 from public.units lu where lu.legacy_site_id = c.site_id) as is_migrated,
  c.site_id,
  c.created_at
from public.cases c
join public.buildings b  on b.id = c.building_id
join public.clients cl   on cl.id = c.client_id
left join public.units u on u.id = c.unit_id
left join lateral (
  select count(*)::integer as job_count, max(j.job_date) as last_job_date
  from public.jobs j
  where j.case_id = c.id and j.is_deleted = false
) jb on true
left join lateral (
  select
    count(*)::integer                                          as invoice_count,
    coalesce(sum(i.amount), 0)                                 as invoiced_total,
    coalesce(sum(coalesce(p.paid, 0)), 0)                      as paid_total,
    coalesce(sum(greatest(i.amount - coalesce(p.paid, 0), 0)), 0) as unpaid_total
  from public.invoices i
  left join lateral (
    select sum(p2.amount) as paid
    from public.payments p2
    where p2.invoice_id = i.id and p2.is_deleted = false
  ) p on true
  where i.case_id = c.id and i.is_deleted = false
) inv on true
where c.is_deleted = false;

revoke all on public.case_overview from anon;
revoke insert, update, delete, truncate, references, trigger on public.case_overview from authenticated;
grant select on public.case_overview to authenticated;


-- ============================================================================
-- 予行演習の確認(結果は1つの表で返る。ok がすべて true で、最後に rollback される)
--   期待値は seed_poc.sql を流した DB のとき。ok が null の行は「参考の値」(判定しない)。
--   前半は移行したデータと権限の確認、後半(F で始まる行)は、確認用の案件を作ってトリガーを試す
--   (D87-4)。確認用のデータは rollback ですべて消える。
--   SQL Editor は最後の結果だけを表示するので、確認は temp 表に集めて、最後に1つの select で返す。
-- ============================================================================
create temp table dr_results (n integer, label text, actual bigint, expected bigint);

do $$
declare
  n integer := 0;
  test_building uuid;
  test_unit uuid;
  other_building uuid;
  other_unit uuid;
  a_client uuid;
  b_client uuid;
  test_case uuid;
  test_site uuid;
  test_invoice uuid;
  test_job uuid;
  other_site uuid;
  sites_before bigint;
  ok_raised boolean;
  case2 uuid;
  case2_site uuid;
begin
  -- ── 移行したデータ ──────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, '案件の数 − 現場の数(取り消し済みを含む。0 であること)',
    (select count(*) from public.cases) - (select count(*) from public.sites), 0);
  n := n + 1; insert into dr_results values (n, '案件が無い現場の数(0 であること)',
    (select count(*) from public.sites s where not exists (select 1 from public.cases c where c.site_id = s.id)), 0);
  n := n + 1; insert into dr_results values (n, '施工: case_id が無い行の数(取り消し済みを含む。0 であること)',
    (select count(*) from public.jobs where case_id is null), 0);
  n := n + 1; insert into dr_results values (n, '請求: case_id が無い行の数(取り消し済みを含む。0 であること)',
    (select count(*) from public.invoices where case_id is null), 0);
  n := n + 1; insert into dr_results values (n, '施工・請求の site_id が案件の site_id と食い違う行の数(0 であること)',
    (select count(*) from public.jobs j join public.cases c on c.id = j.case_id where j.site_id <> c.site_id)
    + (select count(*) from public.invoices i join public.cases c on c.id = i.case_id where i.site_id <> c.site_id), 0);
  n := n + 1; insert into dr_results values (n, '取り消されていない案件の数 − 取り消されていない現場の数(0 であること)',
    (select count(*) from public.cases where is_deleted = false) - (select count(*) from public.sites where is_deleted = false), 0);
  n := n + 1; insert into dr_results values (n, '案件の取り消し状態が現場と食い違う数(0 であること)',
    (select count(*) from public.cases c join public.sites s on s.id = c.site_id where c.is_deleted <> s.is_deleted), 0);
  n := n + 1; insert into dr_results values (n, '施工か請求がある現場の数 − 状態が「完了」の案件の数(0 であること)',
    (select count(*) from public.sites s
       where exists (select 1 from public.jobs j where j.site_id = s.id and j.is_deleted = false)
          or exists (select 1 from public.invoices i where i.site_id = s.id and i.is_deleted = false))
    - (select count(*) from public.cases where status = '完了'), 0);
  n := n + 1; insert into dr_results values (n, 'case_overview の行数(取り消されていない案件。seed は 13)',
    (select count(*) from public.case_overview), 13);
  n := n + 1; insert into dr_results values (n, 'case_overview のうち移行案件の数(seed は 13)',
    (select count(*) from public.case_overview where is_migrated), 13);
  n := n + 1; insert into dr_results values (n, 'さくらマンション 305 が「請求が未作成」(1)',
    (select count(*) from public.case_overview where building_name = 'さくらマンション' and room_no = '305' and needs_invoice), 1);
  n := n + 1; insert into dr_results values (n, '(参考)「請求が未作成」の案件の数',
    (select count(*) from public.case_overview where needs_invoice), null);
  n := n + 1; insert into dr_results values (n, '請求: 生きている請求の数 − 案件の請求の数の合計(0 であること)',
    (select count(*) from public.invoices where is_deleted = false)
    - (select coalesce(sum(invoice_count), 0) from public.case_overview), 0);
  n := n + 1; insert into dr_results values (n, '案件の番号がすべて K<年>-<4桁> の形(案件の数と一致)',
    (select count(*) from public.cases where case_no ~ '^K[0-9]{4}-[0-9]{4}$'), (select count(*) from public.cases));

  -- ── 権限 ──────────────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, '権限: anon が cases・case_overview・doc_counters に持つ権限の数(0 であること)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('cases', 'case_overview', 'doc_counters') and grantee = 'anon'), 0);
  n := n + 1; insert into dr_results values (n, '権限: authenticated の cases で select/insert/update 以外の数(0 であること。DELETE を含む)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'cases' and grantee = 'authenticated'
         and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')), 0);
  n := n + 1; insert into dr_results values (n, '権限: authenticated の cases の select/insert/update の数(3)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'cases' and grantee = 'authenticated'
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE')), 3);
  n := n + 1; insert into dr_results values (n, '権限: authenticated の case_overview で select 以外の数(0 であること)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'case_overview' and grantee = 'authenticated'
         and privilege_type <> 'SELECT'), 0);
  n := n + 1; insert into dr_results values (n, '権限: authenticated が doc_counters に持つ権限の数(0 であること。関数経由だけ)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'doc_counters' and grantee = 'authenticated'), 0);
  n := n + 1; insert into dr_results values (n, '権限: anon が next_doc_no を実行できるか(0 = できない)',
    (select has_function_privilege('anon', 'public.next_doc_no(text)', 'execute')::integer), 0);
  n := n + 1; insert into dr_results values (n, '権限: authenticated が next_doc_no を実行できるか(1 = できる)',
    (select has_function_privilege('authenticated', 'public.next_doc_no(text)', 'execute')::integer), 1);
  n := n + 1; insert into dr_results values (n, 'next_doc_no が security definer で search_path を固定している(1)',
    (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'next_doc_no'
         and p.prosecdef and p.proconfig::text like '%search_path=%'), 1);

  -- ── トリガーの試験(確認用の物件・部屋・案件を作る。rollback で消える)──────────
  select id into a_client from public.clients where is_deleted = false order by created_at, id limit 1;
  select id into b_client from public.clients where is_deleted = false and id <> a_client order by created_at, id limit 1;
  select count(*) into sites_before from public.sites;

  insert into public.buildings (name, kind) values ('ZZ予行演習の物件', '集合住宅') returning id into test_building;
  insert into public.units (building_id, room_no) values (test_building, '101') returning id into test_unit;
  insert into public.buildings (name, kind) values ('ZZ予行演習の別の物件', '集合住宅') returning id into other_building;
  insert into public.units (building_id, room_no) values (other_building, '201') returning id into other_unit;

  insert into public.cases (building_id, unit_id, client_id, lead_source)
  values (test_building, test_unit, a_client, '管理会社') returning id, site_id into test_case, test_site;

  n := n + 1; insert into dr_results values (n, 'F1 案件を登録すると sites 行が1つできる(1)',
    (select count(*) from public.sites) - sites_before, 1);
  n := n + 1; insert into dr_results values (n, 'F2 できた sites 行は、物件名・部屋番号・発注元・集客経路の写しで、座標は NULL(1)',
    (select count(*) from public.sites s where s.id = test_site and s.building_name = 'ZZ予行演習の物件'
       and s.room_no = '101' and s.client_id = a_client and s.lead_source = '管理会社' and s.lat is null and s.lng is null), 1);
  n := n + 1; insert into dr_results values (n, 'F3 案件番号が K<年>-<4桁> の形で振られる(1)',
    (select count(*) from public.cases where id = test_case and case_no ~ '^K[0-9]{4}-[0-9]{4}$'), 1);
  n := n + 1; insert into dr_results values (n, 'F4 できた sites 行は v1 から移した行ではない(units.legacy_site_id に無い。0)',
    (select count(*) from public.units where legacy_site_id = test_site), 0);

  -- 請求(site_id を渡さない。トリガーが埋める)
  insert into public.invoices (case_id, amount) values (test_case, 10000) returning id into test_invoice;
  n := n + 1; insert into dr_results values (n, 'F5 案件に付けた請求の site_id が案件の site_id になる(1)',
    (select count(*) from public.invoices where id = test_invoice and site_id = test_site), 1);
  n := n + 1; insert into dr_results values (n, 'F6 その請求が invoice_ledger(v1 の台帳)に建物名つきで出る(1)',
    (select count(*) from public.invoice_ledger where invoice_id = test_invoice and building_name = 'ZZ予行演習の物件'
       and client_id = a_client and amount = 10000), 1);

  -- 施工(わざと食い違う site_id を渡す)
  select id into other_site from public.sites where id <> test_site order by created_at, id limit 1;
  insert into public.jobs (site_id, case_id, job_date) values (other_site, test_case, current_date) returning id into test_job;
  n := n + 1; insert into dr_results values (n, 'F7 食い違う site_id で施工を入れても、案件の site_id に直る(1)',
    (select count(*) from public.jobs where id = test_job and site_id = test_site), 1);

  n := n + 1; insert into dr_results values (n, 'F8 case_overview に、施工1件・請求1件・未入金10000の「請求済」として出る(1)',
    (select count(*) from public.case_overview where case_id = test_case and job_count = 1 and invoice_count = 1
       and unpaid_total = 10000 and display_status = '請求済'), 1);

  -- 名前を直したら sites 行に写る
  update public.buildings set name = 'ZZ予行演習の物件(改)' where id = test_building;
  update public.units set room_no = '102' where id = test_unit;
  n := n + 1; insert into dr_results values (n, 'F9 物件名・部屋番号を直すと sites 行にも写る(1)',
    (select count(*) from public.sites where id = test_site and building_name = 'ZZ予行演習の物件(改)' and room_no = '102'), 1);
  n := n + 1; insert into dr_results values (n, 'F10 台帳(invoice_ledger)の建物名も変わる(1)',
    (select count(*) from public.invoice_ledger where invoice_id = test_invoice and building_name = 'ZZ予行演習の物件(改)'), 1);
  update public.cases set client_id = b_client, lead_source = '紹介' where id = test_case;
  n := n + 1; insert into dr_results values (n, 'F11 案件の発注元・集客経路を直すと sites 行にも写る(1)',
    (select count(*) from public.sites where id = test_site and client_id = b_client and lead_source = '紹介'), 1);

  -- 他の物件の部屋を指定したら断られる
  ok_raised := false;
  begin
    insert into public.cases (building_id, unit_id, client_id) values (test_building, other_unit, a_client);
  exception when others then ok_raised := true;
  end;
  n := n + 1; insert into dr_results values (n, 'F12 他の物件の部屋を指定した案件は断られる(1)', ok_raised::integer, 1);

  -- 他の現場の site_id を渡しても使われず、新しい sites 行ができる
  insert into public.cases (building_id, unit_id, site_id, client_id)
  values (test_building, test_unit, other_site, a_client) returning id, site_id into case2, case2_site;
  n := n + 1; insert into dr_results values (n, 'F13 他の現場の site_id を渡しても使われず、新しい sites 行ができる(1)',
    (case2_site <> other_site and case2_site <> test_site)::integer, 1);

  -- 生きている請求がある案件は取り消せない
  ok_raised := false;
  begin
    update public.cases set is_deleted = true where id = test_case;
  exception when others then ok_raised := true;
  end;
  n := n + 1; insert into dr_results values (n, 'F14 生きている請求がある案件は取り消せない(1)', ok_raised::integer, 1);

  -- 請求を取り消したあとは取り消せて、sites 行も取り消される。元に戻すと sites 行も戻る
  update public.invoices set is_deleted = true where id = test_invoice;
  update public.cases set is_deleted = true where id = test_case;
  n := n + 1; insert into dr_results values (n, 'F15 請求を取り消したあとは案件を取り消せて、sites 行も取り消される(1)',
    (select count(*) from public.cases c join public.sites s on s.id = c.site_id
       where c.id = test_case and c.is_deleted and s.is_deleted), 1);
  n := n + 1; insert into dr_results values (n, 'F16 取り消した案件は case_overview に出ない(0)',
    (select count(*) from public.case_overview where case_id = test_case), 0);
  update public.cases set is_deleted = false where id = test_case;
  n := n + 1; insert into dr_results values (n, 'F17 元に戻すと sites 行も戻る(1)',
    (select count(*) from public.cases c join public.sites s on s.id = c.site_id
       where c.id = test_case and not c.is_deleted and not s.is_deleted), 1);

  -- 監査ログ(create・update・delete の3種類が残る)
  n := n + 1; insert into dr_results values (n, 'F18 案件の登録・更新・取り消しが audit_logs に残る(create・update・delete の3種類)',
    (select count(distinct action) from public.audit_logs where entity_type = 'cases' and entity_id = test_case), 3);

  -- 採番が進む
  n := n + 1; insert into dr_results values (n, 'F19 next_doc_no は呼ぶたびに番号が進む(1)',
    (public.next_doc_no('M') <> public.next_doc_no('M'))::integer, 1);
end
$$;

select label, actual, expected, (actual = expected) as ok
from dr_results
order by n;

rollback;
