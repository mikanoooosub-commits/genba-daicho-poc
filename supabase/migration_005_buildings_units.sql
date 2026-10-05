-- ============================================================================
-- migration_005_buildings_units.sql
--   目的: 物件マスター(buildings)と部屋(units)を足し、v1 の sites(現場)を
--   物件・部屋に移す。WO-011 段階1 / docs/SPEC-v2.md §3.1・§3.2・§8。
--
-- 位置づけ(db-change スキル):
--   - append-only(原則1): 新しいテーブル2本と、ビュー1本を足すだけ。
--     sites / jobs / invoices / payments / clients の列は変えない・消さない。
--   - 変えるのは audit_logs.entity_type の CHECK の許容値だけ
--     ('buildings'・'units' を足す。既存5値は残す。migration_003 と同じ作法)。
--   - 論理削除(is_deleted)。authenticated に DELETE は付与しない。
--   - 冪等(原則4): 何度流しても同じ結果になる。
--       テーブル・ビュー・トリガー・ポリシー … if not exists / drop → create
--       データの移行 … units.legacy_site_id が既にある現場は飛ばす
--
-- 移行の方針(SPEC-v2 §8):
--   - sites 1件 → units 1件(legacy_site_id で 1 対 1)。
--   - 建物名が同じで、位置が 30m 以内(または両方とも位置なし)の現場は、
--     1つの物件にまとめる(D71 の判定と同じ)。
--   - 旧 sites の位置は buildings に写し、geo_source = '旧データ'(PM 回答 2026-10-04)。
--     新規登録の物件は位置 NULL(段階1 は入力欄を作らない。D80)。
--   - address_memo は住所ではないので memo に写し、address は空にする。
--   - 発注元は buildings.default_client_id に写す。
--
-- 影響範囲:
--   - audit_logs には、移行で作る buildings・units の 'create' が積まれる
--     (トリガーが働くため。user_id は NULL)。
--   - 本番の旧画面(main ブランチ)は buildings・units を読まないので影響しない。
--
-- 適用: ユーザー(Supabase の SQL Editor)。schema_poc.sql・seed_poc.sql・
--   migration_002・migration_003 の後に実行する。
-- 戻し: supabase/rollback_005.sql
--
-- 予行演習と本番適用は別のスクリプトに分けた(D82):
--   1. migration_005_dryrun.sql … begin; (本体) 件数の確認 rollback;  何も残らない。先にこれを流す
--   2. このファイル            … begin; (本体) commit;               本番適用
--   migration_005_dryrun.sql は、このファイルの本体から作った写し(tools: 末尾の手順を参照)。
--   このファイルの本体を直したら、dryrun も作り直す。
--   SQL Editor は実行のたびに接続が変わるため、begin から commit / rollback までを1回の実行で流す。
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. audit_logs の entity_type に 'buildings'・'units' を足す(既存5値は残す)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.audit_logs
  drop constraint if exists audit_logs_entity_type_check;

