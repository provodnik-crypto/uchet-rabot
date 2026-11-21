-- Откат 20261014000001_request_card.sql: вернуть прежние названия позиций прайса, убрать карточку и счётчики.
begin;
update public.price_items p set short_name = r.old_name
from public.price_item_renames r where r.price_item_id = p.id and p.short_name = r.new_name;
drop table public.price_item_renames;
drop function if exists public.request_card(bigint, text);
drop function if exists public.my_requests_badge(timestamptz);
notify pgrst, 'reload schema';
commit;
