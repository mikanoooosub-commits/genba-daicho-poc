-- ============================================================================
-- rollback_003.sql — migration_003_audit_sites_clients.sql の戻しSQL
--
--   `sites`/`clients` に追加した監査トリガー(`trg_sites_log`/`trg_clients_log`)の
--   drop のみを行う(PM指示によりスコープをトリガーの取り消しに限定)。
--
-- ⚠️ `audit_logs.entity_type` のCHECK制約(`'sites'`/`'clients'`を許容するよう広げた分)は
--   **意図的に戻さない**。理由:
--     1. 制約を広げたこと自体に害は無い(許容値が増えただけで、既存の
--        'jobs'/'invoices'/'payments'の記録・参照には影響しない)。
--     2. migration_003適用後、本ロールバックまでの間に `sites`/`clients` の編集で
--        `audit_logs`に`entity_type='sites'`または`'clients'`の行が既に作られていた場合、
--        制約を元(3値)に戻すとその既存行がCHECK制約違反になり、`alter table`が
--        失敗する(で失敗しなくても、以後は既存の監査ログ行と矛盾した制約になる)。
--     3. トリガーさえ止めれば「これ以上sites/clientsの行が増えない」という
--        ロールバックの目的(監査対象を元(jobs/invoices/paymentsのみ)に戻す)は
--        達成できる。
--   制約自体も戻す必要が生じた場合は、既存の`entity_type in ('sites','clients')`の行を
--   どうするか(削除するか、許容し続けるか)をPMに確認のうえ、別途対応する。
--
-- 位置づけ: append-only(db-change原則1)。migration_003が追加した2つのトリガーの
--   dropのみを行う。CHECK制約・RLSポリシー・他のトリガー・列には一切触れない。
-- ============================================================================

begin;

drop trigger if exists trg_sites_log on public.sites;
drop trigger if exists trg_clients_log on public.clients;

commit;
