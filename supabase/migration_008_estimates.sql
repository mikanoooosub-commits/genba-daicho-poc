-- ============================================================================
-- migration_008_estimates.sql
--   目的: 見積(estimates)と明細(estimate_items)を足し、見積から請求へ金額を引き継ぐ列を足す。
--   WO-011 段階3 / docs/SPEC-v2.md §3.4・§3.6・§4 / D94。
--
-- 要点:
--   - 明細の金額は DB が計算する(数量×単価を 0 方向に切り捨て)。画面から来た値は信用しない。
--   - 見積の小計・税額・合計は、明細から DB が計算して保存する(税は小計に対して1回、0 方向に切り捨て)。
--   - 提出済以降の見積は、DB が書き換えを断る(画面だけに頼らない)。直すときは「出し直し」で版を増やす。
--   - 採用は1案件に1つ(部分ユニーク索引)。新しい版があるとき、古い版は採用できない。
--   - 見積から作った請求は、金額・税率を見積から写し、あとから直せない。1見積 = 1請求。
--     請求の合計は invoices.amount(税込)のまま。v1 の台帳(invoice_ledger)は変えず、新しい請求もそこに出る。
--   - 明細は DELETE 権限が無いので論理削除(is_deleted)。保存は関数 save_estimate_items で1回の処理にする。
--
-- 位置づけ(db-change スキル):
--   - append-only(原則1): 新しいテーブル2本・関数・トリガー・索引を足す。足す列は invoices.estimate_id・
--     invoices.tax_rate_pct(NULL 可)だけ。既存の列は消さない・型を変えない・NOT NULL を緩めない。
--   - 変えるのは audit_logs.entity_type の CHECK の許容値だけ('estimates' を足す。既存8値は残す)。
--   - 冪等(原則4): テーブルは if not exists、関数は create or replace、トリガーは drop → create。
--   - 新しい表には、作った直後に anon の全権限と authenticated の DELETE 等を revoke する(D84)。
--
-- 監査ログ(D79-10): estimates の作成・状態の変更・合計の更新・出し直し・請求への引き継ぎ(invoices の更新)が残る。
--   estimate_items の行ごとのログは作らない(明細は版で丸ごと残るため)。
--
-- 影響範囲: 既存のデータは変わらない。本番(main・v2)は estimates を読まないので、適用しても動き続ける。
--
-- 適用: ユーザー(Supabase の SQL Editor)。migration_007 の後に実行する。
-- 戻し: supabase/rollback_008.sql
-- 予行演習と本番適用は別のスクリプト(D82):
--   1. migration_008_dryrun.sql … 本体 → 確認の表(トリガーの試験を含む)→ rollback。何も残らない。先にこれを流す
--   2. このファイル             … 本体 → commit。本番適用
--   migration_008_dryrun.sql は、このファイルの本体から作った写し(supabase/tools/make_dryrun_008.py)。
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. audit_logs の entity_type に 'estimates' を足す(既存8値は残す)
-- ────────────────────────────────────────────────────────────────────────────
alter table public.audit_logs
  drop constraint if exists audit_logs_entity_type_check;

alter table public.audit_logs
  add constraint audit_logs_entity_type_check
  check (entity_type in ('jobs', 'invoices', 'payments', 'sites', 'clients', 'buildings', 'units', 'cases', 'estimates'));

-- ────────────────────────────────────────────────────────────────────────────
-- 2. estimates(見積)
--    estimate_no は版が増えても同じ(M2026-0001)。版は (estimate_no, version) で一意。
--    status は 下書き / 提出済 / 採用 / 不採用。移り方はトリガーが決める(下の 5-1)。
--    subtotal_yen(税抜)・tax_yen・total_yen(税込)は、明細からトリガーが計算する。画面から書いた値は上書きされる。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.estimates (
  id             uuid primary key default gen_random_uuid(),
  case_id        uuid not null references public.cases(id) on delete restrict,
  estimate_no    text not null default public.next_doc_no('M'),
  version        integer not null default 1 check (version >= 1),
  copied_from_id uuid references public.estimates(id) on delete restrict,  -- 出し直しの元の版
  status         text not null default '下書き'
                  check (status in ('下書き', '提出済', '採用', '不採用')),
  issue_date     date,    -- 提出した日
  valid_until    date,    -- 有効期限
  tax_rate_pct   integer not null default 10 check (tax_rate_pct in (0, 8, 10)),
  subtotal_yen   integer not null default 0,
  tax_yen        integer not null default 0,
  total_yen      integer not null default 0,
  note           text,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (estimate_no, version)
);
create index if not exists idx_estimates_case on public.estimates(case_id);

