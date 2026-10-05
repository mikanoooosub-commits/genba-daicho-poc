
-- ============================================================================
-- 予行演習の確認(結果は1つの表で返る。ok がすべて true で、最後に rollback される)
--   期待値は seed_poc.sql を流した DB のとき。ok が null の行は「参考の値」(判定しない)。
--   前半は移行したデータと権限の確認、後半(F で始まる行)は、確認用の案件を作ってトリガーを試す
--   (D87-4)。確認用のデータは rollback ですべて消える。
--   SQL Editor は最後の結果だけを表示するので、確認は temp 表に集めて、最後に1つの select で返す。
-- ============================================================================
create temp table dr_results (n integer, label text, actual bigint, expected bigint);

do $$
declare
  n integer := 0;
  test_building uuid;
  test_unit uuid;
  other_building uuid;
  other_unit uuid;
  a_client uuid;
  b_client uuid;
  test_case uuid;
  test_site uuid;
  test_invoice uuid;
  test_job uuid;
  other_site uuid;
  sites_before bigint;
  ok_raised boolean;
  case2 uuid;
  case2_site uuid;
begin
  -- ── 移行したデータ ──────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, '案件の数 − 現場の数(取り消し済みを含む。0 であること)',
    (select count(*) from public.cases) - (select count(*) from public.sites), 0);
  n := n + 1; insert into dr_results values (n, '案件が無い現場の数(0 であること)',
    (select count(*) from public.sites s where not exists (select 1 from public.cases c where c.site_id = s.id)), 0);
  n := n + 1; insert into dr_results values (n, '施工: case_id が無い行の数(取り消し済みを含む。0 であること)',
    (select count(*) from public.jobs where case_id is null), 0);
  n := n + 1; insert into dr_results values (n, '請求: case_id が無い行の数(取り消し済みを含む。0 であること)',
    (select count(*) from public.invoices where case_id is null), 0);
  n := n + 1; insert into dr_results values (n, '施工・請求の site_id が案件の site_id と食い違う行の数(0 であること)',
    (select count(*) from public.jobs j join public.cases c on c.id = j.case_id where j.site_id <> c.site_id)
    + (select count(*) from public.invoices i join public.cases c on c.id = i.case_id where i.site_id <> c.site_id), 0);
  n := n + 1; insert into dr_results values (n, '取り消されていない案件の数 − 取り消されていない現場の数(0 であること)',
    (select count(*) from public.cases where is_deleted = false) - (select count(*) from public.sites where is_deleted = false), 0);
  n := n + 1; insert into dr_results values (n, '案件の取り消し状態が現場と食い違う数(0 であること)',
    (select count(*) from public.cases c join public.sites s on s.id = c.site_id where c.is_deleted <> s.is_deleted), 0);
  n := n + 1; insert into dr_results values (n, '施工か請求がある現場の数 − 状態が「完了」の案件の数(0 であること)',
    (select count(*) from public.sites s
       where exists (select 1 from public.jobs j where j.site_id = s.id and j.is_deleted = false)
          or exists (select 1 from public.invoices i where i.site_id = s.id and i.is_deleted = false))
    - (select count(*) from public.cases where status = '完了'), 0);
  n := n + 1; insert into dr_results values (n, 'case_overview の行数(取り消されていない案件。seed は 13)',
    (select count(*) from public.case_overview), 13);
  n := n + 1; insert into dr_results values (n, 'case_overview のうち移行案件の数(seed は 13)',
    (select count(*) from public.case_overview where is_migrated), 13);
  n := n + 1; insert into dr_results values (n, 'さくらマンション 305 が「請求が未作成」(1)',
    (select count(*) from public.case_overview where building_name = 'さくらマンション' and room_no = '305' and needs_invoice), 1);
  n := n + 1; insert into dr_results values (n, '(参考)「請求が未作成」の案件の数',
    (select count(*) from public.case_overview where needs_invoice), null);
  n := n + 1; insert into dr_results values (n, '請求: 生きている請求の数 − 案件の請求の数の合計(0 であること)',
    (select count(*) from public.invoices where is_deleted = false)
    - (select coalesce(sum(invoice_count), 0) from public.case_overview), 0);
  n := n + 1; insert into dr_results values (n, '案件の番号がすべて K<年>-<4桁> の形(案件の数と一致)',
    (select count(*) from public.cases where case_no ~ '^K[0-9]{4}-[0-9]{4}$'), (select count(*) from public.cases));

  -- ── 権限 ──────────────────────────────────────────────────────
  n := n + 1; insert into dr_results values (n, '権限: anon が cases・case_overview・doc_counters に持つ権限の数(0 であること)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name in ('cases', 'case_overview', 'doc_counters') and grantee = 'anon'), 0);
  n := n + 1; insert into dr_results values (n, '権限: authenticated の cases で select/insert/update 以外の数(0 であること。DELETE を含む)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'cases' and grantee = 'authenticated'
         and privilege_type not in ('SELECT', 'INSERT', 'UPDATE')), 0);
  n := n + 1; insert into dr_results values (n, '権限: authenticated の cases の select/insert/update の数(3)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'cases' and grantee = 'authenticated'
         and privilege_type in ('SELECT', 'INSERT', 'UPDATE')), 3);
  n := n + 1; insert into dr_results values (n, '権限: authenticated の case_overview で select 以外の数(0 であること)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'case_overview' and grantee = 'authenticated'
         and privilege_type <> 'SELECT'), 0);
  n := n + 1; insert into dr_results values (n, '権限: authenticated が doc_counters に持つ権限の数(0 であること。関数経由だけ)',
    (select count(*) from information_schema.role_table_grants
       where table_schema = 'public' and table_name = 'doc_counters' and grantee = 'authenticated'), 0);
  n := n + 1; insert into dr_results values (n, '権限: anon が next_doc_no を実行できるか(0 = できない)',
    (select has_function_privilege('anon', 'public.next_doc_no(text)', 'execute')::integer), 0);
  n := n + 1; insert into dr_results values (n, '権限: authenticated が next_doc_no を実行できるか(1 = できる)',
    (select has_function_privilege('authenticated', 'public.next_doc_no(text)', 'execute')::integer), 1);
  n := n + 1; insert into dr_results values (n, 'next_doc_no が security definer で search_path を固定している(1)',
    (select count(*) from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = 'next_doc_no'
         and p.prosecdef and p.proconfig::text like '%search_path=%'), 1);

  -- ── トリガーの試験(確認用の物件・部屋・案件を作る。rollback で消える)──────────
  select id into a_client from public.clients where is_deleted = false order by created_at, id limit 1;
  select id into b_client from public.clients where is_deleted = false and id <> a_client order by created_at, id limit 1;
  select count(*) into sites_before from public.sites;

  insert into public.buildings (name, kind) values ('ZZ予行演習の物件', '集合住宅') returning id into test_building;
  insert into public.units (building_id, room_no) values (test_building, '101') returning id into test_unit;
  insert into public.buildings (name, kind) values ('ZZ予行演習の別の物件', '集合住宅') returning id into other_building;
  insert into public.units (building_id, room_no) values (other_building, '201') returning id into other_unit;

  insert into public.cases (building_id, unit_id, client_id, lead_source)
  values (test_building, test_unit, a_client, '管理会社') returning id, site_id into test_case, test_site;

  n := n + 1; insert into dr_results values (n, 'F1 案件を登録すると sites 行が1つできる(1)',
    (select count(*) from public.sites) - sites_before, 1);
  n := n + 1; insert into dr_results values (n, 'F2 できた sites 行は、物件名・部屋番号・発注元・集客経路の写しで、座標は NULL(1)',
    (select count(*) from public.sites s where s.id = test_site and s.building_name = 'ZZ予行演習の物件'
       and s.room_no = '101' and s.client_id = a_client and s.lead_source = '管理会社' and s.lat is null and s.lng is null), 1);
  n := n + 1; insert into dr_results values (n, 'F3 案件番号が K<年>-<4桁> の形で振られる(1)',
    (select count(*) from public.cases where id = test_case and case_no ~ '^K[0-9]{4}-[0-9]{4}$'), 1);
  n := n + 1; insert into dr_results values (n, 'F4 できた sites 行は v1 から移した行ではない(units.legacy_site_id に無い。0)',
    (select count(*) from public.units where legacy_site_id = test_site), 0);

  -- 請求(site_id を渡さない。トリガーが埋める)
  insert into public.invoices (case_id, amount) values (test_case, 10000) returning id into test_invoice;
  n := n + 1; insert into dr_results values (n, 'F5 案件に付けた請求の site_id が案件の site_id になる(1)',
    (select count(*) from public.invoices where id = test_invoice and site_id = test_site), 1);
  n := n + 1; insert into dr_results values (n, 'F6 その請求が invoice_ledger(v1 の台帳)に建物名つきで出る(1)',
    (select count(*) from public.invoice_ledger where invoice_id = test_invoice and building_name = 'ZZ予行演習の物件'
       and client_id = a_client and amount = 10000), 1);

  -- 施工(わざと食い違う site_id を渡す)
  select id into other_site from public.sites where id <> test_site order by created_at, id limit 1;
  insert into public.jobs (site_id, case_id, job_date) values (other_site, test_case, current_date) returning id into test_job;
  n := n + 1; insert into dr_results values (n, 'F7 食い違う site_id で施工を入れても、案件の site_id に直る(1)',
    (select count(*) from public.jobs where id = test_job and site_id = test_site), 1);

  n := n + 1; insert into dr_results values (n, 'F8 case_overview に、施工1件・請求1件・未入金10000の「請求済」として出る(1)',
    (select count(*) from public.case_overview where case_id = test_case and job_count = 1 and invoice_count = 1
       and unpaid_total = 10000 and display_status = '請求済'), 1);

  -- 名前を直したら sites 行に写る
  update public.buildings set name = 'ZZ予行演習の物件(改)' where id = test_building;
  update public.units set room_no = '102' where id = test_unit;
  n := n + 1; insert into dr_results values (n, 'F9 物件名・部屋番号を直すと sites 行にも写る(1)',
    (select count(*) from public.sites where id = test_site and building_name = 'ZZ予行演習の物件(改)' and room_no = '102'), 1);
  n := n + 1; insert into dr_results values (n, 'F10 台帳(invoice_ledger)の建物名も変わる(1)',
    (select count(*) from public.invoice_ledger where invoice_id = test_invoice and building_name = 'ZZ予行演習の物件(改)'), 1);
  update public.cases set client_id = b_client, lead_source = '紹介' where id = test_case;
  n := n + 1; insert into dr_results values (n, 'F11 案件の発注元・集客経路を直すと sites 行にも写る(1)',
    (select count(*) from public.sites where id = test_site and client_id = b_client and lead_source = '紹介'), 1);

  -- 他の物件の部屋を指定したら断られる
  ok_raised := false;
  begin
    insert into public.cases (building_id, unit_id, client_id) values (test_building, other_unit, a_client);
  exception when others then ok_raised := true;
  end;
  n := n + 1; insert into dr_results values (n, 'F12 他の物件の部屋を指定した案件は断られる(1)', ok_raised::integer, 1);

  -- 他の現場の site_id を渡しても使われず、新しい sites 行ができる
  insert into public.cases (building_id, unit_id, site_id, client_id)
  values (test_building, test_unit, other_site, a_client) returning id, site_id into case2, case2_site;
  n := n + 1; insert into dr_results values (n, 'F13 他の現場の site_id を渡しても使われず、新しい sites 行ができる(1)',
    (case2_site <> other_site and case2_site <> test_site)::integer, 1);

  -- 生きている請求がある案件は取り消せない
  ok_raised := false;
  begin
    update public.cases set is_deleted = true where id = test_case;
  exception when others then ok_raised := true;
  end;
  n := n + 1; insert into dr_results values (n, 'F14 生きている請求がある案件は取り消せない(1)', ok_raised::integer, 1);

  -- 請求を取り消したあとは取り消せて、sites 行も取り消される。元に戻すと sites 行も戻る
  update public.invoices set is_deleted = true where id = test_invoice;
  update public.cases set is_deleted = true where id = test_case;
  n := n + 1; insert into dr_results values (n, 'F15 請求を取り消したあとは案件を取り消せて、sites 行も取り消される(1)',
    (select count(*) from public.cases c join public.sites s on s.id = c.site_id
       where c.id = test_case and c.is_deleted and s.is_deleted), 1);
  n := n + 1; insert into dr_results values (n, 'F16 取り消した案件は case_overview に出ない(0)',
    (select count(*) from public.case_overview where case_id = test_case), 0);
  update public.cases set is_deleted = false where id = test_case;
  n := n + 1; insert into dr_results values (n, 'F17 元に戻すと sites 行も戻る(1)',
    (select count(*) from public.cases c join public.sites s on s.id = c.site_id
       where c.id = test_case and not c.is_deleted and not s.is_deleted), 1);

  -- 監査ログ(create・update・delete の3種類が残る)
  n := n + 1; insert into dr_results values (n, 'F18 案件の登録・更新・取り消しが audit_logs に残る(create・update・delete の3種類)',
    (select count(distinct action) from public.audit_logs where entity_type = 'cases' and entity_id = test_case), 3);

  -- 採番が進む
  n := n + 1; insert into dr_results values (n, 'F19 next_doc_no は呼ぶたびに番号が進む(1)',
    (public.next_doc_no('M') <> public.next_doc_no('M'))::integer, 1);
end
$$;

select label, actual, expected, (actual = expected) as ok
from dr_results
order by n;

rollback;
