-- ============================================================================
-- migration_006_cases.sql
--   目的: 案件(cases)と採番(doc_counters・next_doc_no)を足し、施工・請求を案件につなぐ。
--   WO-011 段階2 / docs/SPEC-v2.md §3.3・§3.6・§3.8・§8 / D87(案A)。
--
-- 案A の要点(D87):
--   v1 の jobs.site_id・invoices.site_id は NOT NULL で、v1 のビュー invoice_ledger・site_status は
--   sites を起点にしている。NOT NULL を緩めず、ビューも変えないために、
--   「1案件 = 1つの sites 行」にする。案件を作ると、トリガーが sites 行を1つ作って
--   cases.site_id に入れる(実在する物件名・部屋番号・発注元・集客経路の写し。座標は NULL)。
--   施工・請求に case_id を入れると、site_id は案件のものに揃う(トリガーで強制)。
--   物件名・部屋番号・案件の発注元・集客経路を直すと、sites 行にも写す(更新トリガー)。
--   移行案件(v1 の現場から作る案件)だけは、いまある sites 行をそのまま使う。
--   「案件が作った sites 行」か「v1 から移した sites 行」かは、units.legacy_site_id で分かる
--   (legacy_site_id に入っている sites 行 = v1 から移した行。それ以外で cases.site_id にある行 = 案件が作った行)。
--   段階4 で台帳を案件経由に作り直すときに、sites への依存とこの複製のトリガーを外す
--   (expand/contract の contract。SPEC-v2 §11)。
--
-- 位置づけ(db-change スキル):
--   - append-only(原則1): 新しいテーブル2本(cases・doc_counters)、ビュー1本、関数・トリガーを足す。
--     足す列は jobs.case_id・invoices.case_id(NULL 可)だけ。既存の列は消さない・型を変えない・NOT NULL を緩めない。
--   - 変えるのは audit_logs.entity_type の CHECK の許容値だけ('cases' を足す。既存7値は残す)。
--   - 論理削除(is_deleted)。authenticated に DELETE は付与しない。
--   - 冪等(原則4): テーブル・ビュー・関数は if not exists / create or replace、トリガーは drop → create。
--     データの移行は「案件がまだ無い現場」「case_id がまだ無い施工・請求」だけを対象にする。
--
-- 取り消し(論理削除)の伝わり方(D87-4):
--   - 案件を取り消すと、その案件の sites 行も取り消す(元に戻すと sites 行も戻る)。
--   - 生きている請求、または生きている入金がある案件は、先にそれらを取り消すまで取り消せない(D85 と同じ考え方)。
--   - 施工は案件を取り消しても残る(物件・部屋を取り消したときと同じ。記録は消さない)。
--
-- 影響範囲:
--   - 移行で、sites ごとに案件(取り消し済みの現場からは取り消し済みの案件)を作る。
--     audit_logs には cases の 'create' が積まれる(user_id は NULL)。
--   - jobs・invoices の case_id を埋める更新で、audit_logs に 'update' が積まれる(user_id は NULL)。
--     updated_at も更新される。取り消し済みの行も含めて埋める(case_id が NULL の行を残さないため)。
--   - 本番の旧画面(main ブランチ)は cases・case_id を読まないので影響しない。
--   - 案件の採番は暦年(日本時間)。K2026-0001 の形。欠番は詰めない。
--
-- 適用: ユーザー(Supabase の SQL Editor)。migration_005 の後に実行する。
-- 戻し: supabase/rollback_006.sql
-- 予行演習と本番適用は別のスクリプト(D82):
--   1. migration_006_dryrun.sql … 本体 → 確認の表(トリガーの試験を含む)→ rollback。何も残らない。先にこれを流す
--   2. このファイル             … 本体 → commit。本番適用
--   migration_006_dryrun.sql は、このファイルの本体から作った写し(supabase/tools/make_dryrun_006.py)。
--   SQL Editor は実行のたびに接続が変わるため、begin から commit / rollback までを1回の実行で流す。
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

commit;

-- ============================================================================
-- 適用後の確認クエリ(結果は WO-011-report.md に貼る)。予行演習の確認表と同じ内容の一部。
--
-- (a) 案件と現場 … 案件 = 現場(取り消し済みを含む)、案件が無い現場 0
--   select (select count(*) from public.cases) as cases, (select count(*) from public.sites) as sites,
--          (select count(*) from public.sites s where not exists (select 1 from public.cases c where c.site_id = s.id)) as sites_without_case;
--
-- (b) case_id が NULL の施工・請求 … どちらも 0(取り消し済みの行も含めて)
--   select (select count(*) from public.jobs where case_id is null) as jobs_null,
--          (select count(*) from public.invoices where case_id is null) as invoices_null;
--
-- (c) 権限 … 0 行であること(anon は何も無し。authenticated の cases は select/insert/update だけ。
--     case_overview は select だけ。doc_counters は誰にも無し)
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--     where table_schema = 'public'
--       and table_name in ('cases', 'case_overview', 'doc_counters')
--       and (grantee = 'anon'
--            or (grantee = 'authenticated' and table_name = 'cases' and privilege_type not in ('SELECT', 'INSERT', 'UPDATE'))
--            or (grantee = 'authenticated' and table_name = 'case_overview' and privilege_type <> 'SELECT')
--            or (grantee = 'authenticated' and table_name = 'doc_counters'));
--
-- (d) 関数の実行権限 … anon = false、authenticated = true
--   select has_function_privilege('anon', 'public.next_doc_no(text)', 'execute') as anon_can,
--          has_function_privilege('authenticated', 'public.next_doc_no(text)', 'execute') as authenticated_can;
-- ============================================================================
