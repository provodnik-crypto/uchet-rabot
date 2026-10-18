-- Откат 20261018000001_itsm_due_at.sql: убрать срок ITSM из функций и столбец requests.due_at.
begin;
do $$
declare
  d text; f text;
  pairs text[][] := array[
    array['public.open_requests(text, text, integer)', 'unread integer, due_at timestamp without time zone)', 'unread integer)'],
    array['public.open_requests(text, text, integer)', 'public.request_unread(r.id, me, false), r.due_at', 'public.request_unread(r.id, me, false)'],
    array['public.my_requests()', 'unread integer, due_at timestamp without time zone)', 'unread integer)'],
    array['public.my_requests()', 'public.request_unread(r.id, public.current_employee_id(), false), r.due_at', 'public.request_unread(r.id, public.current_employee_id(), false)'],
    array['public.list_requests(text, integer, text, text, smallint, bigint)', 'stale_days integer, due_at timestamp without time zone)', 'stale_days integer)'],
    array['public.list_requests(text, integer, text, text, smallint, bigint)', 'else 0 end, r.due_at', 'else 0 end'],
    array['public.request_card(bigint, text)', $r$'due_at', r.due_at, $r$, ''],
    array['public.request_import_apply(jsonb)', ', import_id, due_at)', ', import_id)'],
    array['public.request_import_apply(jsonb)', $r$, nullif(x ->> 'due_at', '')::timestamp$r$, ''],
    array['public.request_import_apply(jsonb)', E'  -- сроки уже загруженных заявок: [{number, due_at}]\n  if jsonb_typeof(p -> \'due_updates\') = \'array\' then\n    update requests r set due_at = (x ->> \'due_at\')::timestamp\n    from jsonb_array_elements(p -> \'due_updates\') x\n    where r.number = x ->> \'number\' and r.source = \'itsm\' and nullif(x ->> \'due_at\', \'\') is not null\n      and r.due_at is distinct from (x ->> \'due_at\')::timestamp;\n  end if;\n\n', '']
  ];
  defs jsonb := '{}';
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1];
    d := coalesce(defs ->> f, pg_get_functiondef(f::regprocedure));
    defs := defs || jsonb_build_object(f, replace(d, pairs[i][2], pairs[i][3]));
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
alter table public.requests drop column due_at;
notify pgrst, 'reload schema';
commit;
