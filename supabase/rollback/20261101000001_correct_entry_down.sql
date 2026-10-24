-- Откат 20261101000001_correct_entry. Исправленные цены и объёмы остаются как есть (история — в entry_corrections до удаления).
drop function if exists public.admin_correct_entry(bigint, numeric, bigint);
create or replace function public.request_money(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return (
    select jsonb_build_object(
      'works', coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'unit_price_kop', m.unit_price_kop, 'total_kop', m.total_kop) order by w.id), '[]'::jsonb),
      'total_kop', coalesce(sum(m.total_kop) filter (where w.status <> 'rejected'), 0),
      'unpriced', count(*) filter (where m.entry_id is null and w.status <> 'rejected'))
    from work_entries w
    left join entry_money m on m.entry_id = w.id
    where w.request_id = p_id);
end $$;
drop table if exists public.entry_corrections;
