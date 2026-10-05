
-- ============================================================================
-- 予行演習の確認(結果は1つの表で返る。ok がすべて true で、最後に rollback される)
--   期待値は seed_poc.sql を流した DB のとき。ok が null の行は「参考の値」(判定しない)。
--   SQL Editor は最後の結果だけを表示するので、確認は1つの select にまとめてある。
--   D84: 件数の比べ方は「生きている」ものどうしにそろえた(取り消した請求・入金、削除済みの現場は数えない)。
-- ============================================================================
select label, actual, expected, (actual = expected) as ok
from (
  select 1 as n, '物件(buildings・未削除)' as label,
         (select count(*) from public.buildings where is_deleted = false) as actual, 12::bigint as expected
  union all select 2, '部屋(units・未削除)',
         (select count(*) from public.units where is_deleted = false), 13
  union all select 3, '旧 sites(未削除)',
         (select count(*) from public.sites where is_deleted = false), 13
  union all select 4, '部屋が無い現場の数(0 であること)',
         (select count(*) from public.sites s where not exists (select 1 from public.units u where u.legacy_site_id = s.id)), 0
  union all select 5, '元の現場が無い部屋の数(0 であること)',
         (select count(*) from public.units u where u.legacy_site_id is not null
            and not exists (select 1 from public.sites s where s.id = u.legacy_site_id)), 0
  union all select 6, '施工: 部屋から辿れる数 − 生きている現場の施工の数(0 であること)',
         (select count(*) from public.jobs j join public.units u on u.legacy_site_id = j.site_id
            where j.is_deleted = false and u.is_deleted = false)
         - (select count(*) from public.jobs j join public.sites s on s.id = j.site_id
            where j.is_deleted = false and s.is_deleted = false), 0
  union all select 7, '請求: 部屋から辿れる数 − 生きている現場の請求の数(0 であること)',
         (select count(*) from public.invoices i join public.units u on u.legacy_site_id = i.site_id
            where i.is_deleted = false and u.is_deleted = false)
         - (select count(*) from public.invoices i join public.sites s on s.id = i.site_id
            where i.is_deleted = false and s.is_deleted = false), 0
  union all select 8, '入金: 部屋から辿れる数 − 生きている請求・現場の入金の数(0 であること)',
         (select count(*) from public.payments p join public.invoices i on i.id = p.invoice_id
            join public.units u on u.legacy_site_id = i.site_id
            where p.is_deleted = false and i.is_deleted = false and u.is_deleted = false)
         - (select count(*) from public.payments p join public.invoices i on i.id = p.invoice_id
            join public.sites s on s.id = i.site_id
            where p.is_deleted = false and i.is_deleted = false and s.is_deleted = false), 0
  union all select 9, '(参考)施工の全体(seed は 31。テストで足した分があれば増える)',
         (select count(*) from public.jobs where is_deleted = false), null
  union all select 10, '(参考)請求の全体(seed は 20)',
         (select count(*) from public.invoices where is_deleted = false), null
  union all select 11, '(参考)入金の全体(seed は 15)',
         (select count(*) from public.payments where is_deleted = false), null
  union all select 12, 'さくらマンションの部屋数(203・305 の 2)',
         (select count(*) from public.buildings b join public.units u on u.building_id = b.id
            where b.name = 'さくらマンション' and b.is_deleted = false and u.is_deleted = false), 2
  union all select 13, 'さくらマンションの物件数(1)',
         (select count(*) from public.buildings where name = 'さくらマンション' and is_deleted = false), 1
  union all select 14, '権限: anon が持つ権限の数(0 であること)',
         (select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name in ('buildings', 'units', 'building_overview')
              and grantee = 'anon'), 0
  union all select 15, '権限: authenticated の buildings・units で select/insert/update 以外の数(0 であること。DELETE を含む)',
         (select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name in ('buildings', 'units')
              and grantee = 'authenticated' and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')), 0
  union all select 16, '権限: authenticated の building_overview で select 以外の数(0 であること)',
         (select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'building_overview'
              and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0
  union all select 17, '権限: authenticated の buildings・units の select/insert/update の数(6 = 2表 × 3)',
         (select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name in ('buildings', 'units')
              and grantee = 'authenticated' and privilege_type in ('SELECT', 'INSERT', 'UPDATE')), 6
  union all select 18, '位置を写した物件の数(未削除・geo_source=旧データ。seed は 12)',
         (select count(*) from public.buildings where geo_source = '旧データ' and is_deleted = false), 12
) t
order by n;

rollback;
