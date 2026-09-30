-- ============================================================================
-- data_fix_001_fictional_names.sql — 実在の会社と紛らわしい名前を架空名に置き換える(WO-006 差し戻し1)
--
--   対象は「値の書き換え」だけ(スキーマ変更なし・delete なし)。
--   発注元名(clients.name)は既にアプリの編集画面で変更済み:
--     アップル管理サービス株式会社 → 管理会社A(架空) / 共栄ハウジング管理株式会社 → 管理会社B(架空)
--     クリーンアップ本部(FC) → FC本部C(架空・クリーニング) / リノベパートナーズ本部(FC) → FC本部D(架空・リペア)
--   ここでは、それ以外に旧名が残っている3か所を直す:
--     ① invoices.format_pattern(請求の様式名)
--     ② clients.format_memo(様式メモ)
--     ③ sites.building_name(現場名「共栄コーポ徳丸」)
--   監査トリガーが更新を記録する(想定どおり)。
--   ※②の置換後の文字列は、適用後に差し戻し2で「管理会社Bの指定Webシステム…」へ直した(DBは発注元の編集画面で修正済み。
--     ここは記録を揃えただけで、適用済みの環境で再実行する必要はない)。
--   戻し: rollback_data_fix_001.sql(新→旧の update)。
--   実行: Supabase の SQL Editor(適用はユーザー)。再実行しても、旧値が無ければ 0 件更新で害はない。
-- ============================================================================

-- ─── 適用前の確認(結果を見てから下の begin 以降を実行する。件数は seed のままなら括弧内) ───
-- select count(*) from public.invoices where format_pattern = 'Excel雛形(アップル管理サービス)';      -- 5
-- select count(*) from public.invoices where format_pattern = 'Web入力(共栄ハウジング管理)';          -- 6
-- select count(*) from public.invoices where format_pattern = 'FCアプリ雛形(クリーンアップ本部)';     -- 5
-- select count(*) from public.invoices where format_pattern = 'PDF雛形(リノベパートナーズ本部)';      -- 4
-- select count(*) from public.clients  where format_memo like '%指定Webシステム(共栄オーナーズ)%';                    -- 1
-- select count(*) from public.sites    where building_name = '共栄コーポ徳丸';                         -- 1
-- (画面から取消・編集した行があれば件数は変わる。0 件の行は「すでに直っている」だけなので問題ない)

begin;

-- ① 請求の様式名
update public.invoices set format_pattern = 'Excel雛形(管理会社A)'
  where format_pattern = 'Excel雛形(アップル管理サービス)';
update public.invoices set format_pattern = 'Web入力(管理会社B)'
  where format_pattern = 'Web入力(共栄ハウジング管理)';
update public.invoices set format_pattern = 'FCアプリ雛形(FC本部C)'
  where format_pattern = 'FCアプリ雛形(クリーンアップ本部)';
update public.invoices set format_pattern = 'PDF雛形(FC本部D)'
  where format_pattern = 'PDF雛形(リノベパートナーズ本部)';

-- ② 発注元の様式メモ(旧名を含む部分だけ置き換える)
update public.clients
  set format_memo = replace(format_memo, '指定Webシステム(共栄オーナーズ)', '管理会社Bの指定Webシステム')
  where format_memo like '%指定Webシステム(共栄オーナーズ)%';

-- ③ 現場名
update public.sites set building_name = '徳丸コーポ'
  where building_name = '共栄コーポ徳丸';

commit;
