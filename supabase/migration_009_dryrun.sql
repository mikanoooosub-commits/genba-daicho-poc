-- ============================================================================
-- migration_009_dryrun.sql — 予行演習用(WO-011 段階3・D82・D96)
--   migration_009_costs_profile.sql の本体を流し、権限・計算・制約を確かめて、最後に rollback する。
--   何も残らない(テーブルも確認用の物件・案件・見積・原価・請求も消える)。先にこれを流し、ok が全部 true なら
--   migration_009_costs_profile.sql(本番用)を流す。
--   このファイルは本番用から作った写し。本番用の本体を直したら作り直す:
--     python supabase/tools/make_dryrun_009.py
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. audit_logs の entity_type に 'costs'・'business_profile' を足す(既存9値は残す)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.audit_logs
  drop constraint if exists audit_logs_entity_type_check;

alter table public.audit_logs
  add constraint audit_logs_entity_type_check
  check (entity_type in ('jobs', 'invoices', 'payments', 'sites', 'clients', 'buildings', 'units', 'cases',
                         'estimates', 'costs', 'business_profile'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. costs(原価)
--    amount_yen は税抜の整数円(0 以上)。仕入の税の扱いは税理士の範囲なので持たない。
--    description の外注先は屋号までにし、個人名は書かない(入力欄の注記で伝える)。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.costs (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cases(id) on delete restrict,
  category    text not null check (category in ('外注費', '材料費', '経費')),
  description text not null check (length(btrim(description)) > 0),
  amount_yen  integer not null default 0 check (amount_yen >= 0),
  cost_date   date not null default ((now() at time zone 'Asia/Tokyo')::date),
  memo        text,
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_costs_case on public.costs(case_id);

-- 書き込み前: 登録は取り消されていない案件にだけ。案件は変えられない。
create or replace function public.costs_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  case_deleted boolean;
begin
  new.description := btrim(new.description);
  if tg_op = 'INSERT' then
    select is_deleted into case_deleted from public.cases where id = new.case_id;
    if case_deleted is null or case_deleted then
      raise exception '取り消された案件には原価を入れられません';
    end if;
  elsif new.case_id <> old.case_id then
    raise exception '原価の案件は変えられません';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_costs_before_write on public.costs;
create trigger trg_costs_before_write
  before insert or update on public.costs
  for each row execute function public.costs_before_write();

drop trigger if exists trg_costs_updated_at on public.costs;
create trigger trg_costs_updated_at
  before update on public.costs
  for each row execute function public.set_updated_at();

drop trigger if exists trg_costs_log on public.costs;
create trigger trg_costs_log
  after insert or update on public.costs
  for each row execute function public.log_entity_changes();

-- ────────────────────────────────────────────────────────────────────────────
-- 3. business_profile(見積書・請求書に載せる自分の情報。1行だけ)
--    1行だけにするため singleton(常に true・unique)を持つ。id は uuid(監査ログの entity_id が uuid のため)。
--    is_deleted は監査トリガー(log_entity_changes)が読むために持つが、true にはできない。
--    登録番号は T + 数字13桁、または NULL(免税事業者・未登録)。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.business_profile (
  id             uuid primary key default gen_random_uuid(),
  singleton      boolean not null default true unique check (singleton),
  shop_name      text not null default '',
  address        text,
  phone          text,
  invoice_reg_no text check (invoice_reg_no is null or invoice_reg_no ~ '^T[0-9]{13}$'),
  bank_info      text,
  is_deleted     boolean not null default false check (is_deleted = false),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_business_profile_updated_at on public.business_profile;
create trigger trg_business_profile_updated_at
  before update on public.business_profile
  for each row execute function public.set_updated_at();

drop trigger if exists trg_business_profile_log on public.business_profile;
create trigger trg_business_profile_log
  after insert or update on public.business_profile
  for each row execute function public.log_entity_changes();

-- 架空の1行(研修用。D94-8)。既にあれば何もしない。本人が設定の画面で書き換える
insert into public.business_profile (shop_name, address, phone, invoice_reg_no, bank_info)
values ('サンプル工務店(架空)', '東京都〇〇区〇〇1-2-3(架空)', '03-0000-0000', 'T0000000000000',
        '架空銀行 サンプル支店 普通 0000000 サンプル工務店(架空)')
on conflict (singleton) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. ビュー case_financials(案件1行。粗利は税抜。画面はこのビューの決まった列だけを読む)
--    取り消し済みの案件は出さない。売上が決まらないときだけ NULL(意味のある NULL。画面は revenue_basis で出し分ける)。
--    revenue_basis: '請求'(請求の根拠で確定)/ '見込み'(採用した見積)/ '内訳なし'(見積に結びつかない請求がある)/ '未定'
-- ────────────────────────────────────────────────────────────────────────────
create or replace view public.case_financials
with (security_invoker = on) as
select
  c.id                                       as case_id,
  ae.id                                      as adopted_estimate_id,
  ae.estimate_no                             as adopted_estimate_no,
  ae.version                                 as adopted_estimate_version,
  ae.subtotal_yen                            as adopted_subtotal_yen,
  ae.total_yen                               as adopted_total_yen,
  coalesce(inv.invoice_count, 0)             as invoice_count,
  coalesce(inv.invoices_without_estimate, 0) as invoices_without_estimate,
  inv.invoiced_subtotal_yen,
  coalesce(co.cost_total_yen, 0)             as cost_total_yen,
  case
    when coalesce(inv.invoice_count, 0) > 0 and coalesce(inv.invoices_without_estimate, 0) > 0 then '内訳なし'
    when coalesce(inv.invoice_count, 0) > 0 then '請求'
    when ae.id is not null then '見込み'
    else '未定'
  end                                        as revenue_basis,
  case
    when coalesce(inv.invoice_count, 0) > 0 and coalesce(inv.invoices_without_estimate, 0) > 0 then null
    when coalesce(inv.invoice_count, 0) > 0 then inv.invoiced_subtotal_yen
    else ae.subtotal_yen
  end                                        as revenue_yen,
  case
    when coalesce(inv.invoice_count, 0) > 0 and coalesce(inv.invoices_without_estimate, 0) > 0 then null
    when coalesce(inv.invoice_count, 0) > 0 then inv.invoiced_subtotal_yen - coalesce(co.cost_total_yen, 0)
    when ae.id is not null then ae.subtotal_yen - coalesce(co.cost_total_yen, 0)
    else null
  end                                        as gross_profit_yen
from public.cases c
left join public.estimates ae on ae.case_id = c.id and ae.status = '採用' and ae.is_deleted = false
left join lateral (
  select
    count(*)::integer                                                     as invoice_count,
    (count(*) filter (where i.estimate_id is null))::integer              as invoices_without_estimate,
    (sum(e.subtotal_yen) filter (where i.estimate_id is not null))::integer as invoiced_subtotal_yen
  from public.invoices i
  left join public.estimates e on e.id = i.estimate_id
  where i.case_id = c.id and i.is_deleted = false
) inv on true
left join lateral (
  select sum(k.amount_yen)::integer as cost_total_yen
  from public.costs k
  where k.case_id = c.id and k.is_deleted = false
) co on true
where c.is_deleted = false;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. 権限と RLS(anon には与えない。DELETE などは与えない。D84)
-- ────────────────────────────────────────────────────────────────────────────
revoke all on public.costs, public.business_profile, public.case_financials from anon;
revoke delete, truncate, references, trigger on public.costs, public.business_profile from authenticated;
grant select, insert, update on public.costs, public.business_profile to authenticated;  -- DELETE は付与しない
revoke insert, update, delete, truncate, references, trigger on public.case_financials from authenticated;
grant select on public.case_financials to authenticated;

alter table public.costs            enable row level security;
alter table public.business_profile enable row level security;

drop policy if exists costs_select on public.costs;
drop policy if exists costs_insert on public.costs;
drop policy if exists costs_update on public.costs;
create policy costs_select on public.costs for select to authenticated using (true);
create policy costs_insert on public.costs for insert to authenticated with check (true);
create policy costs_update on public.costs for update to authenticated using (true) with check (true);

drop policy if exists business_profile_select on public.business_profile;
drop policy if exists business_profile_insert on public.business_profile;
drop policy if exists business_profile_update on public.business_profile;
create policy business_profile_select on public.business_profile for select to authenticated using (true);
create policy business_profile_insert on public.business_profile for insert to authenticated with check (true);
create policy business_profile_update on public.business_profile for update to authenticated using (true) with check (true);


-- ============================================================================
-- 予行演習の確認(結果は1つの表で返る。ok がすべて true で、最後に rollback される)
--   確認用の物件・案件・見積・原価・請求を作って、制約と粗利のビューを試す(H で始まる行)。
--   後半(P で始まる行)は権限・既存データの確認。確認用のデータは rollback ですべて消える。
--   migration_008 が適用されている DB で流す(見積の表を使う)。
-- ============================================================================
create temp table dr_results (n integer, label text, actual bigint, expected bigint);

create or replace function pg_temp.dr_raises(q text) returns boolean
language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  return true;
end
$$;

do $$
declare
  n integer := 0;
  a_client uuid;
  test_building uuid;
  test_unit uuid;
  test_case uuid;
  dead_case uuid;
  est uuid;
  inv uuid;
  cost_a uuid;
  cost_b uuid;
  profile_audit_before bigint;
begin
  select id into a_client from public.clients where is_deleted = false order by created_at, id limit 1;
  insert into public.buildings (name, kind) values ('ZZ予行演習の物件(原価)', '集合住宅') returning id into test_building;
  insert into public.units (building_id, room_no) values (test_building, '101') returning id into test_unit;
  insert into public.cases (building_id, unit_id, client_id) values (test_building, test_unit, a_client) returning id into test_case;
  insert into public.cases (building_id, unit_id, client_id) values (test_building, test_unit, a_client) returning id into dead_case;
  update public.cases set is_deleted = true where id = dead_case;

  -- ── 原価 ──────────────────────────────────────────────────────
  insert into public.costs (case_id, category, description, amount_yen) values (test_case, '外注費', '  クロス職人 2人工(サンプル内装)  ', 10000) returning id into cost_a;
  insert into public.costs (case_id, category, description, amount_yen) values (test_case, '材料費', 'クロス・のり', 5000) returning id into cost_b;
  n := n + 1; insert into dr_results values (n, 'H1 原価を登録できる。内容の前後の空白は取れる。日付は日本時間の今日が入る(1)',
    (select count(*) from public.costs where id = cost_a and description = 'クロス職人 2人工(サンプル内装)'
       and cost_date = (now() at time zone 'Asia/Tokyo')::date), 1);
  n := n + 1; insert into dr_results values (n, 'H2 金額がマイナスの原価は断られる(1)',
    pg_temp.dr_raises(format($q$insert into public.costs (case_id, category, description, amount_yen) values (%L, '経費', 'x', -1)$q$, test_case))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'H3 区分が外注費・材料費・経費以外の原価は断られる(1)',
    pg_temp.dr_raises(format($q$insert into public.costs (case_id, category, description, amount_yen) values (%L, 'その他', 'x', 1)$q$, test_case))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'H4 内容が空(空白だけ)の原価は断られる(1)',
    pg_temp.dr_raises(format($q$insert into public.costs (case_id, category, description, amount_yen) values (%L, '経費', '   ', 1)$q$, test_case))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'H5 取り消された案件には原価を入れられない(1)',
    pg_temp.dr_raises(format($q$insert into public.costs (case_id, category, description, amount_yen) values (%L, '経費', 'x', 1)$q$, dead_case))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'H6 原価の案件は付け替えられない(1)',
    pg_temp.dr_raises(format($q$update public.costs set case_id = %L where id = %L$q$, dead_case, cost_a))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'H7 原価の登録が監査ログに残る(create)(1)',
    (select count(*) from public.audit_logs where entity_type = 'costs' and entity_id = cost_a and action = 'create'), 1);

  -- ── 粗利(税抜)────────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, 'H8 見積も請求も無い案件は「未定」で、原価 15000・粗利は出ない(1)',
    (select count(*) from public.case_financials where case_id = test_case and revenue_basis = '未定'
       and cost_total_yen = 15000 and revenue_yen is null and gross_profit_yen is null), 1);

  insert into public.estimates (case_id) values (test_case) returning id into est;
  perform public.save_estimate_items(est, jsonb_build_array(
    jsonb_build_object('category', '施工費', 'description', 'クロス張替え一式', 'quantity', 1, 'unit', '式', 'unit_price_yen', 100000)));
  update public.estimates set status = '提出済' where id = est;
  n := n + 1; insert into dr_results values (n, 'H9 提出しただけ(採用前)の見積は、売上に数えない(「未定」のまま)(1)',
    (select count(*) from public.case_financials where case_id = test_case and revenue_basis = '未定' and gross_profit_yen is null), 1);
  update public.estimates set status = '採用' where id = est;
  -- 小計 100000(税 10000・合計 110000)。粗利 = 100000 - 15000 = 85000(税抜どうしで引く)
  n := n + 1; insert into dr_results values (n, 'H10 見積を採用すると「見込み」: 売上(税抜)100000・原価 15000・粗利 85000(税込 110000 では引かない)(1)',
    (select count(*) from public.case_financials where case_id = test_case and revenue_basis = '見込み'
       and adopted_subtotal_yen = 100000 and adopted_total_yen = 110000
       and revenue_yen = 100000 and cost_total_yen = 15000 and gross_profit_yen = 85000), 1);

  update public.costs set is_deleted = true where id = cost_b;
  n := n + 1; insert into dr_results values (n, 'H11 取り消した原価は合計から外れる(原価 10000・粗利 90000)(1)',
    (select count(*) from public.case_financials where case_id = test_case and cost_total_yen = 10000 and gross_profit_yen = 90000), 1);

  insert into public.invoices (case_id, estimate_id, amount) values (test_case, est, 0) returning id into inv;
  n := n + 1; insert into dr_results values (n, 'H12 見積から請求を作ると「請求」: 売上は請求の根拠(見積の小計 100000)で、粗利 90000(1)',
    (select count(*) from public.case_financials where case_id = test_case and revenue_basis = '請求'
       and invoice_count = 1 and invoices_without_estimate = 0 and invoiced_subtotal_yen = 100000
       and revenue_yen = 100000 and gross_profit_yen = 90000), 1);

  insert into public.invoices (case_id, amount) values (test_case, 5000);
  n := n + 1; insert into dr_results values (n, 'H13 見積に結びつかない請求が1つでもあれば「内訳なし」: 粗利は出さない(税込から逆算しない)(1)',
    (select count(*) from public.case_financials where case_id = test_case and revenue_basis = '内訳なし'
       and invoices_without_estimate = 1 and revenue_yen is null and gross_profit_yen is null), 1);

  update public.invoices set is_deleted = true where id = inv;
  n := n + 1; insert into dr_results values (n, 'H14 取り消した請求は数えない(見積由来の請求を取り消し、残りは見積なしの1件だけ → 「内訳なし」のまま)(1)',
    (select count(*) from public.case_financials where case_id = test_case and invoice_count = 1 and revenue_basis = '内訳なし'), 1);

  n := n + 1; insert into dr_results values (n, 'H15 取り消した案件は case_financials に出ない(0)',
    (select count(*) from public.case_financials where case_id = dead_case), 0);
  n := n + 1; insert into dr_results values (n, 'H16 case_financials の行数 = case_overview の行数(0 の差)',
    (select count(*) from public.case_financials) - (select count(*) from public.case_overview), 0);
  n := n + 1; insert into dr_results values (n, 'H17 case_financials は1案件につき1行(重複 0)',
    (select count(*) from (select case_id from public.case_financials group by case_id having count(*) > 1) d), 0);

  -- ── 事業者情報 ─────────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, 'H18 事業者情報は1行で、架空の値が入っている(屋号に「架空」・登録番号 T0000000000000)(1)',
    (select count(*) from public.business_profile where singleton and shop_name like '%架空%' and invoice_reg_no = 'T0000000000000'), 1);
  n := n + 1; insert into dr_results values (n, 'H19 2行目は作れない(断られる)(1)',
    pg_temp.dr_raises($q$insert into public.business_profile (shop_name) values ('x')$q$)::integer, 1);
  n := n + 1; insert into dr_results values (n, 'H20 登録番号が T + 13桁でない値は断られる(1)',
    pg_temp.dr_raises($q$update public.business_profile set invoice_reg_no = 'T123' where singleton$q$)::integer, 1);
  n := n + 1; insert into dr_results values (n, 'H21 登録番号は NULL(未登録・免税)にできる(1)',
    (select case when pg_temp.dr_raises($q$update public.business_profile set invoice_reg_no = null where singleton$q$) then 0 else 1 end), 1);
  n := n + 1; insert into dr_results values (n, 'H22 事業者情報は取り消せない(is_deleted = true は断られる)(1)',
    pg_temp.dr_raises($q$update public.business_profile set is_deleted = true where singleton$q$)::integer, 1);
  select count(*) into profile_audit_before from public.audit_logs where entity_type = 'business_profile';
  update public.business_profile set shop_name = 'サンプル工務店(架空・改)' where singleton;
  n := n + 1; insert into dr_results values (n, 'H23 事業者情報の変更が監査ログに残る(1行増える)(1)',
    (select count(*) from public.audit_logs where entity_type = 'business_profile') - profile_audit_before, 1);

  -- ── 既存データ・権限 ─────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, 'P1 anon が costs・business_profile・case_financials に持つ権限の数(0 であること)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('costs', 'business_profile', 'case_financials') and grantee = 'anon'), 0);
  n := n + 1; insert into dr_results values (n, 'P2 authenticated の costs・business_profile で select/insert/update 以外の数(0 であること。DELETE を含む)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('costs', 'business_profile') and grantee = 'authenticated'
         and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')), 0);
  n := n + 1; insert into dr_results values (n, 'P3 authenticated の costs・business_profile の select/insert/update の数(2 表 × 3 = 6)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('costs', 'business_profile') and grantee = 'authenticated'
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE')), 6);
  n := n + 1; insert into dr_results values (n, 'P4 authenticated の case_financials で select 以外の数(0 であること)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'case_financials' and grantee = 'authenticated'
         and privilege_type <> 'SELECT'), 0);
  n := n + 1; insert into dr_results values (n, 'P5 RLS が costs・business_profile で有効(2)',
    (select count(*) from pg_class where oid in ('public.costs'::regclass, 'public.business_profile'::regclass) and relrowsecurity), 2);
  n := n + 1; insert into dr_results values (n, 'P6 case_financials が security_invoker(RLS を素通りしない)(1)',
    (select count(*) from pg_class where oid = 'public.case_financials'::regclass and reloptions::text like '%security_invoker=on%'), 1);
  n := n + 1; insert into dr_results values (n, 'P7 costs_before_write が search_path を固定していて、security definer ではない(1)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'costs_before_write'
       and not p.prosecdef and p.proconfig::text like '%search_path=%'), 1);
  n := n + 1; insert into dr_results values (n, 'P8 既存の請求・案件は変わらない(確認用を除く請求の数は、台帳の seed の請求と同じ。参考)',
    (select count(*) from public.invoices where case_id <> test_case), null);
end
$$;

select label, actual, expected, (actual = expected) as ok
from dr_results
order by n;

rollback;
