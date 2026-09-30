-- ============================================================================
-- migration_002_revoke_delete.sql
--   目的: clients/sites/jobs/invoices/payments/audit_logs に対して、
--   Supabaseの「Automatically expose new tables」等が既定で付与していた可能性のある
--   DELETE権限(および今後同じ事故が起きないようにするための default privileges)を
--   明示的に取り消す。
--
-- 背景(ISSUE-006・db-changeスキル原則7「RLSが唯一のアクセス制御」):
--   `schema_poc.sql` のGRANT文は `grant select, insert, update ...` のみで、
--   DELETEは付与していない(SPEC.md §9・§12決定どおり物理DELETEは許可しない設計)。
--   にもかかわらず、テストで認証済みトークンによる `DELETE /rest/v1/jobs` が
--   HTTP 204(成功扱い・実際は0件影響)を返すことが確認された(test-scenarios.md
--   A-7-2/B-7-2)。RLSにDELETEを許可するポリシーが無いため実データは削除されておらず、
--   実害はない(SELECTで対象行が変更されていないことを確認済み)。
--
--   ただし本来、テーブルレベルのGRANT DELETE自体が無ければPostgRESTは
--   42501(permission denied for table ...)を返すはずで、204(成功扱い)が
--   返っている以上、`anon`/`authenticated`ロールに対してテーブルレベルのGRANT DELETEが
--   既に存在する可能性が高い(Supabaseダッシュボードの「Automatically expose new
--   tables」等が新規テーブル作成時に`grant all`相当を既定で付与するケースがあるため)。
--   RLSはこの権限を「使わせない」防波堤として機能しているが、GRANT層自体に不要な権限が
--   残っているのは望ましくないため、明示的に取り消し、権限を多重に絞り込む。
--
-- 位置づけ: append-only(db-change原則1)。既存の `grant select, insert, update` は
--   一切変更しない。DELETE権限のみを明示的に取り消す追加のマイグレーション。
--   revoke は対象権限が実際には付与されていなくてもエラーにならないため冪等(db-change原則4)。
--
-- 適用順序: schema_poc.sql(・seed_poc.sql)適用後に本ファイルを実行する。
-- 適用状況: **DBには未適用**(実装Bが作成のみ行った。適用はPM/ユーザーの判断で行う)。
--
-- 実行前の予行演習(推奨。db-changeスキル):
--   begin;
--     \i supabase/migration_002_revoke_delete.sql
--     -- 下記の確認クエリで対象ロールにDELETE権限が残っていないことを見る
--   rollback;   -- 問題なければ commit; に変えて再実行
--   (Supabase SQL Editorは実行のたびに接続が変わるため、begin/rollbackは1回の実行に
--    まとめて書くこと)
--
-- 戻しSQL: supabase/rollback_002.sql
-- ============================================================================

-- 適用前後の確認用の参考クエリ(このマイグレーション自体はこの結果に依存しない)。
-- SQL Editorで別途実行し、grantee='anon'または'authenticated'でprivilege_type='DELETE'の
-- 行が、適用前は存在し、適用後は0件になることを確認する:
--
--   select grantee, table_name, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public'
--     and table_name in ('clients','sites','jobs','invoices','payments','audit_logs')
--     and grantee in ('anon','authenticated')
--   order by table_name, grantee, privilege_type;

begin;

-- 既存6テーブルのDELETE権限を明示的に取り消す(anon・authenticatedいずれも)。
revoke delete on public.clients, public.sites, public.jobs, public.invoices, public.payments, public.audit_logs
  from anon, authenticated;

-- 今後このスキーマに新しく作るテーブルにも同じ既定付与が及ばないよう、
-- publicスキーマの default privileges からもDELETEを外しておく(将来の事故予防)。
-- 対象は「このステートメントを実行するロール(通常はpostgresまたはダッシュボードの
-- 管理ロール)が今後 public スキーマに作成するテーブル」。既存のselect/insert/updateの
-- 既定付与には触れない(過剰な変更を避ける。db-change原則1 append-only)。
alter default privileges in schema public
  revoke delete on tables from anon, authenticated;

commit;

-- ============================================================================
-- 適用後にやること(推奨):
--   1. 上記の確認クエリを再実行し、DELETE権限の行が0件になっていることを確認する。
--   2. docs/test-scenarios.md の A-7-2 / B-7-2 を再実施し、認証済みトークンでの
--      DELETEが 42501(permission denied)等の明示的な拒否になることを確認する
--      (db-changeスキル「書き込み側が通るか」の確認に相当)。
--   3. 結果を docs/test-scenarios.md に追記し、docs/issue-log.md の ISSUE-006 の
--      状態を更新する。
-- ============================================================================
