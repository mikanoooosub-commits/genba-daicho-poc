-- ============================================================================
-- rollback_data_fix_001.sql — data_fix_001_fictional_names.sql の戻しSQL(新→旧の update)
--
--   発注元名(clients.name)の変更はこのファイルの対象外(アプリの編集画面で行ったため。
--   戻す場合も編集画面から)。旧名は実在の会社と紛らわしいので、戻すのは
--   「修正で不具合が出た」などの場合に限る。
-- ============================================================================

begin;

update public.invoices set format_pattern = 'Excel雛形(アップル管理サービス)'
  where format_pattern = 'Excel雛形(管理会社A)';
update public.invoices set format_pattern = 'Web入力(共栄ハウジング管理)'
  where format_pattern = 'Web入力(管理会社B)';
update public.invoices set format_pattern = 'FCアプリ雛形(クリーンアップ本部)'
  where format_pattern = 'FCアプリ雛形(FC本部C)';
update public.invoices set format_pattern = 'PDF雛形(リノベパートナーズ本部)'
  where format_pattern = 'PDF雛形(FC本部D)';

update public.clients
  set format_memo = replace(format_memo, '管理会社Bの指定Webシステム', '指定Webシステム(共栄オーナーズ)')
  where format_memo like '%管理会社Bの指定Webシステム%';

update public.sites set building_name = '共栄コーポ徳丸'
  where building_name = '徳丸コーポ';

commit;