-- 採用は1案件に1つ(取り消した見積は数えない)
create unique index if not exists uq_estimates_adopted_per_case
  on public.estimates(case_id)
  where status = '採用' and is_deleted = false;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. estimate_items(明細)
--    category: 値引きは単価をマイナスで持つ(CHECK)。
--    amount_yen は BEFORE トリガーが trunc(数量 × 単価) で上書きする(0 方向の切り捨て)。
--    copied_from_item_id: 「前回から写した」の印(写す元の明細)。
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.estimate_items (
  id                  uuid primary key default gen_random_uuid(),
  estimate_id         uuid not null references public.estimates(id) on delete restrict,
  sort_order          integer not null default 0,
  category            text not null default '施工費'
                       check (category in ('施工費', '商品代', '経費', '値引き')),
  description         text not null check (length(btrim(description)) > 0),
  quantity            numeric(10, 2) not null default 1 check (quantity > 0),
  unit                text,
  unit_price_yen      integer not null default 0,
  amount_yen          integer not null default 0,
  copied_from_item_id uuid references public.estimate_items(id) on delete restrict,
  is_deleted          boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((category = '値引き' and unit_price_yen <= 0) or (category <> '値引き' and unit_price_yen >= 0))
);
create index if not exists idx_estimate_items_estimate on public.estimate_items(estimate_id, sort_order);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. invoices に、見積から引き継ぐ列を足す(NULL 可。足すだけ)
--    NULL の estimate_id は「見積に結びつかない請求」(旧データ・v1 の画面で作った請求)。
-- ────────────────────────────────────────────────────────────────────────────
alter table public.invoices add column if not exists estimate_id uuid references public.estimates(id) on delete restrict;
alter table public.invoices add column if not exists tax_rate_pct integer;
create index if not exists idx_invoices_estimate on public.invoices(estimate_id);

-- 1見積 = 1請求(取り消した請求は数えない)。分割請求は段階4 で決める
create unique index if not exists uq_invoices_estimate
  on public.invoices(estimate_id)
  where estimate_id is not null and is_deleted = false;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. トリガー
-- ────────────────────────────────────────────────────────────────────────────

-- 5-1. estimates の書き込み前
--   登録: 状態は必ず下書き・合計は 0。版は、出し直し(copied_from_id あり)のときだけ元の版 + 1 を許す。
--   更新:
--     - 案件・番号・版・元の版は変えられない。
--     - 取り消し(is_deleted)は下書きのあいだだけ。
--     - 状態の移り方: 下書き→提出済 / 提出済→採用・不採用 / 採用・不採用→提出済(戻し。請求が付いていないとき)。
--     - 下書きのあいだだけ、税率・備考・有効期限を変えられる。小計・税額・合計は、いつでも明細から計算し直す。
--     - 提出済以降は、状態以外(提出日の入力を除く)を変えられない。
--   計算: 小計 = 生きている明細の合計。税額 = 小計 × 税率 / 100 の整数除算(0 方向に切り捨て)。合計 = 小計 + 税額。
create or replace function public.estimates_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  src public.estimates%rowtype;
  sub bigint;
  case_deleted boolean;
