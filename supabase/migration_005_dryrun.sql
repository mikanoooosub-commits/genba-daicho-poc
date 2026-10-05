-- ============================================================================
-- migration_005_dryrun.sql — 予行演習用(WO-011 段階1・D82・D84)
--   migration_005_buildings_units.sql の本体を流し、件数と権限を確かめて、最後に rollback する。
--   何も残らない(テーブルも移行データも消える)。先にこれを流し、ok が全部 true なら
--   migration_005_buildings_units.sql(本番用)を流す。
--   このファイルは本番用から作った写し。本番用の本体を直したら作り直す:
--     python supabase/tools/make_dryrun_005.py
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
