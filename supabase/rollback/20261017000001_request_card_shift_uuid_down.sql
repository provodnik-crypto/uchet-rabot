-- Откат 20261017000001_request_card_shift_uuid.sql: убрать shift_uuid из карточки заявки.
begin;
do $$
declare d text;
begin
  d := pg_get_functiondef('public.request_card(bigint, text)'::regprocedure);
  execute replace(d, $r$'shift_uuid', s.client_uuid, $r$, '');
end $$;
notify pgrst, 'reload schema';
commit;
