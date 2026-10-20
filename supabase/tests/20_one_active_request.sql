-- Одна заявка в работе у мастера: защита в базе, очередь, возвращённые, срочные, приостановка.
create or replace function pg_temp.rid(p_title text) returns bigint language sql as $$
  select id from public.requests where operation = p_title order by id desc limit 1 $$;
create or replace function pg_temp.st(p_title text) returns text language sql as $$
  select status || coalesce('/' || hold_reason, '') from public.requests where operation = p_title order by id desc limit 1 $$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;
-- время по заявке за смену (без него нельзя отправить на проверку)
create or replace function pg_temp.time_for(p_title text) returns void language sql as $$
  select public.submit_shift(jsonb_build_object('client_uuid', gen_random_uuid(), 'work_date', public.app_today(), 'entries', '[]'::jsonb,
    'requests', jsonb_build_array(jsonb_build_object('request_number', (select number from public.requests where id = pg_temp.rid(p_title)), 'minutes', 30)))) $$;

begin;
select pg_temp.login_as('boss');
select public.create_manual_request('Заявка А'), public.create_manual_request('Заявка Б'), public.create_manual_request('Заявка В'),
       public.create_manual_request('Заявка Г'), public.create_manual_request('Заявка Д');
grant execute on all functions in schema pg_temp to authenticated;
reset role;

-- 1. взял А — вторую не взять ни кнопкой, ни работами в смене
select pg_temp.login_as('kolya');
select public.take_request(pg_temp.rid('Заявка А'), 60);
select pg_temp.assert(pg_temp.err(format('select public.take_request(%s, 60)', pg_temp.rid('Заявка Б'))) like 'У вас уже есть заявка в работе: № %',
  'вторую заявку взять нельзя: «У вас уже есть заявка в работе: № …»');
select pg_temp.assert(pg_temp.err($q$select pg_temp.time_for('Заявка Б')$q$) like 'У вас уже есть заявка в работе%',
  'работы/время по свободной заявке в смене тоже не берут её');
select pg_temp.assert(pg_temp.st('Заявка Б') = 'waiting', 'Б осталась свободной');
-- своя новая заявка занятого мастера — «Ожидает», назначена на него
select pg_temp.assert((public.create_manual_request('Своя заявка') ->> 'queued')::boolean, 'своя заявка встала в очередь');
select pg_temp.assert(pg_temp.st('Своя заявка') = 'waiting'
  and (select assignee_id from public.requests where id = pg_temp.rid('Своя заявка')) = public.current_employee_id(), 'своя: ожидает, назначена мне');
select pg_temp.assert((select request_card(pg_temp.rid('Заявка Б')) -> 'my_active' ->> 'id')::bigint = pg_temp.rid('Заявка А'), 'карточка знает мою активную');

-- 2. «Приостановить» — только запрос, мастер не освобождается
select public.request_pause(pg_temp.rid('Заявка А'), 'Ждём материалы');
select pg_temp.assert(pg_temp.st('Заявка А') = 'in_work', 'после запроса на приостановку А всё ещё в работе');
select pg_temp.assert(pg_temp.err(format('select public.take_request(%s, 60)', pg_temp.rid('Заявка Б'))) like 'У вас уже есть%', 'запросом правило не обойти');
select pg_temp.assert(pg_temp.err(format('select public.decide_pause(%s, true)', pg_temp.rid('Заявка А'))) is not null, 'мастер сам не подтверждает');

-- 3. отправил на проверку — сразу свободен
select pg_temp.time_for('Заявка А');
select public.send_request_for_review(pg_temp.rid('Заявка А'));
select pg_temp.assert((select pause_request from public.requests where id = pg_temp.rid('Заявка А')) is null, 'запрос снят отправкой');
select public.take_request(pg_temp.rid('Заявка Б'), 60);
select pg_temp.assert(pg_temp.st('Заявка Б') = 'in_work', 'после отправки А взял Б');
reset role;

-- 4. вернули А, пока мастер занят Б — А первая в очереди, уведомление
select pg_temp.login_as('boss');
select pg_temp.assert((select pause_requests from (select (public.my_notifications() ->> 'pause_requests')::int pause_requests) x) = 0, 'запросов на приостановку нет');
select public.return_request(pg_temp.rid('Заявка А'), 'Доделать');
select pg_temp.assert(pg_temp.st('Заявка А') = 'paused/returned', 'возвращённая А в очереди');
reset role;
select pg_temp.login_as('kolya');
select pg_temp.assert((public.my_notifications() -> 'returned' -> 0 ->> 'queued')::boolean, 'мастеру: вернули, в очереди');
select pg_temp.assert((select number from public.my_requests() limit 1) = (select number from public.requests where id = pg_temp.rid('Заявка Б')),
  'в «Мои заявки» сверху — активная');
