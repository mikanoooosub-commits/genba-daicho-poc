-- ============================================================================
-- migration_007_building_overview_cases.sql
--   目的: 物件の一覧のビュー building_overview の「施工の件数・最後の施工日」を、
--   部屋の元の現場(units.legacy_site_id)からではなく、案件(cases)から数える。さらに案件の件数の列を足す。
--   WO-011 段階2 / D87。
--
-- 背景:
--   migration_005 の building_overview は、v1 から移した部屋(legacy_site_id)の施工だけを数えていた。
--   段階2 で、新しく登録した物件・部屋にも案件→施工が付くようになる(案件が作る sites 行は legacy_site_id に入らない)。
--   そのままだと、新しい案件に施工を記録しても、物件の一覧の「施工」が増えない。
--
-- 位置づけ(db-change スキル):
--   - 列の追加だけ: 既存の列(名前・順番・型)は変えない。新しい列 case_count を末尾に足す。
--   - テーブルは触らない。ビューを create or replace で作り直す(権限は引き継がれる。念のため revoke / grant も書く)。
--   - 冪等: 何度流しても同じ結果になる。
--   - 移行済みのデータでは、job_count・last_job_date は変わらない(全部の現場に移行案件があり、施工に case_id が入っているため)。
--
-- 適用: ユーザー(SQL Editor)。migration_006 の後に実行する。
-- 戻し: supabase/rollback_007.sql(migration_005 のビュー定義に戻す)
-- 予行演習: supabase/migration_007_dryrun.sql(最後に rollback。先にこれを流す)
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
  -- 施工は案件から数える(取り消した案件の施工は数えない)
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

-- ビューの権限(migration_005 と同じ。anon は無し、authenticated は select だけ)
revoke all on public.building_overview from anon;
revoke insert, update, delete, truncate, references, trigger on public.building_overview from authenticated;
grant select on public.building_overview to authenticated;

commit;

-- ============================================================================
-- 適用後の確認クエリ
-- (a) 物件の一覧の施工の件数が、案件から数えた件数と一致する … 0 行であること
--   select b.building_id, b.job_count
--     from public.building_overview b
--     where b.job_count <> (select count(*) from public.cases c join public.jobs j on j.case_id = c.id
--                           where c.building_id = b.building_id and c.is_deleted = false and j.is_deleted = false);
-- (b) 権限 … 0 行であること
--   select grantee, privilege_type from information_schema.role_table_grants
--     where table_schema = 'public' and table_name = 'building_overview'
--       and (grantee = 'anon' or (grantee = 'authenticated' and privilege_type <> 'SELECT'));
-- ============================================================================
