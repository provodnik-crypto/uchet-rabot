-- «Заменить на прайс»: руководитель видит цену позиций на дату работы до замены.
-- Только добавляет функцию (только чтение). Откат: supabase/rollback/20261031000001_replace_price_preview_down.sql
create function public.item_prices_for_entry(p_entry bigint, p_items bigint[])
returns table (item_id bigint, price_kop bigint)
language plpgsql stable security definer set search_path = public as $$
declare v_date date;
begin
  perform public.require_manager();
  select s.work_date into v_date from work_entries e join shifts s on s.id = e.shift_id where e.id = p_entry;
  if v_date is null then raise exception 'Работа не найдена'; end if;
  return query
    select i.id, public.price_on(i.id, v_date)
    from price_items i
    where i.id = any (p_items);
end $$;
revoke all on function public.item_prices_for_entry(bigint, bigint[]) from public, anon;
grant execute on function public.item_prices_for_entry(bigint, bigint[]) to authenticated;
