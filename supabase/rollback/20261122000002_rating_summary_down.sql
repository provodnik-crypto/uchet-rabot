-- Откат этапа «NPS-сводка» (22.11.2026). Данные не трогаются — сводка вычисляется на лету.

drop function if exists public.manager_rating_summary();
