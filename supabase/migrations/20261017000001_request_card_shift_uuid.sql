-- Карточка заявки: у работ и времени — client_uuid смены (shift_uuid). Телефон по нему заменяет
-- уже отправленную сегодняшнюю смену своим черновиком (правка дня) и не теряет/не удваивает работы.
-- Откат: supabase/rollback/20261017000001_request_card_shift_uuid_down.sql
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.request_card(bigint, text)'::regprocedure);
  n := replace(d, $r$'work_date', s.work_date, 'minutes', x.minutes,$r$, $r$'work_date', s.work_date, 'shift_uuid', s.client_uuid, 'minutes', x.minutes,$r$);
  n := replace(n, $r$'name', coalesce(p.short_name, w.custom_name),$r$, $r$'shift_uuid', s.client_uuid, 'name', coalesce(p.short_name, w.custom_name),$r$);
  if n = d or (length(n) - length(d)) <> 2 * length($r$'shift_uuid', s.client_uuid, $r$) then
    raise exception 'request_card: не нашёл, что заменить';
  end if;
  execute n;
end $$;
notify pgrst, 'reload schema';
