-- ============================================================================
-- diagnose_payment_005.sql — select 文だけ(D84)
--   予行演習で「入金: 部屋から辿れる数 − 全体」が −1 になった原因を調べる。
--   見立て: 取り消されていない入金が、取り消し済みの請求(または削除済みの現場)にぶら下がっている。
--   Supabase の SQL Editor で丸ごと実行し、結果の表(行があれば全部)を知らせる。
-- ============================================================================
select
  p.id            as payment_id,
  p.payment_date,
  p.amount        as payment_amount,
  p.is_deleted    as payment_deleted,
  i.id            as invoice_id,
  i.is_deleted    as invoice_deleted,
  i.amount        as invoice_amount,
  i.issue_date,
  s.building_name,
  s.room_no,
  s.is_deleted    as site_deleted,
  case
    when i.is_deleted and s.is_deleted then '請求も現場も削除済み'
    when i.is_deleted then '請求が取り消し済み'
    when s.is_deleted then '現場が削除済み'
  end as reason
from public.payments p
join public.invoices i on i.id = p.invoice_id
join public.sites s on s.id = i.site_id
where p.is_deleted = false
  and (i.is_deleted = true or s.is_deleted = true)
order by p.payment_date;
