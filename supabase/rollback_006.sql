-- ============================================================================
-- rollback_006.sql — migration_006_cases.sql を戻す
--
-- 何を戻すか:
--   - ビュー case_overview、テーブル cases・doc_counters、関数 next_doc_no、
--     migration_006 で足したトリガーと関数を外す。
--   - jobs.case_id・invoices.case_id の列を外す(足した列だけ。外す前に対応表をバックアップする)。
--
-- 戻さないもの(意図的):
--   - audit_logs.entity_type の CHECK('cases' を足した分)。
--     理由: audit_logs に 'cases' の行が既にある(移行時の 'create' など)。監査ログは消さない
--     (物理削除しない)ので、CHECK を元に戻すと既存の行が制約違反になる。許容値が広いままでも、
--     他のテーブルの動作は変わらない(migration_005 と同じ)。
--   - 案件が作った sites 行。
--     理由: その現場には、案件を通して付けた施工・請求が付いている。sites 行は実在する物件・部屋・
--     発注元の写しで、v1 の画面と台帳はそのまま使える。消すと施工・請求が宙に浮く。
--     案件が作った行と v1 から移した行の見分け方: units.legacy_site_id に入っていない行が案件が作った行。
--     (rollback の後は、その行の物件名・部屋番号は、物件を直しても自動では変わらない)
--
-- バックアップ(db-change): 外す前に、案件の表と、施工・請求と案件の対応表を bk_ の名前で残す。
--   バックアップの表は RLS を有効にし、anon・authenticated の権限を外す
--   (Supabase は public に作った表へ既定で権限を付けるため)。不要になったら手で drop table する。
--
-- 実行: SQL Editor で丸ごと実行する。何度流しても安全(if exists)。
-- ============================================================================

begin;

-- バックアップ(既にあれば作らない)
do $$
begin
  if to_regclass('public.cases') is not null
     and to_regclass('public.bk_cases_20261005') is null then
    create table public.bk_cases_20261005 as select * from public.cases;
    alter table public.bk_cases_20261005 enable row level security;
    revoke all on public.bk_cases_20261005 from anon, authenticated;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'jobs' and column_name = 'case_id')
     and to_regclass('public.bk_jobs_case_20261005') is null then
    create table public.bk_jobs_case_20261005 as select id as job_id, case_id from public.jobs;
    alter table public.bk_jobs_case_20261005 enable row level security;
    revoke all on public.bk_jobs_case_20261005 from anon, authenticated;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'invoices' and column_name = 'case_id')
     and to_regclass('public.bk_invoices_case_20261005') is null then
    create table public.bk_invoices_case_20261005 as select id as invoice_id, case_id from public.invoices;
    alter table public.bk_invoices_case_20261005 enable row level security;
    revoke all on public.bk_invoices_case_20261005 from anon, authenticated;
  end if;
end
$$;

-- トリガー(先に外す。外さないと下の列の削除で止まる)
drop trigger if exists trg_jobs_force_case_site     on public.jobs;
drop trigger if exists trg_invoices_force_case_site on public.invoices;
drop trigger if exists trg_buildings_sync_sites     on public.buildings;
drop trigger if exists trg_units_sync_sites         on public.units;

drop view if exists public.case_overview;

alter table public.jobs     drop column if exists case_id;
alter table public.invoices drop column if exists case_id;

drop table if exists public.cases;          -- トリガー・インデックス・ポリシーも一緒に外れる
drop table if exists public.doc_counters;

drop function if exists public.next_doc_no(text);
drop function if exists public.cases_before_write();
drop function if exists public.cases_sync_site();
drop function if exists public.buildings_sync_sites();
drop function if exists public.units_sync_sites();
drop function if exists public.force_case_site();

commit;

-- 確認: 次が 0 行になること
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name in ('cases', 'doc_counters', 'case_overview');
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public' and table_name in ('jobs', 'invoices') and column_name = 'case_id';
