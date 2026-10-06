-- migration_009 を本番に流したあとの確認(読むだけ。何も変えない)。丸ごと貼って実行する。
-- ok の列がすべて true なら正常。
select '(a) anon が持つ権限の数(0)' as label, count(*) as actual, 0 as expected, (count(*) = 0) as ok
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('costs', 'business_profile', 'case_financials') and grantee = 'anon'
union all
select '(a) authenticated の costs・business_profile の select/insert/update の数(6)', count(*), 6, (count(*) = 6)
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('costs', 'business_profile') and grantee = 'authenticated'
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE')
union all
select '(a) authenticated の costs・business_profile の DELETE などの数(0)', count(*), 0, (count(*) = 0)
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('costs', 'business_profile') and grantee = 'authenticated'
  and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')
union all
select '(a) authenticated の case_financials の select 以外の数(0)', count(*), 0, (count(*) = 0)
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'case_financials' and grantee = 'authenticated'
  and privilege_type <> 'SELECT'
union all
select '(b) 原価の数(0)', count(*), 0, (count(*) = 0) from public.costs
union all
select '(b) 事業者情報の行数(1)', count(*), 1, (count(*) = 1) from public.business_profile
union all
select '(b) case_financials の行数 − case_overview の行数(0)',
       (select count(*) from public.case_financials) - (select count(*) from public.case_overview), 0,
       ((select count(*) from public.case_financials) - (select count(*) from public.case_overview) = 0)
union all
select '(b) 粗利が出る案件の数(0。見積がまだ無い)', count(*), 0, (count(*) = 0)
from public.case_financials where gross_profit_yen is not null;