alter table public.audit_logs
  add constraint audit_logs_entity_type_check
  check (entity_type in ('jobs', 'invoices', 'payments', 'sites', 'clients', 'buildings', 'units'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. buildings(物件)
--    入居者名・発注元の担当者名の列は作らない(データ最小化)。
--    戸建ては「○○様邸」ではなく「戸建て(大山町2丁目)」のように、人の名前を入れない。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.buildings (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  kind              text not null default '集合住宅'
                    check (kind in ('集合住宅', '戸建て', '店舗・事務所', 'その他')),
  address           text,   -- 住所(番地まで)。部屋番号は入れない(部屋は units)
  lat               double precision check (lat is null or (lat between -90 and 90)),
  lng               double precision check (lng is null or (lng between -180 and 180)),
  geo_source        text check (geo_source is null or geo_source in ('住所検索', '地図で指定', '旧データ')),
  default_client_id uuid references public.clients(id) on delete restrict,
  memo              text,   -- 鍵の場所、駐車の可否など
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_buildings_name on public.buildings(name);
create index if not exists idx_buildings_default_client on public.buildings(default_client_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. units(部屋)
--    room_no が NULL の行は「部屋なし」(戸建て・店舗・共用部)。
--    物件を登録しても「部屋なし」の行は自動では作らない(SPEC-v2 §3.2)。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.units (
  id             uuid primary key default gen_random_uuid(),
  building_id    uuid not null references public.buildings(id) on delete restrict,
  room_no        text,
  legacy_site_id uuid unique references public.sites(id) on delete restrict,  -- v1 の現場から移した行だけが持つ
  memo           text,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_units_building on public.units(building_id);
-- 同じ物件に同じ部屋番号は1つ。NULL(部屋なし)は対象外
create unique index if not exists uq_units_building_room
  on public.units(building_id, room_no)
  where is_deleted = false and room_no is not null;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. トリガー: updated_at の自動更新、監査ログ(set_updated_at・log_entity_changes は既存)
-- ────────────────────────────────────────────────────────────────────────────
drop trigger if exists trg_buildings_updated_at on public.buildings;
create trigger trg_buildings_updated_at
  before update on public.buildings
  for each row execute function public.set_updated_at();

drop trigger if exists trg_units_updated_at on public.units;
create trigger trg_units_updated_at
  before update on public.units
  for each row execute function public.set_updated_at();

drop trigger if exists trg_buildings_log on public.buildings;
create trigger trg_buildings_log
  after insert or update on public.buildings
  for each row execute function public.log_entity_changes();

drop trigger if exists trg_units_log on public.units;
create trigger trg_units_log
  after insert or update on public.units
  for each row execute function public.log_entity_changes();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. 権限と RLS(anon には与えない。DELETE などは与えない)
--    Supabase は public に作った新しい表へ、anon・authenticated に全権限を自動で付ける
--    (ISSUE-006 と同じ原因。D84 の予行演習で、DELETE が 4 つ残っているのを見つけた)。
--    grant を書くだけでは防げないので、作った直後に revoke してから、必要な分だけ grant する
--    (migration_002 と同じ作法)。
-- ────────────────────────────────────────────────────────────────────────────
revoke all on public.buildings, public.units from anon;
revoke delete, truncate, references, trigger on public.buildings, public.units from authenticated;

grant select, insert, update on public.buildings to authenticated;  -- DELETE は付与しない
grant select, insert, update on public.units     to authenticated;  -- DELETE は付与しない

alter table public.buildings enable row level security;
alter table public.units     enable row level security;

drop policy if exists buildings_select on public.buildings;
drop policy if exists buildings_insert on public.buildings;
drop policy if exists buildings_update on public.buildings;
create policy buildings_select on public.buildings for select to authenticated using (true);
create policy buildings_insert on public.buildings for insert to authenticated with check (true);
create policy buildings_update on public.buildings for update to authenticated using (true) with check (true);

drop policy if exists units_select on public.units;
drop policy if exists units_insert on public.units;
drop policy if exists units_update on public.units;
create policy units_select on public.units for select to authenticated using (true);
create policy units_insert on public.units for insert to authenticated with check (true);
create policy units_update on public.units for update to authenticated using (true) with check (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. 既存データの移行: sites → buildings + units
--    建物名が同じで、位置が 30m 以内(または両方とも位置なし)の現場を1つの物件にまとめる。
--    古い現場から順に見て、既にできた物件のどれかに合えば部屋として足し、
--    合わなければ新しい物件を作る。units.legacy_site_id がある現場は飛ばす(冪等)。
-- ────────────────────────────────────────────────────────────────────────────
do $$
declare
  s record;
  b record;
  target_id uuid;
  dist_m double precision;
begin
  for s in
    select id, client_id, building_name, room_no, address_memo, lat, lng, is_deleted
    from public.sites
    where not exists (select 1 from public.units u where u.legacy_site_id = sites.id)
    order by created_at, id
  loop
    target_id := null;

    -- 同じ建物名の物件のうち、位置が合うものを探す
    for b in
      select id, lat, lng
      from public.buildings
      where name = s.building_name
      order by created_at, id
    loop
      if s.lat is null and b.lat is null then
        target_id := b.id;
        exit;
      elsif s.lat is not null and b.lat is not null then
        -- haversine(地球の半径 6,371,000 m)
        dist_m := 2 * 6371000 * asin(sqrt(
          power(sin(radians(s.lat - b.lat) / 2), 2) +
          cos(radians(b.lat)) * cos(radians(s.lat)) * power(sin(radians(s.lng - b.lng) / 2), 2)
        ));
        if dist_m <= 30 then
          target_id := b.id;
          exit;
        end if;
      end if;
    end loop;

    if target_id is null then
      insert into public.buildings
        (name, kind, address, lat, lng, geo_source, default_client_id, memo, is_deleted)
      values
        (s.building_name, '集合住宅', null, s.lat, s.lng,
         case when s.lat is not null then '旧データ' else null end,
         s.client_id, s.address_memo, s.is_deleted)
      returning id into target_id;
    elsif not s.is_deleted then
      -- 削除済みの現場から作った物件に、生きている現場が合流したら、物件を生き返らせる
      update public.buildings set is_deleted = false where id = target_id and is_deleted = true;
    end if;

    insert into public.units (building_id, room_no, legacy_site_id, is_deleted)
    values (target_id, s.room_no, s.id, s.is_deleted);
  end loop;
end
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. ビュー building_overview(物件の一覧の契約ビュー。画面はこのビューだけを読む)
--    計算列は coalesce で NULL を作らない(db-change 原則3)。
--    施工の件数・最後の施工日は、部屋の元の現場(legacy_site_id)の jobs から数える。
--    段階2 で cases が入ったら、列を足す(既存の列は変えない)。
-- ────────────────────────────────────────────────────────────────────────────
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

-- ビューにも既定の権限が付くので、anon から外し、authenticated は select だけにする
revoke all on public.building_overview from anon;
revoke insert, update, delete, truncate, references, trigger on public.building_overview from authenticated;
grant select on public.building_overview to authenticated;

commit;

-- ============================================================================
-- 適用後の確認クエリ(結果は WO-011-report.md に貼る)
--   移行後の件数が旧データと一致することを SQL で確かめる。期待値は seed_poc.sql のとき。
--
-- (a) 物件と部屋の件数 … 物件 12・部屋 13(さくらマンションは 1 物件・2 部屋)
--   select
--     (select count(*) from public.buildings where is_deleted = false) as buildings,
--     (select count(*) from public.units where is_deleted = false)     as units,
--     (select count(*) from public.sites where is_deleted = false)     as sites;
--
-- (b) 1 対 1 の対応 … 次の 2 つの結果が空であること
--   select s.id as site_without_unit
--     from public.sites s
--     where not exists (select 1 from public.units u where u.legacy_site_id = s.id);
--   select u.id as unit_without_site
--     from public.units u
--     where u.legacy_site_id is not null
--       and not exists (select 1 from public.sites s where s.id = u.legacy_site_id);
--
-- (c) 施工・請求・入金が部屋から辿れる … 旧データの合計と一致すること
--     (seed_poc.sql: 施工 31・請求 20・入金 15)
--   select
--     (select count(*) from public.jobs     where is_deleted = false) as jobs_total,
--     (select count(*) from public.jobs j
--        join public.units u on u.legacy_site_id = j.site_id
--        where j.is_deleted = false and u.is_deleted = false)         as jobs_via_units,
--     (select count(*) from public.invoices where is_deleted = false) as invoices_total,
--     (select count(*) from public.invoices i
--        join public.units u on u.legacy_site_id = i.site_id
--        where i.is_deleted = false and u.is_deleted = false)         as invoices_via_units,
--     (select count(*) from public.payments where is_deleted = false) as payments_total,
--     (select count(*) from public.payments p
--        join public.invoices i on i.id = p.invoice_id
--        join public.units u on u.legacy_site_id = i.site_id
--        where p.is_deleted = false and i.is_deleted = false and u.is_deleted = false) as payments_via_units;
--
-- (d) さくらマンション … 1 物件に 203 と 305
--   select b.name, u.room_no
--     from public.buildings b join public.units u on u.building_id = b.id
--     where b.name = 'さくらマンション' and u.is_deleted = false
--     order by u.room_no;
--
-- (e) 権限(受入条件 ⑤・D84) … 0 行であること(anon は何も無し。authenticated は select / insert / update だけ。ビューは select だけ)
--   select grantee, table_name, privilege_type
--     from information_schema.role_table_grants
--     where table_schema = 'public'
--       and table_name in ('buildings', 'units', 'building_overview')
--       and (grantee = 'anon'
--            or (grantee = 'authenticated' and table_name in ('buildings', 'units')
--                and privilege_type not in ('SELECT', 'INSERT', 'UPDATE'))
--            or (grantee = 'authenticated' and table_name = 'building_overview'
--                and privilege_type <> 'SELECT'));
--
-- (f) PM 回答 3 の確認: チラシ配布の表がこの DB に無いこと(あれば行が出る)
--   select table_name
--     from information_schema.tables
--     where table_schema = 'public'
--       and table_name in ('schools', 'locations', 'visits', 'visit_logs', 'profiles', 'map_notes');
-- ============================================================================
