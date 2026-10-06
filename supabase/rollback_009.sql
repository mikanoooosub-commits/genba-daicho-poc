-- ============================================================================
-- rollback_009.sql — migration_009_costs_profile.sql を戻す
--
-- 何を戻すか:
--   - ビュー case_financials、テーブル costs・business_profile、関数 costs_before_write を外す。
--
-- 戻さないもの(意図的):
--   - audit_logs.entity_type の CHECK('costs'・'business_profile' を足した分)。
--     理由: audit_logs に 'costs'・'business_profile' の行が既にある可能性がある。監査ログは消さない
--     (物理削除しない)ので、CHECK を元に戻すと既存の行が制約違反になる(migration_005〜008 と同じ)。
--
-- バックアップ(db-change): 外す前に、原価と事業者情報を bk_ の名前で残す。
--   バックアップの表は RLS を有効にし、anon・authenticated の権限を外す
--   (Supabase は public に作った表へ既定で権限を付けるため)。不要になったら手で drop table する。
--
-- 実行: SQL Editor で丸ごと実行する。何度流しても安全(if exists)。
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.costs') is not null
     and to_regclass('public.bk_costs_20261006') is null then
    create table public.bk_costs_20261006 as select * from public.costs;
    alter table public.bk_costs_20261006 enable row level security;
    revoke all on public.bk_costs_20261006 from anon, authenticated;
  end if;
  if to_regclass('public.business_profile') is not null
     and to_regclass('public.bk_business_profile_20261006') is null then
    create table public.bk_business_profile_20261006 as select * from public.business_profile;
    alter table public.bk_business_profile_20261006 enable row level security;
    revoke all on public.bk_business_profile_20261006 from anon, authenticated;
  end if;
end
$$;

drop view if exists public.case_financials;
drop table if exists public.costs;              -- トリガー・索引・ポリシーも一緒に外れる
drop table if exists public.business_profile;
drop function if exists public.costs_before_write();

commit;

-- 確認: 次が 0 行になること
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name in ('costs', 'business_profile', 'case_financials');
