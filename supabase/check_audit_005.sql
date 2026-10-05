-- ============================================================================
-- check_audit_005.sql — select 文だけ(WO-011 段階1)
--   物件・部屋の登録、部屋の取り消しと元に戻す、物件の取り消しと元に戻す(2026-10-05 の画面確認)が、
--   audit_logs に記録されていることを確かめる。
--   Supabase の SQL Editor で丸ごと実行し、結果の表を知らせる。
--
--   期待(確認用の物件「戸建て(確認用テスト・あとで取り消す)」について):
--     buildings: create 1 → update(取り消し)→ update(元に戻す)→ update(取り消し)→ update(元に戻す)→ delete(最後の取り消し)
--       ※ トリガーは「is_deleted が false→true の UPDATE」を action='delete'、それ以外の UPDATE を 'update' と記録する。
--         そのため、取り消しは 'delete'、元に戻すは 'update' で並ぶ。
--     units: T1・T2 の create が各 1、T2 の delete(取り消し)と update(元に戻す)
-- ============================================================================
select
  l.created_at,
  l.entity_type,
  l.action,
  coalesce(l.after_data ->> 'name', l.before_data ->> 'name') as building_name,
  coalesce(l.after_data ->> 'room_no', l.before_data ->> 'room_no') as room_no,
  coalesce(l.after_data ->> 'is_deleted', '(取り消し時は after が空)') as after_is_deleted
from public.audit_logs l
where l.entity_type in ('buildings', 'units')
  and l.created_at >= date '2026-10-05'
  and (
    (l.entity_type = 'buildings'
       and coalesce(l.after_data ->> 'name', l.before_data ->> 'name') like '戸建て(確認用テスト%')
    or (l.entity_type = 'units'
       and coalesce(l.after_data ->> 'building_id', l.before_data ->> 'building_id') in (
         select b.id::text from public.buildings b where b.name like '戸建て(確認用テスト%'))
  )
order by l.created_at;
