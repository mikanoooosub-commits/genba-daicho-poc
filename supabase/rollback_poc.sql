-- ============================================================================
-- schema_poc.sql の戻しSQL
--   schema_poc.sql で追加したもの「だけ」を削除する。
--   supabase/schema.sql(チラシ配布実績管理アプリ本体)には一切触れない。
--
-- 破壊的操作(drop)を含む。実行前に:
--   1. 対象データが本番運用中なら pg_dump 等でバックアップを取る
--      (Supabase Free プランには日次バックアップが無い)。
--   2. begin; ... rollback; で一度予行演習してから、commit; に変えて実行する。
--
-- 依存関係の逆順(ビュー→トリガー→テーブル)で削除する。
-- すべて `if exists` で冪等に書いているので、そのまま実行してよいが、
-- 本番データがある状態で流す前は、下記のとおり begin; ... rollback; で
-- 一度予行演習してから、rollback; を commit; に変えて再実行すること
-- (Supabase SQL Editor は実行のたびに接続が変わるため、1回の実行にまとめて書く)。
--
--   begin;
--     -- 以下のDROP文をすべてここに貼り付けて実行
--     select count(*) from public.jobs;  -- 削除前の件数などを確認
--   rollback;   -- 問題なければ rollback; を commit; に変えて再実行
-- ============================================================================

-- ビュー
drop view if exists public.invoice_ledger;
drop view if exists public.site_status;

-- トリガー(テーブルを消せば自動的に外れるが、明示しておく)
drop trigger if exists trg_payments_log on public.payments;
drop trigger if exists trg_invoices_log on public.invoices;
drop trigger if exists trg_jobs_log on public.jobs;

drop trigger if exists trg_payments_updated_at on public.payments;
drop trigger if exists trg_invoices_updated_at on public.invoices;
drop trigger if exists trg_jobs_updated_at on public.jobs;
drop trigger if exists trg_sites_updated_at on public.sites;
drop trigger if exists trg_clients_updated_at on public.clients;

-- トリガー関数
--   log_entity_changes() は本PoC専用として新設したものなので削除してよい。
--   set_updated_at() は schema.sql(本体)側でも使われているため削除しない。
drop function if exists public.log_entity_changes();

-- テーブル(参照される側を後に削除する: audit_logs → payments → invoices → jobs → sites → clients)
drop table if exists public.audit_logs;
drop table if exists public.payments;
drop table if exists public.invoices;
drop table if exists public.jobs;
drop table if exists public.sites;
drop table if exists public.clients;
