-- Откат 20261016000001_manual_requests.sql. Ручные заявки с простыми номерами должны быть удалены заранее
-- (или их работы перенесены), иначе проверка номера не встанет обратно.
begin;
do $$
declare d text; n text; f text;
  pairs text[][] := array[
    array['public.submit_shift_core(jsonb)', 'not public.valid_request_number(v_req_num)', $r$v_req_num !~ '^(RFS|INC)\d{6}_\d{4}$'$r$],
    array['public.submit_shift(jsonb)', 'not public.valid_request_number(v_num)', $r$v_num !~ '^(RFS|INC)\d{6}_\d{4}$'$r$],
    array['public.save_shift_requests(bigint, jsonb)', 'not public.valid_request_number(v_num)', $r$v_num !~ '^(RFS|INC)\d{6}_\d{4}$'$r$],
    array['public.open_requests(text, text, integer)', '(r.store_id = v_store or r.responsible_id = me)', $r$(r.source = 'itsm' and r.store_id = v_store or r.responsible_id = me)$r$],
    array['public.my_requests_badge(timestamptz)', 'where r.is_open', $r$where r.source = 'itsm' and r.is_open$r$]];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    f := pairs[i][1]; d := pg_get_functiondef(f::regprocedure); n := replace(d, pairs[i][2], pairs[i][3]); execute n;
  end loop;
end $$;
drop function public.create_manual_request(text, text, bigint);
drop function public.valid_request_number(text);
drop sequence public.manual_request_seq;
alter table public.requests drop constraint requests_number_check;
alter table public.requests add constraint requests_number_check check (number ~ '^(RFS|INC)\d{6}_\d{4}$');
notify pgrst, 'reload schema';
commit;
