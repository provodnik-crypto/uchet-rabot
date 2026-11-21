-- Новый шаблон выгрузки ITSM (case_*.xlsx): срок выполнения «Время разрешения» → requests.due_at
-- (местное время, как registered_at). «Просрочена» считается на лету: due_at раньше текущего времени магазина.
-- У уже загруженных заявок обновляется только срок (p.due_updates); остальное не меняется.
-- Срок отдают: open_requests, my_requests, list_requests, request_card.
-- Откат: supabase/rollback/20261018000001_itsm_due_at_down.sql
alter table public.requests add column due_at timestamp;
grant select (due_at) on public.requests to authenticated;

do $$
declare
  d text; n text; f text; sig text;
  -- функция, «было», «стало»; table = меняется состав столбцов (нужно пересоздать)
  pairs text[][] := array[
    array['public.open_requests(text, text, integer)', 'unread integer)', 'unread integer, due_at timestamp without time zone)'],
    array['public.open_requests(text, text, integer)', E'public.request_unread(r.id, me, false)\n    from requests r', E'public.request_unread(r.id, me, false), r.due_at\n    from requests r'],
    array['public.my_requests()', 'unread integer)', 'unread integer, due_at timestamp without time zone)'],
    array['public.my_requests()', E'public.request_unread(r.id, public.current_employee_id(), false)\n  from requests r', E'public.request_unread(r.id, public.current_employee_id(), false), r.due_at\n  from requests r'],
    array['public.list_requests(text, integer, text, text, smallint, bigint)', 'stale_days integer)', 'stale_days integer, due_at timestamp without time zone)'],
    array['public.list_requests(text, integer, text, text, smallint, bigint)', E'else 0 end\n    from requests r', E'else 0 end, r.due_at\n    from requests r'],
    array['public.request_card(bigint, text)', $r$'registered_at', r.registered_at,$r$, $r$'registered_at', r.registered_at, 'due_at', r.due_at,$r$],
    array['public.request_import_apply(jsonb)', 'registered_at, requester, created_by, import_id)', 'registered_at, requester, created_by, import_id, due_at)'],
    array['public.request_import_apply(jsonb)', $r$nullif(trim(x ->> 'requester'), ''), me, v_import$r$, $r$nullif(trim(x ->> 'requester'), ''), me, v_import, nullif(x ->> 'due_at', '')::timestamp$r$],
    array['public.request_import_apply(jsonb)', E'  if jsonb_typeof(p -> \'close_ids\') = \'array\' then',
          E'  -- сроки уже загруженных заявок: [{number, due_at}]\n  if jsonb_typeof(p -> \'due_updates\') = \'array\' then\n    update requests r set due_at = (x ->> \'due_at\')::timestamp\n    from jsonb_array_elements(p -> \'due_updates\') x\n    where r.number = x ->> \'number\' and r.source = \'itsm\' and nullif(x ->> \'due_at\', \'\') is not null\n      and r.due_at is distinct from (x ->> \'due_at\')::timestamp;\n  end if;\n\n  if jsonb_typeof(p -> \'close_ids\') = \'array\' then']
  ];
  i int;
  defs jsonb := '{}';
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := coalesce(defs ->> f, pg_get_functiondef(f::regprocedure));
    n := replace(d, pairs[i][2], pairs[i][3]);
    if n = d then raise exception 'Не нашёл «%» в %', pairs[i][2], f; end if;
    defs := defs || jsonb_build_object(f, n);
  end loop;
  for f in select jsonb_object_keys(defs) loop
    if f in ('public.open_requests(text, text, integer)', 'public.my_requests()', 'public.list_requests(text, integer, text, text, smallint, bigint)') then
      execute 'drop function ' || f;
      execute defs ->> f;
      execute format('revoke all on function %s from public, anon', f);
      execute format('grant execute on function %s to authenticated', f);
    else
      execute defs ->> f;
    end if;
  end loop;
end $$;
notify pgrst, 'reload schema';