select pg_temp.time_for('Заявка Б');
select public.send_request_for_review(pg_temp.rid('Заявка Б'));
select pg_temp.assert(pg_temp.st('Заявка А') = 'in_work', 'после отправки Б возвращённая А сама в работе');
reset role;

-- 5. срочная приостанавливает текущую; после отправки срочной текущая возвращается
select pg_temp.login_as('boss');
select pg_temp.assert(pg_temp.err(format('select public.set_request_responsible(%s, %s)', pg_temp.rid('Заявка Г'),
  (select id from public.employees where login = 'kolya'))) like 'У мастера уже есть заявка в работе%', 'обычную занятому не назначить');
select public.set_request_priority(pg_temp.rid('Заявка В'), 1::smallint);
select public.set_request_responsible(pg_temp.rid('Заявка В'), (select id from public.employees where login = 'kolya'));
select pg_temp.assert(pg_temp.st('Заявка В') = 'in_work' and pg_temp.st('Заявка А') = 'paused/urgent', 'срочная В в работе, А приостановлена');
select pg_temp.assert((select hold_for from public.requests where id = pg_temp.rid('Заявка А')) = pg_temp.rid('Заявка В'), 'отметка «из-за срочной В»');
select pg_temp.assert((select count(*) from public.masters_now() where request_id = pg_temp.rid('Заявка В') and paused = 1) = 1, 'руководитель видит: в работе В, 1 отложена');
reset role;
select pg_temp.login_as('kolya');
select pg_temp.time_for('Заявка В');
select public.send_request_for_review(pg_temp.rid('Заявка В'));
select pg_temp.assert(pg_temp.st('Заявка А') = 'in_work', 'после срочной А снова в работе');

-- 6. приостановка с подтверждением: отклонить — остаётся; подтвердить — свободен; продолжить — когда свободен
select public.request_pause(pg_temp.rid('Заявка А'), 'Нет доступа в помещение');
reset role;
select pg_temp.login_as('boss');
select pg_temp.assert((public.my_notifications() ->> 'pause_requests')::int = 1, 'руководителю: 1 запрос на приостановку');
select pg_temp.assert((select count(*) from public.list_requests('', 100, 'all', 'pause_request')) = 1, 'фильтр «Запросы на приостановку»');
select public.decide_pause(pg_temp.rid('Заявка А'), false, 'Доступ дадут сегодня');
select pg_temp.assert(pg_temp.st('Заявка А') = 'in_work', 'отклонено — А в работе');
reset role;
select pg_temp.login_as('kolya');
select public.request_pause(pg_temp.rid('Заявка А'), 'Нет доступа в помещение');
reset role;
select pg_temp.login_as('boss');
select public.decide_pause(pg_temp.rid('Заявка А'), true);
select pg_temp.assert(pg_temp.st('Заявка А') = 'paused/pause', 'подтверждено — А приостановлена');
reset role;
select pg_temp.login_as('kolya');
select public.take_request(pg_temp.rid('Заявка Г'), 60);
select pg_temp.assert(pg_temp.err(format('select public.resume_request(%s)', pg_temp.rid('Заявка А'))) like 'У вас уже есть%', 'продолжить приостановленную, пока занят, нельзя');
select public.refuse_request(pg_temp.rid('Заявка Г'), 'Не мой профиль');
select pg_temp.assert(pg_temp.st('Заявка А') = 'paused/pause', 'подтверждённая приостановка сама не возвращается');
select public.resume_request(pg_temp.rid('Заявка А'));
select pg_temp.assert(pg_temp.st('Заявка А') = 'in_work', 'свободен — продолжил А');
reset role;

-- 7. напарник в чужой заявке может взять свою
select pg_temp.login_as('misha');
select public.take_request(pg_temp.rid('Заявка Д'), 60, array[(select id from public.employees where login = 'kolya')]);
reset role;
select pg_temp.assert(exists (select 1 from public.request_members m join public.employees e on e.id = m.employee_id
  where e.login = 'kolya' and m.request_id = pg_temp.rid('Заявка Д')), 'Николай — напарник в Д');
select pg_temp.assert(pg_temp.st('Заявка А') = 'in_work', 'а его А по-прежнему в работе');

-- 8. снять заявку с мастера / закрыть — освобождает; база не даёт вторую даже напрямую
select pg_temp.assert(pg_temp.err(format($q$update public.requests set status = 'in_work', responsible_id = %s, taken_at = now() where id = %s$q$,
  (select id from public.employees where login = 'kolya'), pg_temp.rid('Заявка Г'))) like '%requests_one_active_uq%', 'уникальный индекс: вторую «В работе» не записать');
select pg_temp.login_as('boss');
select public.set_request_open(pg_temp.rid('Заявка А'), false);
select pg_temp.assert((select count(*) from public.masters_now() m join public.employees e on e.id = m.employee_id
  where e.login = 'kolya' and m.request_id is null) = 1, 'закрыл А — Николай свободен');
reset role;
rollback;
