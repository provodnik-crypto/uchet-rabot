-- Этап «Инициаторы» (21.11.2026), шаг 1: новая роль employee_role 'initiator' (заявки из магазина, минуя ITSM).
-- Отдельная миграция: ALTER TYPE ADD VALUE нельзя применять и использовать новое значение в одной транзакции.
-- Схема, функции и права — 20261121000002_initiators.sql.
-- Откат: значение enum удалить нельзя (Postgres не умеет) —
-- supabase/rollback/20261121000002_initiators_down.sql снимает всё остальное; роль остаётся, но без функций.
alter type public.employee_role add value 'initiator';
