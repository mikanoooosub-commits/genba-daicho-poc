-- migration_008 を本番に流したあとの確認(読むだけ。何も変えない)。丸ごと貼って実行する。
-- ok の列がすべて true なら正常。
select '(a) anon が持つ権限の数(0)' as label,
       count(*) as actual, 0 as expected, (count(*) = 0) as ok
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('estimates', 'estimate_items') and grantee = 'anon'
union all
select '(a) authenticated の select/insert/update の数(6)', count(*), 6, (count(*) = 6)
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('estimates', 'estimate_items') and grantee = 'authenticated'
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE')
union all
select '(a) authenticated の DELETE などの数(0)', count(*), 0, (count(*) = 0)
from information_schema.role_table_grants
where table_schema = 'public' and table_name in ('estimates', 'estimate_items') and grantee = 'authenticated'
  and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')
union all
select '(b) anon が実行できる関数の数(0)', count(*), 0, (count(*) = 0)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('save_estimate_items', 'copy_estimate_items', 'reissue_estimate')
  and has_function_privilege('anon', p.oid, 'execute')
union all
select '(b) authenticated が実行できる関数の数(3)', count(*), 3, (count(*) = 3)
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('save_estimate_items', 'copy_estimate_items', 'reissue_estimate')
  and has_function_privilege('authenticated', p.oid, 'execute')
union all
select '(c) 見積の数(0)', count(*), 0, (count(*) = 0) from public.estimates
union all
select '(c) 明細の数(0)', count(*), 0, (count(*) = 0) from public.estimate_items
union all
select '(c) 見積つきの請求の数(0)', count(*), 0, (count(*) = 0) from public.invoices where estimate_id is not null;
