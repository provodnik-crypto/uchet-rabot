-- Ручные заявки с простыми номерами 1, 2, 3… — общая нумерация для мастеров и руководителя.
-- * номер выдаёт сервер по порядку (последовательность), без повторов и при одновременном создании;
-- * мастер создаёт — заявка сразу «В работе» у него; руководитель — «Ожидает», можно сразу назначить;
-- * номера ITSM (RFS/INC) работают как раньше.
-- Откат: supabase/rollback/20261016000001_manual_requests_down.sql

alter table public.requests drop constraint requests_number_check;
alter table public.requests add constraint requests_number_check
  check (number ~ '^(RFS|INC)\d{6}_\d{4}$' or number ~ '^[1-9]\d{0,6}$');

create sequence public.manual_request_seq start 1;

-- Номер в работах смены: формат ITSM или простой номер уже созданной заявки.
create function public.valid_request_number(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select p ~ '^(RFS|INC)\d{6}_\d{4}$' or (p ~ '^[1-9]\d{0,6}$' and exists (select 1 from requests where number = p))
$$;

alter table public.request_events drop constraint request_events_kind_check;
alter table public.request_events add constraint request_events_kind_check
  check (kind in ('take', 'refuse', 'send', 'accept', 'return', 'priority', 'assign',
                  'responsible', 'contractor', 'plan', 'migrate', 'comment', 'create'));

-- Создать ручную заявку. p_title — что сделать (обязательно), p_details — где, подробности.
create function public.create_manual_request(p_title text, p_details text default null, p_assignee bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me bigint := public.current_employee_id();
  v_manager boolean := public.is_manager();
  v_store smallint;
  v_id bigint;
  v_number text;
begin
  if me is null then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if length(trim(coalesce(p_title, ''))) < 3 then raise exception 'Напишите, что нужно сделать'; end if;
  if length(trim(p_title)) > 200 then raise exception 'Слишком длинно: до 200 знаков, подробности — ниже'; end if;
  if p_assignee is not null and (not v_manager or not exists (
    select 1 from employees where id = p_assignee and is_active and role = 'master')) then
    raise exception 'Назначить может только руководитель — и только мастеру';
  end if;
  select coalesce(e.store_id, public.default_store_id()) into v_store from employees e where e.id = me;
  v_number := nextval('public.manual_request_seq')::text;
  insert into requests (number, source, store_id, operation, subject, description, registered_at, created_by,
                        status, responsible_id, taken_at, assignee_id, last_activity_at)
  values (v_number, 'manual', v_store, trim(p_title), trim(p_title), nullif(trim(coalesce(p_details, '')), ''),
          (now() at time zone public.app_timezone()), me,
          case when v_manager then 'waiting' else 'in_work' end,
          case when v_manager then null else me end,
          case when v_manager then null else now() end,
          p_assignee, now())
  returning id into v_id;
  insert into request_events (request_id, kind, author_id, to_status, comment)
  values (v_id, 'create', me, case when v_manager then 'waiting' else 'in_work' end, 'Заявка № ' || v_number);
  if not v_manager then
    insert into request_events (request_id, kind, author_id, from_status, to_status) values (v_id, 'take', me, 'waiting', 'in_work');
  elsif p_assignee is not null then
    insert into request_events (request_id, kind, author_id, comment)
    values (v_id, 'assign', me, 'Назначена: ' || (select display_name from employees where id = p_assignee));
  end if;
  return jsonb_build_object('id', v_id, 'number', v_number);
end $$;

-- Правки существующих функций: простые номера в сменах и ручные заявки магазина в списках мастера.
do $$
declare
  d text;
  n text;
  f text;
  pairs text[][] := array[
    array['public.submit_shift_core(jsonb)', $r$v_req_num !~ '^(RFS|INC)\d{6}_\d{4}$'$r$, 'not public.valid_request_number(v_req_num)'],
    array['public.submit_shift(jsonb)', $r$v_num !~ '^(RFS|INC)\d{6}_\d{4}$'$r$, 'not public.valid_request_number(v_num)'],
    array['public.save_shift_requests(bigint, jsonb)', $r$v_num !~ '^(RFS|INC)\d{6}_\d{4}$'$r$, 'not public.valid_request_number(v_num)'],
    array['public.open_requests(text, text, integer)', $r$(r.source = 'itsm' and r.store_id = v_store or r.responsible_id = me)$r$, '(r.store_id = v_store or r.responsible_id = me)'],
    array['public.my_requests_badge(timestamptz)', $r$where r.source = 'itsm' and r.is_open$r$, 'where r.is_open']
  ];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := pg_get_functiondef(f::regprocedure);
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл, что заменить в %', f; end if;
    execute n;
  end loop;
end $$;

revoke all on function public.create_manual_request(text, text, bigint) from public, anon;
grant execute on function public.create_manual_request(text, text, bigint) to authenticated;
revoke all on function public.valid_request_number(text) from public, anon;
grant execute on function public.valid_request_number(text) to authenticated;
