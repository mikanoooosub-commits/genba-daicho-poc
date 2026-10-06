
-- ============================================================================
-- 予行演習の確認(結果は1つの表で返る。ok がすべて true で、最後に rollback される)
--   確認用の物件・部屋・案件・見積・請求を作って、トリガーと関数を試す(G で始まる行)。
--   後半(P で始まる行)は権限の確認。確認用のデータは rollback ですべて消える。
--   SQL Editor は最後の結果だけを表示するので、確認は temp 表に集めて、最後に1つの select で返す。
-- ============================================================================
create temp table dr_results (n integer, label text, actual bigint, expected bigint);

-- 実行して、例外が出たら true を返す(確認用。サブトランザクションなので、失敗しても先へ進める)
create or replace function pg_temp.dr_raises(q text) returns boolean
language plpgsql as $$
begin
  execute q;
  return false;
exception when others then
  return true;
end
$$;

do $$
declare
  n integer := 0;
  a_client uuid;
  test_building uuid;
  test_unit uuid;
  test_case uuid;
  dead_case uuid;
  e1 uuid;
  e1_v2 uuid;
  e2 uuid;
  e3 uuid;
  empty_e uuid;
  inv uuid;
  audit_before bigint;
  audit_after bigint;
  item_a uuid;
  item_b uuid;
  extra_item uuid;
  disc_item uuid;
  e1_no text;
  copied integer;
