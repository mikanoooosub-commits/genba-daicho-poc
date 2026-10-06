-- ============================================================================
-- migration_009_costs_profile.sql
--   目的: 原価(costs)・事業者情報(business_profile)・案件ごとの粗利のビュー(case_financials)を足す。
--   WO-011 段階3 / docs/SPEC-v2.md §3.5・§3.11・§4.3 / D94(1・4・6・8)・D96。
--
-- 要点:
--   - 原価は税抜の整数円(D94-4)。区分は 外注費 / 材料費 / 経費。外注先は屋号までにし、個人名は書かない。
--   - 粗利は税抜で出す(D94-1)。売上(税抜)− 原価(税抜)。
--       売上(税抜)の決め方: 生きている請求がある → 見積由来の請求の小計の合計(請求の根拠)。
--                            見積に結びつかない請求が1つでもあれば「内訳なし」(税込から逆算しない)。
--                          請求が無い → 採用した見積の小計(見込み)。
--                          どちらも無い → 「未定」(粗利は出さない)。
--   - business_profile は1行だけ。架空の値を1行入れる(D94-8。登録番号 T0000000000000 は実在の番号に見えない形)。
--   - case_overview は触らない(段階2 で承認済みの列と画面を壊さない)。画面は両方を読む。
--
-- 位置づけ(db-change スキル):
--   - append-only(原則1): 新しい表2本・ビュー1本・関数・トリガーを足す。既存の列・ビュー・データは変えない。
--   - 変えるのは audit_logs.entity_type の CHECK の許容値だけ('costs'・'business_profile' を足す。既存9値は残す)。
--   - 冪等(原則4)。新しい表・ビューには revoke(D84)。
--   - business_profile の行の追加は「データを足す」(既存の行は無い。on conflict do nothing)。
--
-- 影響範囲: 既存のデータは変わらない。本番(main・v2)は costs・business_profile を読まないので動き続ける。
--
-- 適用: ユーザー(Supabase の SQL Editor)。migration_008 の後に実行する。D96 の条件を満たすので、
--   予行演習が全項目 true なら PM の確認を待たずに流してよい。流したあとは check_after_009.sql を実行する。
-- 戻し: supabase/rollback_009.sql
-- 予行演習と本番適用は別のスクリプト(D82):
--   1. migration_009_dryrun.sql … 本体 → 確認の表 → rollback。何も残らない。先にこれを流す
--   2. このファイル             … 本体 → commit。本番適用
--   migration_009_dryrun.sql は、このファイルの本体から作った写し(supabase/tools/make_dryrun_009.py)。
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

commit;
