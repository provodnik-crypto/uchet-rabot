-- Исправление объёма и цены уже оценённой работы руководителем (✏️ в блоке «Работы»), 01.11.2026.
--  * Только эта работа: прайс не меняется (решение заказчика).
--  * Мастер не видит: в ленту заявки не пишем; история «было → стало» — entry_corrections (закрыта, только для разбора).
--  * Пересчёт: entry_money (сумма работы) и performer_money (доли исполнителей) — суммы месяца и итог команды берутся из них.

create table public.entry_corrections (
  id bigserial primary key,
  entry_id bigint not null references public.work_entries (id) on delete cascade,
  old_quantity numeric not null,
  new_quantity numeric not null,
  old_unit_price_kop bigint not null,
  new_unit_price_kop bigint not null,
  corrected_by bigint references public.employees (id),
  corrected_at timestamptz not null default now()
);
create index entry_corrections_entry_idx on public.entry_corrections (entry_id, corrected_at desc);
alter table public.entry_corrections enable row level security;
revoke all on public.entry_corrections from anon, authenticated;
revoke all on sequence public.entry_corrections_id_seq from anon, authenticated;

create function public.admin_correct_entry(p_entry bigint, p_quantity numeric, p_unit_price_kop bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  e work_entries%rowtype;
  m entry_money%rowtype;
begin
  perform public.require_manager();
  select * into e from work_entries where id = p_entry for update;
  if not found then raise exception 'Работа не найдена'; end if;
  if e.status = 'rejected' then raise exception 'Работа отклонена — исправлять нечего'; end if;
  select * into m from entry_money where entry_id = e.id for update;
  if not found then raise exception 'У работы ещё нет цены — оцените её в «На оценке»'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Объём должен быть больше нуля'; end if;
  if p_quantity > 100000 then raise exception 'Слишком большой объём'; end if;
  if p_unit_price_kop is null or p_unit_price_kop <= 0 then raise exception 'Цена должна быть больше нуля'; end if;
  if p_unit_price_kop > 100000000 then raise exception 'Слишком большая цена'; end if;
  if p_quantity = e.quantity and p_unit_price_kop = m.unit_price_kop then return; end if;

  -- объём проверяет триггер check_entry_quantity (целое для «шт»)
  if p_quantity <> e.quantity then
    update work_entries set quantity = p_quantity where id = e.id;
  end if;
  update entry_money
     set unit_price_kop = p_unit_price_kop,
         total_kop = greatest(round(p_quantity * p_unit_price_kop), 1)::bigint,
         price_source = case when p_unit_price_kop <> m.unit_price_kop then 'manual' else price_source end
   where entry_id = e.id;
  perform public.recompute_performer_money(e.id);
  insert into entry_corrections (entry_id, old_quantity, new_quantity, old_unit_price_kop, new_unit_price_kop, corrected_by)
  values (e.id, e.quantity, p_quantity, m.unit_price_kop, p_unit_price_kop, public.current_employee_id());
end $$;
revoke all on function public.admin_correct_entry(bigint, numeric, bigint) from public, anon;
grant execute on function public.admin_correct_entry(bigint, numeric, bigint) to authenticated;

-- request_money: + corrected_at (последнее исправление) — только добавление поля, старое приложение его не читает.
create or replace function public.request_money(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.require_manager();
  return (
    select jsonb_build_object(
      'works', coalesce(jsonb_agg(jsonb_build_object(
        'id', w.id, 'unit_price_kop', m.unit_price_kop, 'total_kop', m.total_kop,
        'corrected_at', (select max(c.corrected_at) from entry_corrections c where c.entry_id = w.id)) order by w.id), '[]'::jsonb),
      -- итог: работы с ценой, кроме отклонённых
      'total_kop', coalesce(sum(m.total_kop) filter (where w.status <> 'rejected'), 0),
      'unpriced', count(*) filter (where m.entry_id is null and w.status <> 'rejected'))
    from work_entries w
    left join entry_money m on m.entry_id = w.id
    where w.request_id = p_id);
end $$;