begin
  select id into a_client from public.clients where is_deleted = false order by created_at, id limit 1;
  insert into public.buildings (name, kind) values ('ZZ予行演習の物件(見積)', '集合住宅') returning id into test_building;
  insert into public.units (building_id, room_no) values (test_building, '101') returning id into test_unit;
  insert into public.cases (building_id, unit_id, client_id) values (test_building, test_unit, a_client) returning id into test_case;
  insert into public.cases (building_id, unit_id, client_id) values (test_building, test_unit, a_client) returning id into dead_case;
  update public.cases set is_deleted = true where id = dead_case;

  -- ── 見積の登録 ─────────────────────────────────────────────────
  insert into public.estimates (case_id, status, total_yen, version) values (test_case, '採用', 999, 7) returning id, estimate_no into e1, e1_no;
  n := n + 1; insert into dr_results values (n, 'G1 見積を登録すると、番号が M<年>-<4桁>・版 1・下書き・合計 0 になる(状態・合計・版を画面から指定しても上書き)(1)',
    (select count(*) from public.estimates where id = e1 and estimate_no ~ '^M[0-9]{4}-[0-9]{4}$' and version = 1
       and status = '下書き' and total_yen = 0), 1);
  n := n + 1; insert into dr_results values (n, 'G2 取り消された案件には見積を作れない(1)',
    pg_temp.dr_raises(format($q$insert into public.estimates (case_id) values (%L)$q$, dead_case))::integer, 1);

  -- ── 明細の保存と計算(save_estimate_items)──────────────────────────
  select count(*) into audit_before from public.audit_logs where entity_type = 'estimates' and entity_id = e1;
  perform public.save_estimate_items(e1, jsonb_build_array(
    jsonb_build_object('category', '施工費', 'description', 'クロス張替え', 'quantity', 12.5, 'unit', '㎡', 'unit_price_yen', 2980),
    jsonb_build_object('category', '商品代', 'description', '巾木', 'quantity', 3, 'unit', '本', 'unit_price_yen', 1234),
    jsonb_build_object('category', '値引き', 'description', '出精値引き', 'quantity', 1, 'unit', '式', 'unit_price_yen', -1000),
    jsonb_build_object('category', '経費', 'description', '養生', 'quantity', 0.33, 'unit', '式', 'unit_price_yen', 100)));
  select count(*) into audit_after from public.audit_logs where entity_type = 'estimates' and entity_id = e1;
  -- 12.5×2980=37250 / 3×1234=3702 / -1000 / 0.33×100=33 → 小計 39985。税 = 39985×10/100 = 3998(3998.5 を切り捨て)。合計 43983
  n := n + 1; insert into dr_results values (n, 'G3 保存すると小計がサーバーで計算される(39985)',
    (select subtotal_yen from public.estimates where id = e1), 39985);
  n := n + 1; insert into dr_results values (n, 'G4 税は小計に対して1回、切り捨て(3998)',
    (select tax_yen from public.estimates where id = e1), 3998);
  n := n + 1; insert into dr_results values (n, 'G5 合計(税込)= 小計 + 税(43983)',
    (select total_yen from public.estimates where id = e1), 43983);
  n := n + 1; insert into dr_results values (n, 'G6 明細4行の金額が 37250・3702・-1000・33 に計算される(1)',
    (select count(*) from (select array_agg(amount_yen order by sort_order) as a from public.estimate_items
       where estimate_id = e1 and is_deleted = false) x where x.a = array[37250, 3702, -1000, 33]), 1);
  n := n + 1; insert into dr_results values (n, 'G7 4行を保存しても、監査ログの更新は1行だけ増える(1)', audit_after - audit_before, 1);

  -- 画面から来た金額は信用しない(直接 insert して、金額を偽る)
  insert into public.estimate_items (estimate_id, sort_order, category, description, quantity, unit_price_yen, amount_yen)
  values (e1, 9, '施工費', '金額を偽った行', 2, 500, 777) returning id into extra_item;
  n := n + 1; insert into dr_results values (n, 'G8 金額を偽って insert しても、数量×単価に直る(1000)',
    (select amount_yen from public.estimate_items where id = extra_item), 1000);
  n := n + 1; insert into dr_results values (n, 'G9 直接 insert でも、見積の合計が計算し直される(小計 40985)',
    (select subtotal_yen from public.estimates where id = e1), 40985);
  update public.estimate_items set is_deleted = true where id = extra_item;
  n := n + 1; insert into dr_results values (n, 'G10 明細を論理削除すると合計から外れる(小計 39985)',
    (select subtotal_yen from public.estimates where id = e1), 39985);

  -- 値引きの端数: 0 方向の切り捨て
  insert into public.estimate_items (estimate_id, sort_order, category, description, quantity, unit_price_yen)
  values (e1, 10, '値引き', '端数の試験', 1.5, -1001) returning id into disc_item;
  n := n + 1; insert into dr_results values (n, 'G11 値引き 1.5 × -1001 = -1501.5 は、0 方向に切り捨てて -1501',
    (select amount_yen from public.estimate_items where id = disc_item), -1501);
  update public.estimate_items set is_deleted = true where id = disc_item;
  n := n + 1; insert into dr_results values (n, 'G12 値引きの単価がプラスの行は断られる(1)',
    pg_temp.dr_raises(format($q$insert into public.estimate_items (estimate_id, category, description, unit_price_yen) values (%L, '値引き', 'x', 100)$q$, e1))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G13 施工費の単価がマイナスの行は断られる(1)',
    pg_temp.dr_raises(format($q$insert into public.estimate_items (estimate_id, category, description, unit_price_yen) values (%L, '施工費', 'x', -100)$q$, e1))::integer, 1);

  -- 税率・合計を画面から書いても、計算し直される
  update public.estimates set tax_rate_pct = 8, total_yen = 1 where id = e1;
  n := n + 1; insert into dr_results values (n, 'G14 税率 8% にすると、税 = 39985×8/100 = 3198、合計 43183(画面から書いた合計は上書き)(1)',
    (select count(*) from public.estimates where id = e1 and tax_yen = 3198 and total_yen = 43183), 1);
  update public.estimates set tax_rate_pct = 10 where id = e1;
  n := n + 1; insert into dr_results values (n, 'G15 税率を 10% に戻すと 43983(1)',
    (select count(*) from public.estimates where id = e1 and total_yen = 43983), 1);
  n := n + 1; insert into dr_results values (n, 'G16 税率 5% は断られる(1)',
    pg_temp.dr_raises(format($q$update public.estimates set tax_rate_pct = 5 where id = %L$q$, e1))::integer, 1);

  -- ── 提出 ──────────────────────────────────────────────────────
  insert into public.estimates (case_id) values (test_case) returning id into empty_e;
  n := n + 1; insert into dr_results values (n, 'G17 明細が1行もない見積は提出できない(1)',
    pg_temp.dr_raises(format($q$update public.estimates set status = '提出済' where id = %L$q$, empty_e))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G18 下書きから、いきなり採用にはできない(1)',
    pg_temp.dr_raises(format($q$update public.estimates set status = '採用' where id = %L$q$, e1))::integer, 1);

  update public.estimates set status = '提出済' where id = e1;
  n := n + 1; insert into dr_results values (n, 'G19 提出すると、提出日が入る(日本時間の今日)(1)',
    (select count(*) from public.estimates where id = e1 and status = '提出済' and issue_date = (now() at time zone 'Asia/Tokyo')::date), 1);
  select id into item_a from public.estimate_items where estimate_id = e1 and is_deleted = false order by sort_order limit 1;
  n := n + 1; insert into dr_results values (n, 'G20 提出済の見積に明細を足せない(1)',
    pg_temp.dr_raises(format($q$insert into public.estimate_items (estimate_id, description) values (%L, 'x')$q$, e1))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G21 提出済の見積の明細を変えられない(1)',
    pg_temp.dr_raises(format($q$update public.estimate_items set unit_price_yen = 1 where id = %L$q$, item_a))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G22 提出済の見積の明細を論理削除できない(1)',
    pg_temp.dr_raises(format($q$update public.estimate_items set is_deleted = true where id = %L$q$, item_a))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G23 提出済の見積に save_estimate_items できない(1)',
    pg_temp.dr_raises(format($q$select public.save_estimate_items(%L, '[]'::jsonb)$q$, e1))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G24 提出済の見積の備考・税率を変えられない(2)',
    pg_temp.dr_raises(format($q$update public.estimates set note = 'x' where id = %L$q$, e1))::integer
    + pg_temp.dr_raises(format($q$update public.estimates set tax_rate_pct = 8 where id = %L$q$, e1))::integer, 2);
  n := n + 1; insert into dr_results values (n, 'G25 提出済を下書きに戻せない・取り消せない(2)',
    pg_temp.dr_raises(format($q$update public.estimates set status = '下書き' where id = %L$q$, e1))::integer
    + pg_temp.dr_raises(format($q$update public.estimates set is_deleted = true where id = %L$q$, e1))::integer, 2);

  -- ── 採用は1案件に1つ ─────────────────────────────────────────────
  update public.estimates set status = '採用' where id = e1;
  insert into public.estimates (case_id) values (test_case) returning id into e2;
  perform public.save_estimate_items(e2, jsonb_build_array(
    jsonb_build_object('category', '施工費', 'description', '別案', 'quantity', 1, 'unit', '式', 'unit_price_yen', 50000)));
  update public.estimates set status = '提出済' where id = e2;
  n := n + 1; insert into dr_results values (n, 'G26 同じ案件で2つ目の見積を採用にできない(1)',
    pg_temp.dr_raises(format($q$update public.estimates set status = '採用' where id = %L$q$, e2))::integer, 1);
  update public.estimates set status = '不採用' where id = e2;
  n := n + 1; insert into dr_results values (n, 'G27 もう1つの見積は不採用にできる(1)',
    (select count(*) from public.estimates where id = e2 and status = '不採用'), 1);

  -- ── 出し直し ──────────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, 'G28 採用の見積は、そのまま出し直せない(先に提出済に戻す)(1)',
    pg_temp.dr_raises(format($q$select public.reissue_estimate(%L)$q$, e1))::integer, 1);
  update public.estimates set status = '提出済' where id = e1;
  n := n + 1; insert into dr_results values (n, 'G29 請求が無ければ、採用を提出済に戻せる(1)',
    (select count(*) from public.estimates where id = e1 and status = '提出済'), 1);
  select public.reissue_estimate(e1) into e1_v2;
  n := n + 1; insert into dr_results values (n, 'G30 出し直すと、同じ番号で版 2 の下書きができる(元の版が記録される)(1)',
    (select count(*) from public.estimates where id = e1_v2 and estimate_no = e1_no and version = 2
       and status = '下書き' and copied_from_id = e1), 1);
  n := n + 1; insert into dr_results values (n, 'G31 明細4行が写り、合計も同じ(43983)・写した印がつく(1)',
    (select count(*) from public.estimates v where v.id = e1_v2 and v.total_yen = 43983
       and (select count(*) from public.estimate_items it
             where it.estimate_id = v.id and it.is_deleted = false and it.copied_from_item_id is not null) = 4), 1);
  n := n + 1; insert into dr_results values (n, 'G32 元の版(版 1)は変わらない(提出済・43983)(1)',
    (select count(*) from public.estimates where id = e1 and status = '提出済' and total_yen = 43983), 1);
  n := n + 1; insert into dr_results values (n, 'G33 新しい版があるとき、古い版は採用できない(1)',
    pg_temp.dr_raises(format($q$update public.estimates set status = '採用' where id = %L$q$, e1))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G34 新しい版があるとき、同じ版をもう一度出し直せない(1)',
    pg_temp.dr_raises(format($q$select public.reissue_estimate(%L)$q$, e1))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G35 同じ番号・同じ版は作れない(1)',
    pg_temp.dr_raises(format($q$insert into public.estimates (case_id, estimate_no, version, copied_from_id) values (%L, %L, 2, %L)$q$, test_case, e1_no, e1))::integer, 1);

  -- 版 2 を直して、提出して、採用する
  select id into item_b from public.estimate_items where estimate_id = e1_v2 and is_deleted = false and category = '商品代';
  perform public.save_estimate_items(e1_v2, (
    select jsonb_agg(jsonb_build_object('id', id, 'category', category, 'description', description, 'quantity',
             case when id = item_b then 4 else quantity end, 'unit', unit, 'unit_price_yen', unit_price_yen,
             'copied_from_item_id', copied_from_item_id) order by sort_order)
    from public.estimate_items where estimate_id = e1_v2 and is_deleted = false));
  -- 12.5×2980=37250 / 4×1234=4936 / -1000 / 33 → 41219。税 4121(4121.9)。合計 45340
  n := n + 1; insert into dr_results values (n, 'G36 版 2 の数量を直すと合計が変わり、版 1 は変わらない(45340 / 43983)',
    (select total_yen from public.estimates where id = e1_v2)::bigint * 1000000 + (select total_yen from public.estimates where id = e1), 45340::bigint * 1000000 + 43983);
  update public.estimates set status = '提出済' where id = e1_v2;
  update public.estimates set status = '採用' where id = e1_v2;

  -- ── 見積から請求 ───────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, 'G37 採用していない見積からは請求を作れない(1)',
    pg_temp.dr_raises(format($q$insert into public.invoices (case_id, estimate_id, amount) values (%L, %L, 1)$q$, test_case, e2))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G38 別の案件の請求としては作れない(1)',
    pg_temp.dr_raises(format($q$insert into public.invoices (case_id, estimate_id, amount) select id, %L, 1 from public.cases where id <> %L and is_deleted = false limit 1$q$, e1_v2, test_case))::integer, 1);
  insert into public.invoices (case_id, estimate_id, amount) values (test_case, e1_v2, 1) returning id into inv;
  n := n + 1; insert into dr_results values (n, 'G39 見積から作った請求は、金額(税込)と税率を見積から写す(画面から来た金額 1 は上書き)(1)',
    (select count(*) from public.invoices where id = inv and amount = 45340 and tax_rate_pct = 10), 1);
  n := n + 1; insert into dr_results values (n, 'G40 その請求が invoice_ledger(v1 の台帳)に出る(金額 45340)(1)',
    (select count(*) from public.invoice_ledger where invoice_id = inv and amount = 45340 and building_name = 'ZZ予行演習の物件(見積)'), 1);
  n := n + 1; insert into dr_results values (n, 'G41 同じ見積から2つ目の請求は作れない(1)',
    pg_temp.dr_raises(format($q$insert into public.invoices (case_id, estimate_id, amount) values (%L, %L, 1)$q$, test_case, e1_v2))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G42 見積から作った請求の金額・税率は直せない(2)',
    pg_temp.dr_raises(format($q$update public.invoices set amount = 1 where id = %L$q$, inv))::integer
    + pg_temp.dr_raises(format($q$update public.invoices set tax_rate_pct = 8 where id = %L$q$, inv))::integer, 2);
  n := n + 1; insert into dr_results values (n, 'G43 見積とのひもづけは外せない・付け替えられない(2)',
    pg_temp.dr_raises(format($q$update public.invoices set estimate_id = null where id = %L$q$, inv))::integer
    + pg_temp.dr_raises(format($q$update public.invoices set estimate_id = %L where id = %L$q$, e2, inv))::integer, 2);
  update public.invoices set memo = '確認用のメモ', issue_date = current_date where id = inv;
  n := n + 1; insert into dr_results values (n, 'G44 請求のメモ・日付は直せる(1)',
    (select count(*) from public.invoices where id = inv and memo = '確認用のメモ'), 1);
  n := n + 1; insert into dr_results values (n, 'G45 請求が付いている見積は、提出済に戻せない(1)',
    pg_temp.dr_raises(format($q$update public.estimates set status = '提出済' where id = %L$q$, e1_v2))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G46 case_overview の請求額が見積の合計と一致する(45340)(1)',
    (select count(*) from public.case_overview where case_id = test_case and invoiced_total = 45340), 1);

  -- 請求を取り消せば戻せる。取り消した請求は、見積が採用でなくなると元に戻せない
  update public.invoices set is_deleted = true where id = inv;
  update public.estimates set status = '提出済' where id = e1_v2;
  n := n + 1; insert into dr_results values (n, 'G47 請求を取り消したあとは、採用を提出済に戻せる(1)',
    (select count(*) from public.estimates where id = e1_v2 and status = '提出済'), 1);
  n := n + 1; insert into dr_results values (n, 'G48 見積が採用でなくなったら、取り消した請求は元に戻せない(1)',
    pg_temp.dr_raises(format($q$update public.invoices set is_deleted = false where id = %L$q$, inv))::integer, 1);
  update public.estimates set status = '採用' where id = e1_v2;
  update public.invoices set is_deleted = false where id = inv;
  n := n + 1; insert into dr_results values (n, 'G49 見積を採用に戻せば、請求も元に戻せる(1)',
    (select count(*) from public.invoices where id = inv and is_deleted = false), 1);
  n := n + 1; insert into dr_results values (n, 'G50 請求の変更が監査ログに残る(invoices の create・update・delete)(3)',
    (select count(distinct action) from public.audit_logs where entity_type = 'invoices' and entity_id = inv), 3);

  -- v1 の画面で作る請求(見積なし)は、いままでどおり
  insert into public.invoices (case_id, amount) values (test_case, 12345.5) returning id into extra_item;
  n := n + 1; insert into dr_results values (n, 'G51 見積に結びつかない請求は、いままでどおり金額を自由に入れられる(12345.5)(1)',
    (select count(*) from public.invoices where id = extra_item and amount = 12345.5 and estimate_id is null), 1);
  update public.invoices set amount = 20000 where id = extra_item;
  n := n + 1; insert into dr_results values (n, 'G52 見積に結びつかない請求は、金額を直せる(20000)',
    (select amount::bigint from public.invoices where id = extra_item), 20000);

  -- ── 前回の見積を写す(copy_estimate_items)─────────────────────────
  insert into public.estimates (case_id) values (test_case) returning id into e3;
  select public.copy_estimate_items(e3, array(select id from public.estimate_items
    where estimate_id = e1_v2 and is_deleted = false and category in ('施工費', '値引き') order by sort_order)) into copied;
  n := n + 1; insert into dr_results values (n, 'G53 2行(施工費・値引き)を写すと、2行が増え、写した印がつく(2)',
    (select count(*) from public.estimate_items where estimate_id = e3 and is_deleted = false and copied_from_item_id is not null), 2);
  n := n + 1; insert into dr_results values (n, 'G54 写した先で金額が計算し直され、合計もサーバーが出す(小計 36250、税 3625、合計 39875)(1)',
    (select count(*) from public.estimates where id = e3 and subtotal_yen = 36250 and tax_yen = 3625 and total_yen = 39875), 1);
  n := n + 1; insert into dr_results values (n, 'G55 写しても、写し元(版 2)は変わらない(合計 45340)',
    (select total_yen from public.estimates where id = e1_v2), 45340);
  n := n + 1; insert into dr_results values (n, 'G56 存在しない明細は写せない(1)',
    pg_temp.dr_raises(format($q$select public.copy_estimate_items(%L, array[gen_random_uuid()])$q$, e3))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G57 提出済の見積には写せない(1)',
    pg_temp.dr_raises(format($q$select public.copy_estimate_items(%L, array(select id from public.estimate_items where estimate_id = %L limit 1))$q$, e1, e1_v2))::integer, 1);
  n := n + 1; insert into dr_results values (n, 'G58 論理削除した明細は写せない(1)',
    pg_temp.dr_raises(format($q$select public.copy_estimate_items(%L, array[%L::uuid])$q$, e3, disc_item))::integer, 1);

  -- 下書きの見積は取り消せて、取り消すと写せない・保存できない
  update public.estimates set is_deleted = true where id = e3;
  n := n + 1; insert into dr_results values (n, 'G59 下書きの見積は取り消せる(1)',
    (select count(*) from public.estimates where id = e3 and is_deleted), 1);
  n := n + 1; insert into dr_results values (n, 'G60 取り消した見積の明細は変えられない(1)',
    pg_temp.dr_raises(format($q$select public.save_estimate_items(%L, '[]'::jsonb)$q$, e3))::integer, 1);

  -- 監査ログ
  n := n + 1; insert into dr_results values (n, 'G61 見積の登録・更新・取り消しが audit_logs に残る(create・update・delete の3種類)(3)',
    (select count(distinct action) from public.audit_logs
      where entity_type = 'estimates' and entity_id in (e1, e3)), 3);
  n := n + 1; insert into dr_results values (n, 'G62 明細の行ごとの監査ログは作らない(estimate_items の行 0)',
    (select count(*) from public.audit_logs where entity_type = 'estimate_items'), 0);

  -- ── 既存データ・権限 ─────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, 'P1 既存の請求に見積は結びついていない(確認用の案件の請求を除いて 0)',
    (select count(*) from public.invoices where estimate_id is not null and case_id <> test_case), 0);
  n := n + 1; insert into dr_results values (n, 'P2 権限: anon が estimates・estimate_items に持つ権限の数(0 であること)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('estimates', 'estimate_items') and grantee = 'anon'), 0);
  n := n + 1; insert into dr_results values (n, 'P3 権限: authenticated の estimates・estimate_items で select/insert/update 以外の数(0 であること。DELETE を含む)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('estimates', 'estimate_items') and grantee = 'authenticated'
         and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')), 0);
  n := n + 1; insert into dr_results values (n, 'P4 権限: authenticated の select/insert/update の数(2 表 × 3 = 6)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('estimates', 'estimate_items') and grantee = 'authenticated'
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE')), 6);
  n := n + 1; insert into dr_results values (n, 'P5 権限: anon が3つの関数を実行できる数(0 = できない)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('save_estimate_items', 'copy_estimate_items', 'reissue_estimate')
       and has_function_privilege('anon', p.oid, 'execute')), 0);
  n := n + 1; insert into dr_results values (n, 'P6 権限: authenticated が3つの関数を実行できる数(3)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('save_estimate_items', 'copy_estimate_items', 'reissue_estimate')
       and has_function_privilege('authenticated', p.oid, 'execute')), 3);
  n := n + 1; insert into dr_results values (n, 'P7 新しい関数7本がすべて search_path を固定していて、security definer ではない(7)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and p.proname in ('save_estimate_items', 'copy_estimate_items', 'reissue_estimate', 'estimates_before_write',
                         'estimate_items_before_write', 'estimate_items_after_write', 'invoices_from_estimate')
       and not p.prosecdef and p.proconfig::text like '%search_path=%'), 7);
  n := n + 1; insert into dr_results values (n, 'P8 RLS が estimates・estimate_items で有効(2)',
    (select count(*) from pg_class where oid in ('public.estimates'::regclass, 'public.estimate_items'::regclass) and relrowsecurity), 2);
  n := n + 1; insert into dr_results values (n, 'P9 (参考)見積の数(確認用を含む)',
    (select count(*) from public.estimates), null);
end
$$;

select label, actual, expected, (actual = expected) as ok
from dr_results
order by n;

rollback;
