-- ============================================================================
-- migration_003_audit_sites_clients.sql
--   目的: `sites`(現場)・`clients`(発注元)の insert/update を、既存の
--   `jobs`/`invoices`/`payments`と同じ仕組みで `audit_logs` に自動記録する。
--
-- 背景(PM裁定・2026-09-24・SPEC.md §12 PM決定 A-3):
--   ISSUE-008(現場の論理削除・復元。CHANGE-A-015で対応)の実装中、実装Aが
--   「`sites`には`log_entity_changes()`トリガー(`trg_sites_log`)が無い。`clients`にも無い。
--   これは本PoCの差別化の核である『AIは間違えます。だから直す前提で作りました』
--   (poc-app/CLAUDE.md §4「訂正履歴を必ず追えることで成り立つ」)と食い違う」と指摘した。
--   PM裁定により、`jobs`/`invoices`/`payments`と同じ監査トリガーを`sites`/`clients`にも追加する。
--
-- 関数(`public.log_entity_changes()`)の変更要否について:
--   `schema_poc.sql`の関数定義を確認したところ、`entity_type`には`tg_table_name`
--   (トリガーが発火したテーブル名)を使っており固定値ではない。そのため関数自体は
--   `sites`/`clients`にそのまま使い回せる(`create or replace`による関数の変更は不要)。
--   既存3テーブル(jobs/invoices/payments)の挙動は一切変えていない。
--
-- ただし`audit_logs.entity_type`列には
--   `check (entity_type in ('jobs', 'invoices', 'payments'))` という制約があり、
--   これを広げないままトリガーだけ追加すると、`sites`/`clients`へのINSERT/UPDATEの
--   たびに`log_entity_changes()`が`audit_logs`へ挿入しようとしてCHECK制約違反で
--   例外を投げ、**現場・発注元の登録/編集そのものが失敗する**(トリガーは
--   `after insert or update`のため、失敗すれば元の操作ごとロールバックされる)。
--   そのため本マイグレーションはCHECK制約の許容値を広げる変更を含む(既存の
--   'jobs'/'invoices'/'payments'は残したまま'sites'/'clients'を追加するのみ。
--   db-change原則1 append-only)。
--
-- 位置づけ: append-only(db-change原則1)。既存の列・他の制約・RLSポリシー・
--   `jobs`/`invoices`/`payments`のトリガーには一切触れない。冪等(db-change原則4。
--   `drop constraint if exists`→`add constraint`、`drop trigger if exists`→`create trigger`
--   のため、複数回実行しても同じ結果になる)。
--
-- 影響範囲:
--   - `audit_logs`の`entity_type`に新たに`'sites'`/`'clients'`が入るようになる
--     (既存の`getAuditLogsAction`(実装B・`entity_type`引数で絞り込み)や
--     `audit_logs_select`ポリシー(`using (true)`・authenticated全件参照)はそのまま
--     使える。entity_typeによる絞り込みが無いRLSのため、ポリシー変更は不要)。
--   - `sites`/`clients`の編集履歴を見るUI(変更履歴ダイアログ)は**未実装**(次段)。
--     本マイグレーション適用後は`audit_logs`テーブルには記録され続けるが、
--     画面から見る手段が無い状態になる(コードは今回変更しない。PM裁定どおり)。
--
-- 適用順序: `schema_poc.sql`(・`seed_poc.sql`・`migration_002_revoke_delete.sql`)適用後に
--   本ファイルを実行する。
-- 適用状況: **DBには未適用**(実装Aが作成のみ行った。適用はPM/ユーザーの判断で行う)。
--
-- 実行前の予行演習(推奨。db-changeスキル):
--   begin;
--     \i supabase/migration_003_audit_sites_clients.sql
--     -- 下記の確認クエリで sites/clients の insert/update が audit_logs に記録されることを見る
--   rollback;   -- 問題なければ commit; に変えて再実行
--   (Supabase SQL Editorは実行のたびに接続が変わるため、begin/rollbackは1回の実行に
--    まとめて書くこと)
--
-- 戻しSQL: supabase/rollback_003.sql
-- ============================================================================

-- 適用前後の確認用の参考クエリ(このマイグレーション自体はこの結果に依存しない)。
-- 適用前は 'sites'/'clients' の行が無く、適用後は現場・発注元を1件編集すると
-- 対応する行が増えることを確認する:
--
--   select entity_type, action, entity_id, created_at
--   from public.audit_logs
--   where entity_type in ('sites', 'clients')
--   order by created_at desc
--   limit 20;

begin;

-- audit_logs.entity_type の許容値を 'sites'/'clients' まで広げる(既存3値は維持)。
-- 制約名は schema_poc.sql の列内 check (名前を明示していない) から
-- Postgres の既定命名規則で `audit_logs_entity_type_check` になっている前提。
-- 万一名前が異なる環境向けに、存在しなくてもエラーにならない `if exists` を使う。
alter table public.audit_logs
  drop constraint if exists audit_logs_entity_type_check;

alter table public.audit_logs
  add constraint audit_logs_entity_type_check
  check (entity_type in ('jobs', 'invoices', 'payments', 'sites', 'clients'));

-- sites/clients に、jobs/invoices/payments と同じトリガーを追加する
-- (関数 `public.log_entity_changes()` は schema_poc.sql のものをそのまま使う。変更なし)。
drop trigger if exists trg_sites_log on public.sites;
create trigger trg_sites_log
  after insert or update on public.sites
  for each row execute function public.log_entity_changes();

drop trigger if exists trg_clients_log on public.clients;
create trigger trg_clients_log
  after insert or update on public.clients
  for each row execute function public.log_entity_changes();

commit;

-- ============================================================================
-- 適用後にやること(推奨):
--   1. 上記の確認クエリを再実行し、現場・発注元を1件編集すると `audit_logs` に
--      `entity_type='sites'`または`'clients'`の行が増えることを確認する。
--   2. 既存の現場・発注元の登録/編集/論理削除(削除も`is_deleted`のUPDATEのため
--      対象)が引き続き成功することを確認する(CHECK制約違反で失敗しないこと)。
--   3. 結果を docs/test-scenarios.md に追記する。
--   4. 現場・発注元の変更履歴を見るUI(`job-log-dialog.tsx`/`audit-log-dialog.tsx`と
--      同様のもの)は次段の実装課題(本マイグレーションはDB側の記録のみ)。
-- ============================================================================

-- schema_poc.sql への反映について:
--   migration_002 と同じ方針で、本ファイルは独立したインクリメンタルマイグレーションとして
--   置き、schema_poc.sql 自体は今回更新していない(PMの今回の指示範囲が
--   「migration_003・rollback_003・ドキュメント更新」のみのため)。次に schema_poc.sql を
--   通しで見直すタイミングで、この制約緩和とトリガー2本を本体に統合するかはPM判断待ち。