begin
  if tg_op = 'INSERT' then
    select is_deleted into case_deleted from public.cases where id = new.case_id;
    if case_deleted is null or case_deleted then
      raise exception '取り消された案件には見積を作れません';
    end if;
    new.status := '下書き';
    new.subtotal_yen := 0;
    new.tax_yen := 0;
    new.total_yen := 0;
    new.issue_date := null;
    if new.copied_from_id is null then
      new.version := 1;
    else
      select * into src from public.estimates where id = new.copied_from_id;
      if not found
         or src.case_id <> new.case_id
         or src.estimate_no <> new.estimate_no
         or new.version <> src.version + 1 then
        raise exception '出し直しの元の見積が正しくありません';
      end if;
    end if;
    return new;
  end if;

  -- 更新
  if new.case_id <> old.case_id or new.estimate_no <> old.estimate_no or new.version <> old.version
     or new.copied_from_id is distinct from old.copied_from_id then
    raise exception '見積の案件・番号・版は変えられません';
  end if;

  if new.is_deleted <> old.is_deleted and old.status <> '下書き' then
    raise exception '提出済の見積は取り消せません';
  end if;

  -- 小計・税額・合計は、いつも明細から計算し直す(画面から書いた値は使わない)
  select coalesce(sum(amount_yen), 0) into sub
    from public.estimate_items where estimate_id = new.id and is_deleted = false;
  new.subtotal_yen := sub;
  new.tax_yen := (sub * new.tax_rate_pct) / 100;
  new.total_yen := new.subtotal_yen + new.tax_yen;

  if new.status = old.status then
    if old.status <> '下書き' then
      if new.tax_rate_pct <> old.tax_rate_pct
         or new.note is distinct from old.note
         or new.valid_until is distinct from old.valid_until
         or new.issue_date is distinct from old.issue_date
         or new.total_yen <> old.total_yen then
        raise exception '提出済の見積は書き換えられません。直すときは「出し直し」で版を増やしてください';
      end if;
    end if;
    return new;
  end if;

  -- 状態の移り方
  if old.status = '下書き' and new.status = '提出済' then
    if not exists (select 1 from public.estimate_items where estimate_id = new.id and is_deleted = false) then
      raise exception '明細が1行もない見積は提出できません';
    end if;
    if new.total_yen < 0 then
      raise exception '合計がマイナスの見積は提出できません';
    end if;
    if new.issue_date is null then
      new.issue_date := (now() at time zone 'Asia/Tokyo')::date;
    end if;
  elsif old.status = '提出済' and new.status in ('採用', '不採用') then
    if exists (select 1 from public.estimates e
                where e.estimate_no = old.estimate_no and e.version > old.version and e.is_deleted = false) then
      raise exception '新しい版があるため、この版は採用・不採用にできません';
    end if;
    -- 提出済からの移行では、中身を変えさせない
    if new.tax_rate_pct <> old.tax_rate_pct or new.note is distinct from old.note
       or new.valid_until is distinct from old.valid_until or new.issue_date is distinct from old.issue_date then
      raise exception '提出済の見積は書き換えられません。直すときは「出し直し」で版を増やしてください';
    end if;
  elsif old.status in ('採用', '不採用') and new.status = '提出済' then
    if exists (select 1 from public.invoices i where i.estimate_id = old.id and i.is_deleted = false) then
      raise exception 'この見積から作った請求があるため、提出済に戻せません。先に請求を取り消してください';
    end if;
    if new.tax_rate_pct <> old.tax_rate_pct or new.note is distinct from old.note
       or new.valid_until is distinct from old.valid_until or new.issue_date is distinct from old.issue_date then
      raise exception '提出済の見積は書き換えられません。直すときは「出し直し」で版を増やしてください';
    end if;
  else
    raise exception '見積の状態を「%」から「%」には変えられません', old.status, new.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_estimates_before_write on public.estimates;
create trigger trg_estimates_before_write
  before insert or update on public.estimates
  for each row execute function public.estimates_before_write();

drop trigger if exists trg_estimates_updated_at on public.estimates;
create trigger trg_estimates_updated_at
  before update on public.estimates
  for each row execute function public.set_updated_at();

drop trigger if exists trg_estimates_log on public.estimates;
create trigger trg_estimates_log
  after insert or update on public.estimates
  for each row execute function public.log_entity_changes();

-- 5-2. estimate_items の書き込み前: 親が下書きのときだけ。金額は DB が計算する。
create or replace function public.estimate_items_before_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  parent_status text;
  parent_deleted boolean;
begin
  if tg_op = 'UPDATE' and new.estimate_id <> old.estimate_id then
    raise exception '明細を別の見積に移すことはできません';
  end if;
  select status, is_deleted into parent_status, parent_deleted
    from public.estimates where id = new.estimate_id;
  if parent_status is null then
    raise exception '見積が見つかりません';
  end if;
  if parent_status <> '下書き' or parent_deleted then
    raise exception '提出済の見積の明細は変えられません。直すときは「出し直し」で版を増やしてください';
  end if;
  new.description := btrim(new.description);
  new.amount_yen := trunc(new.quantity * new.unit_price_yen)::integer;  -- 0 方向の切り捨て
  return new;
