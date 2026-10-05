-- ============================================================================
-- rollback_005.sql — migration_005_buildings_units.sql を戻す
--
-- 何を戻すか:
--   - ビュー building_overview、テーブル units・buildings を外す(新しく足した分だけ)。
--   - sites / jobs / invoices / payments / clients は一切触らない。
--     物件・部屋は sites から作った写しなので、外しても元のデータは残る。
--
-- 戻さないもの(意図的):
--   - audit_logs.entity_type の CHECK(許容値に 'buildings'・'units' を足した分)。
--     理由: audit_logs に 'buildings'・'units' の行が既にある(移行時の 'create' など)。
--     監査ログは消さない(物理削除しない)ので、CHECK を元に戻すと既存の行が
--     制約違反になる。許容値が広いままでも、他のテーブルの動作は変わらない。
--
-- バックアップ(db-change): 外す前に、buildings・units を bk_ の名前で残す。
--   物件を移行後に手で足していた場合も失われない。
--   バックアップの表は RLS を有効にし、anon・authenticated の権限を外す
--   (Supabase は public に作った表へ既定で権限を付けるため)。
--   不要になったら手で drop table する。
--
-- 実行: SQL Editor で丸ごと実行する。何度流しても安全(if exists)。
-- ============================================================================

begin;

-- バックアップ(既にあれば作らない)
do $$
begin
  if to_regclass('public.buildings') is not null
     and to_regclass('public.bk_buildings_20261004') is null then
    create table public.bk_buildings_20261004 as select * from public.buildings;
    alter table public.bk_buildings_20261004 enable row level security;
    revoke all on public.bk_buildings_20261004 from anon, authenticated;
  end if;
  if to_regclass('public.units') is not null
     and to_regclass('public.bk_units_20261004') is null then
    create table public.bk_units_20261004 as select * from public.units;
    alter table public.bk_units_20261004 enable row level security;
    revoke all on public.bk_units_20261004 from anon, authenticated;
  end if;
end
$$;

drop view if exists public.building_overview;
drop table if exists public.units;       -- トリガー・インデックス・ポリシーも一緒に外れる
drop table if exists public.buildings;

commit;

-- 確認: 次が 0 行になること
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name in ('buildings', 'units', 'building_overview');
