-- ============================================================================
-- rollback_008.sql — migration_008_estimates.sql を戻す
--
-- 何を戻すか:
--   - テーブル estimates・estimate_items、関数(save_estimate_items・copy_estimate_items・reissue_estimate と
--     トリガー用の4本)、invoices のトリガーと索引を外す。
--   - invoices.estimate_id・invoices.tax_rate_pct の列を外す(足した列だけ。外す前に内容をバックアップする)。
--
-- 戻さないもの(意図的):
--   - audit_logs.entity_type の CHECK('estimates' を足した分)。
--     理由: audit_logs に 'estimates' の行が既にある可能性がある。監査ログは消さない(物理削除しない)ので、
--     CHECK を元に戻すと既存の行が制約違反になる。許容値が広いままでも、他のテーブルの動作は変わらない
--     (migration_005・006 と同じ)。
--   - 見積から作った請求(invoices の行)。金額(amount)は見積の合計を写した値で、そのまま台帳に残る。
--     見積とのひもづけだけが外れる(バックアップに対応を残す)。
--
-- バックアップ(db-change): 外す前に、見積・明細・請求と見積の対応を bk_ の名前で残す。
--   バックアップの表は RLS を有効にし、anon・authenticated の権限を外す
--   (Supabase は public に作った表へ既定で権限を付けるため)。不要になったら手で drop table する。
--
-- 実行: SQL Editor で丸ごと実行する。何度流しても安全(if exists)。
-- ============================================================================

begin;

do $$
begin
  if to_regclass('public.estimates') is not null
     and to_regclass('public.bk_estimates_20261006') is null then
    create table public.bk_estimates_20261006 as select * from public.estimates;
    alter table public.bk_estimates_20261006 enable row level security;
    revoke all on public.bk_estimates_20261006 from anon, authenticated;
  end if;
  if to_regclass('public.estimate_items') is not null
     and to_regclass('public.bk_estimate_items_20261006') is null then
    create table public.bk_estimate_items_20261006 as select * from public.estimate_items;
    alter table public.bk_estimate_items_20261006 enable row level security;
    revoke all on public.bk_estimate_items_20261006 from anon, authenticated;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'invoices' and column_name = 'estimate_id')
     and to_regclass('public.bk_invoices_estimate_20261006') is null then
    create table public.bk_invoices_estimate_20261006 as
      select id as invoice_id, estimate_id, tax_rate_pct from public.invoices;
    alter table public.bk_invoices_estimate_20261006 enable row level security;
    revoke all on public.bk_invoices_estimate_20261006 from anon, authenticated;
  end if;
end
$$;

-- トリガー(先に外す。外さないと下の列の削除で止まる)
drop trigger if exists trg_invoices_from_estimate on public.invoices;

drop index if exists public.uq_invoices_estimate;
drop index if exists public.idx_invoices_estimate;
alter table public.invoices drop column if exists estimate_id;
alter table public.invoices drop column if exists tax_rate_pct;

drop table if exists public.estimate_items;   -- トリガー・索引・ポリシーも一緒に外れる
drop table if exists public.estimates;

drop function if exists public.save_estimate_items(uuid, jsonb);
drop function if exists public.copy_estimate_items(uuid, uuid[]);
drop function if exists public.reissue_estimate(uuid);
drop function if exists public.estimates_before_write();
drop function if exists public.estimate_items_before_write();
drop function if exists public.estimate_items_after_write();
drop function if exists public.invoices_from_estimate();

commit;

-- 確認: 次が 0 行になること
--   select table_name from information_schema.tables
--    where table_schema = 'public' and table_name in ('estimates', 'estimate_items');
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'invoices' and column_name in ('estimate_id', 'tax_rate_pct');