end;
$$;

drop trigger if exists trg_estimate_items_before_write on public.estimate_items;
create trigger trg_estimate_items_before_write
  before insert or update on public.estimate_items
  for each row execute function public.estimate_items_before_write();

drop trigger if exists trg_estimate_items_updated_at on public.estimate_items;
create trigger trg_estimate_items_updated_at
  before update on public.estimate_items
  for each row execute function public.set_updated_at();

-- 5-3. 明細を変えたら、親の見積の合計を計算し直す(estimates の更新 = 5-1 が計算する)。
--   関数の中で一括保存しているとき(app.skip_recalc = on)は、行ごとに更新しない(最後に1回だけ)。
create or replace function public.estimate_items_after_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('app.skip_recalc', true), 'off') <> 'on' then
    update public.estimates set updated_at = now() where id = new.estimate_id;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_estimate_items_after_write on public.estimate_items;
create trigger trg_estimate_items_after_write
  after insert or update on public.estimate_items
  for each row execute function public.estimate_items_after_write();

-- 5-4. 見積から作る請求: 案件・状態・金額・税率を強制する。
--   登録: 見積が採用で、同じ案件であること。金額(税込)と税率は見積から写す(画面から来た値は上書き)。
--   更新: 金額・税率・見積・案件は変えられない(取り消し・元に戻す・メモ・日付は変えられる)。
--   元に戻す(is_deleted を false に)ときは、見積がまだ採用であることを確かめる。
create or replace function public.invoices_from_estimate()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  e public.estimates%rowtype;
begin
  if new.estimate_id is null then
    if tg_op = 'UPDATE' and old.estimate_id is not null then
      raise exception '見積から作った請求の、見積とのひもづけは外せません';
    end if;
    return new;
  end if;

  select * into e from public.estimates where id = new.estimate_id;
  if not found then
    raise exception '見積が見つかりません';
  end if;
  if new.case_id is distinct from e.case_id then
    raise exception '請求の案件が、見積の案件と違います';
  end if;

  if tg_op = 'INSERT' then
    if e.status <> '採用' or e.is_deleted then
      raise exception '採用した見積からだけ請求を作れます';
    end if;
    new.amount := e.total_yen;
    new.tax_rate_pct := e.tax_rate_pct;
    return new;
  end if;

  if new.estimate_id is distinct from old.estimate_id or new.case_id is distinct from old.case_id then
    raise exception '見積から作った請求の、見積・案件は変えられません';
  end if;
  if new.amount <> old.amount or new.tax_rate_pct is distinct from old.tax_rate_pct then
    raise exception '見積から作った請求の金額・税率は直せません。見積を出し直してください';
  end if;
  if old.is_deleted and not new.is_deleted and (e.status <> '採用' or e.is_deleted) then
    raise exception '見積が採用でなくなったため、この請求は元に戻せません';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_invoices_from_estimate on public.invoices;
create trigger trg_invoices_from_estimate
  before insert or update on public.invoices
  for each row execute function public.invoices_from_estimate();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. 関数(画面から呼ぶ。security invoker = 呼んだ人の権限と RLS のまま動く)
--    実行権限は authenticated だけ(anon と public から外す)。
-- ────────────────────────────────────────────────────────────────────────────

