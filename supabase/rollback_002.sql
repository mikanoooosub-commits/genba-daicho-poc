-- ============================================================================
-- rollback_002.sql — migration_002_revoke_delete.sql の戻しSQL
--
--   revoke したDELETE権限・default privilegesの変更を、適用前の状態に戻す。
--
-- ⚠️ 通常は使わない想定: SPEC.md §9・§12(PM決定)の方針は「jobs/invoices/payments等に
--   物理DELETE権限を一切付与しない」ことが正であり、migration_002が取り消した
--   DELETE権限は本来存在してはいけないもの(ISSUE-006の疑い通りSupabaseの既定付与に
--   よるものであれば尚更)。このrollbackは「migration_002を適用した結果、想定外の
--   副作用(例: 何らかの管理ツールがGRANT DELETEの存在を前提にしていた等)が出た場合に
--   一旦元に戻すための保険」として用意する(db-changeスキル原則5「破壊的操作の前に
--   戻す手段を用意する」)。実行する場合はPM承認のうえ、理由をdocs/change-log.mdに残すこと。
--
-- 位置づけ: append-only(db-change原則1)。migration_002が変更した範囲(DELETE権限・
--   default privileges)だけを元に戻す。select/insert/updateのGRANT・RLSポリシーには
--   一切触れない。
-- ============================================================================

begin;

alter default privileges in schema public
  grant delete on tables to anon, authenticated;

grant delete on public.clients, public.sites, public.jobs, public.invoices, public.payments, public.audit_logs
  to anon, authenticated;

commit;
