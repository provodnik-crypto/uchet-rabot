-- Откат 20261031000001_replace_price_preview.
drop function if exists public.item_prices_for_entry(bigint, bigint[]);