-- 6-1. 明細を1回の処理で保存する。
--   p_items は [{id?, category, description, quantity, unit, unit_price_yen, copied_from_item_id?}, ...] の配列。
--   id のある行は更新、無い行は追加、送られなかった生きている行は論理削除。並び順は配列の順。
--   下書きのときだけ。途中で失敗したら、何も保存されない。
create or replace function public.save_estimate_items(p_estimate_id uuid, p_items jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  st text;
  del boolean;
  rec record;
  item_id uuid;
  affected integer;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception '明細は配列で渡してください';
  end if;
  select status, is_deleted into st, del from public.estimates where id = p_estimate_id for update;
  if st is null then
    raise exception '見積が見つかりません';
  end if;
  if st <> '下書き' or del then
    raise exception '提出済の見積の明細は変えられません。直すときは「出し直し」で版を増やしてください';
  end if;

  perform set_config('app.skip_recalc', 'on', true);

  -- 送られなかった生きている行は論理削除
  update public.estimate_items it
     set is_deleted = true
   where it.estimate_id = p_estimate_id
     and it.is_deleted = false
     and not exists (
       select 1 from jsonb_array_elements(p_items) e
        where nullif(e.value ->> 'id', '') is not null
          and (e.value ->> 'id')::uuid = it.id);

  for rec in
    select e.value as v, e.ordinality::integer as ord
      from jsonb_array_elements(p_items) with ordinality as e(value, ordinality)
  loop
    item_id := nullif(rec.v ->> 'id', '')::uuid;
    if item_id is not null then
      update public.estimate_items
         set sort_order = rec.ord,
             category = rec.v ->> 'category',
             description = rec.v ->> 'description',
             quantity = (rec.v ->> 'quantity')::numeric,
             unit = nullif(rec.v ->> 'unit', ''),
             unit_price_yen = (rec.v ->> 'unit_price_yen')::integer
       where id = item_id and estimate_id = p_estimate_id and is_deleted = false;
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception '更新する明細が見つかりません';
      end if;
    else
      insert into public.estimate_items
        (estimate_id, sort_order, category, description, quantity, unit, unit_price_yen, copied_from_item_id)
      values
        (p_estimate_id, rec.ord, rec.v ->> 'category', rec.v ->> 'description',
         (rec.v ->> 'quantity')::numeric, nullif(rec.v ->> 'unit', ''), (rec.v ->> 'unit_price_yen')::integer,
         nullif(rec.v ->> 'copied_from_item_id', '')::uuid);
    end if;
  end loop;

  perform set_config('app.skip_recalc', 'off', true);
  update public.estimates set updated_at = now() where id = p_estimate_id;  -- 合計を1回だけ計算し直す(監査ログも1行)
end;
$$;

-- 6-2. 前回の見積の明細を、下書きに写す。
--   写す元の値は、この関数が読む(画面から来た値は使わない)。写すのは 区分・内容・数量・単位・単価だけ。
--   金額は写した先で計算し直す。「前回から写した」の印(copied_from_item_id)を残す。
--   取り消された見積・案件の明細は写せない。p_source_item_ids の順に、末尾へ追加する。戻り値は写した行数。
create or replace function public.copy_estimate_items(p_target_id uuid, p_source_item_ids uuid[])
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  st text;
  del boolean;
  base integer;
  found_count integer;
  wanted integer;
begin
  select status, is_deleted into st, del from public.estimates where id = p_target_id for update;
  if st is null then
    raise exception '見積が見つかりません';
  end if;
  if st <> '下書き' or del then
    raise exception '提出済の見積の明細は変えられません。直すときは「出し直し」で版を増やしてください';
  end if;
  if p_source_item_ids is null or coalesce(array_length(p_source_item_ids, 1), 0) = 0 then
    return 0;
  end if;
  wanted := array_length(p_source_item_ids, 1);

  select count(*) into found_count
    from unnest(p_source_item_ids) as s(id)
    join public.estimate_items it on it.id = s.id and it.is_deleted = false
    join public.estimates e on e.id = it.estimate_id and e.is_deleted = false
    join public.cases c on c.id = e.case_id and c.is_deleted = false;
  if found_count <> wanted then
    raise exception '写す元の明細が見つかりません(取り消された見積・案件の明細は写せません)';
  end if;

  select coalesce(max(sort_order), 0) into base
    from public.estimate_items where estimate_id = p_target_id and is_deleted = false;

  perform set_config('app.skip_recalc', 'on', true);
  insert into public.estimate_items
    (estimate_id, sort_order, category, description, quantity, unit, unit_price_yen, copied_from_item_id)
  select p_target_id, base + s.ord::integer, it.category, it.description, it.quantity, it.unit, it.unit_price_yen, it.id
    from unnest(p_source_item_ids) with ordinality as s(id, ord)
    join public.estimate_items it on it.id = s.id
   order by s.ord;
  perform set_config('app.skip_recalc', 'off', true);

  update public.estimates set updated_at = now() where id = p_target_id;
  return wanted;
end;
$$;

-- 6-3. 出し直し: 提出済・不採用の最新版から、版 + 1 の下書きを作る(明細・税率・備考を写す)。
--   採用の版は、先に「提出済に戻す」(請求が付いていないとき)。新しい版の id を返す。
create or replace function public.reissue_estimate(p_id uuid)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  src public.estimates%rowtype;
  new_id uuid;
begin
  select * into src from public.estimates where id = p_id for update;
  if not found or src.is_deleted then
    raise exception '見積が見つかりません';
  end if;
  if src.status not in ('提出済', '不採用') then
    raise exception '出し直しできるのは、提出済か不採用の見積です(採用の見積は、先に提出済に戻してください)';
  end if;
  if exists (select 1 from public.estimates e
              where e.estimate_no = src.estimate_no and e.version > src.version and e.is_deleted = false) then
    raise exception '新しい版があります。最新の版から出し直してください';
  end if;

  insert into public.estimates (case_id, estimate_no, version, copied_from_id, tax_rate_pct, note)
  values (src.case_id, src.estimate_no, src.version + 1, src.id, src.tax_rate_pct, src.note)
  returning id into new_id;

  perform set_config('app.skip_recalc', 'on', true);
  insert into public.estimate_items
    (estimate_id, sort_order, category, description, quantity, unit, unit_price_yen, copied_from_item_id)
  select new_id, it.sort_order, it.category, it.description, it.quantity, it.unit, it.unit_price_yen, it.id
    from public.estimate_items it
   where it.estimate_id = src.id and it.is_deleted = false
   order by it.sort_order, it.created_at;
  perform set_config('app.skip_recalc', 'off', true);

  update public.estimates set updated_at = now() where id = new_id;
  return new_id;
end;
$$;

revoke execute on function public.save_estimate_items(uuid, jsonb) from public, anon;
revoke execute on function public.copy_estimate_items(uuid, uuid[]) from public, anon;
revoke execute on function public.reissue_estimate(uuid) from public, anon;
grant execute on function public.save_estimate_items(uuid, jsonb) to authenticated;
grant execute on function public.copy_estimate_items(uuid, uuid[]) to authenticated;
grant execute on function public.reissue_estimate(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. 権限と RLS(anon には与えない。DELETE などは与えない。D84)
--    Supabase は新しい表へ anon・authenticated に全権限を自動で付けるので、先に外してから必要なものだけ与える。
-- ────────────────────────────────────────────────────────────────────────────
revoke all on public.estimates, public.estimate_items from anon;
revoke delete, truncate, references, trigger on public.estimates, public.estimate_items from authenticated;
grant select, insert, update on public.estimates, public.estimate_items to authenticated;  -- DELETE は付与しない

alter table public.estimates      enable row level security;
alter table public.estimate_items enable row level security;

drop policy if exists estimates_select on public.estimates;
drop policy if exists estimates_insert on public.estimates;
drop policy if exists estimates_update on public.estimates;
create policy estimates_select on public.estimates for select to authenticated using (true);
create policy estimates_insert on public.estimates for insert to authenticated with check (true);
create policy estimates_update on public.estimates for update to authenticated using (true) with check (true);

drop policy if exists estimate_items_select on public.estimate_items;
drop policy if exists estimate_items_insert on public.estimate_items;
drop policy if exists estimate_items_update on public.estimate_items;
create policy estimate_items_select on public.estimate_items for select to authenticated using (true);
create policy estimate_items_insert on public.estimate_items for insert to authenticated with check (true);
create policy estimate_items_update on public.estimate_items for update to authenticated using (true) with check (true);

commit;

-- ============================================================================
-- 適用後の確認(本番に流したあと、ユーザーが実行する。結果は報告に書く)
--
-- (a) 権限(期待: anon は 0 行。authenticated は estimates・estimate_items それぞれ INSERT・SELECT・UPDATE の計 6 行だけ)
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name in ('estimates', 'estimate_items')
--     and grantee in ('anon', 'authenticated')
--   order by 1, 2, 3;
--
-- (b) 関数の実行権限(期待: 3 関数とも anon = false、authenticated = true)
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'execute') as anon_can,
--          has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can
--   from pg_proc p
--   where p.pronamespace = 'public'::regnamespace
--     and p.proname in ('save_estimate_items', 'copy_estimate_items', 'reissue_estimate');
--
-- (c) 既存データが変わっていないこと(期待: 見積 0・明細 0。請求のうち estimate_id が入っているもの 0)
--   select (select count(*) from public.estimates) as estimates,
--          (select count(*) from public.estimate_items) as items,
--          (select count(*) from public.invoices where estimate_id is not null) as invoices_with_estimate;
-- ============================================================================
