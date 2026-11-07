/**
 * Время выполнения заявок больше не учитываем (решение заказчика 22.10.2026): ввод, план и статистика убраны.
 * Старые данные — архив в базе (shift_requests.minutes, requests.plan_minutes). Остался только тип статуса
 * дня заявки в черновике смены (в базе — shift_requests.status, архив).
 */
export type RequestStatus = 'done' | 'unfinished';
