-- Цены и суммы работ заявки — только руководителю (мастер видит лишь итоги за месяц и рейтинг).
-- Только добавляет функцию. Откат: supabase/rollback/20261025000001_request_money_down.sql
create function public.request_money(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return (
    select jsonb_build_object(
      'works', coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'unit_price_kop', m.unit_price_kop, 'total_kop', m.total_kop) order by w.id), '[]'::jsonb),
      -- итог: работы с ценой, кроме отклонённых
      'total_kop', coalesce(sum(m.total_kop) filter (where w.status <> 'rejected'), 0),
      'unpriced', count(*) filter (where m.entry_id is null and w.status <> 'rejected'))
    from work_entries w
    left join entry_money m on m.entry_id = w.id
    where w.request_id = p_id);
end $$;
revoke all on function public.request_money(bigint) from public, anon;
grant execute on function public.request_money(bigint) to authenticated;
