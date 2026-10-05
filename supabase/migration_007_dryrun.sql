-- ============================================================================
-- migration_007_dryrun.sql — 予行演習用(WO-011 段階2・D82)
--   migration_007_building_overview_cases.sql の本体を流し、確認の表を返して、最後に rollback する。
--   何も残らない。ok が全部 true なら本番用を流す。
--   (この本体は短いので、本番用からの自動生成はせず手で写している。本番用を直したら、ここも直す)
-- ============================================================================

begin;

create or replace view public.building_overview
with (security_invoker = on) as
select
  b.id                         as building_id,
  b.name,
  b.kind,
  b.address,
  b.memo,
  b.default_client_id,
  c.name                       as default_client_name,
  coalesce(u.unit_count, 0)    as unit_count,
  coalesce(j.job_count, 0)     as job_count,
  j.last_job_date,
  coalesce(k.case_count, 0)    as case_count
from public.buildings b
left join public.clients c on c.id = b.default_client_id
left join lateral (
  select count(*)::integer as unit_count
  from public.units u2
  where u2.building_id = b.id and u2.is_deleted = false
) u on true
left join lateral (
  select count(*)::integer as job_count, max(j2.job_date) as last_job_date
  from public.cases c2
  join public.jobs j2 on j2.case_id = c2.id and j2.is_deleted = false
  where c2.building_id = b.id and c2.is_deleted = false
) j on true
left join lateral (
  select count(*)::integer as case_count
  from public.cases c3
  where c3.building_id = b.id and c3.is_deleted = false
) k on true
where b.is_deleted = false;

revoke all on public.building_overview from anon;
revoke insert, update, delete, truncate, references, trigger on public.building_overview from authenticated;
grant select on public.building_overview to authenticated;

select label, actual, expected, (actual = expected) as ok
from (
  select 1 as n, '物件の数(未削除。段階1 と同じ 12)' as label,
         (select count(*) from public.building_overview) as actual, 12::bigint as expected
  union all select 2, '施工の件数の合計 − 旧い数え方(部屋の元の現場から)の合計(0 であること)',
         (select coalesce(sum(job_count), 0) from public.building_overview)
         - (select count(*) from public.units u join public.jobs j on j.site_id = u.legacy_site_id and j.is_deleted = false
              join public.buildings b on b.id = u.building_id
              where u.is_deleted = false and b.is_deleted = false), 0
  union all select 3, '案件の件数の合計 − 取り消されていない案件のうち未削除の物件の案件の数(0 であること)',
         (select coalesce(sum(case_count), 0) from public.building_overview)
         - (select count(*) from public.cases c join public.buildings b on b.id = c.building_id
              where c.is_deleted = false and b.is_deleted = false), 0
  union all select 4, 'さくらマンションの施工の件数(4)',
         (select job_count from public.building_overview where name = 'さくらマンション'), 4
  union all select 5, '権限: anon が持つ権限の数(0 であること)',
         (select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'building_overview' and grantee = 'anon'), 0
  union all select 6, '権限: authenticated で select 以外の数(0 であること)',
         (select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'building_overview'
              and grantee = 'authenticated' and privilege_type <> 'SELECT'), 0
  union all select 7, '権限: authenticated の select の数(1)',
         (select count(*) from information_schema.role_table_grants
            where table_schema = 'public' and table_name = 'building_overview'
              and grantee = 'authenticated' and privilege_type = 'SELECT'), 1
) t
order by n;

rollback;
