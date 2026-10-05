-- ============================================================================
-- rollback_007.sql — migration_007_building_overview_cases.sql を戻す
--   building_overview を migration_005 の定義(施工を legacy_site_id から数える。case_count 列なし)に戻す。
--   テーブルは触らない。何度流しても安全。
--   注意: 戻すと、新しい案件(legacy_site_id に入らない sites 行)の施工は物件の一覧の件数に入らない。
--   列を減らす戻し(case_count を外す)は create or replace では出来ないので、drop view してから作る。
-- ============================================================================

begin;

drop view if exists public.building_overview;

create view public.building_overview
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
  j.last_job_date
from public.buildings b
left join public.clients c on c.id = b.default_client_id
left join lateral (
  select count(*)::integer as unit_count
  from public.units u2
  where u2.building_id = b.id and u2.is_deleted = false
) u on true
left join lateral (
  select count(*)::integer as job_count, max(j2.job_date) as last_job_date
  from public.units u3
  join public.jobs j2 on j2.site_id = u3.legacy_site_id and j2.is_deleted = false
  where u3.building_id = b.id and u3.is_deleted = false
) j on true
where b.is_deleted = false;

revoke all on public.building_overview from anon;
revoke insert, update, delete, truncate, references, trigger on public.building_overview from authenticated;
grant select on public.building_overview to authenticated;

commit;
