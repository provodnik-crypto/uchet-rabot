-- Этап «Уведомления ботом Телемоста, часть 1» (23.11.2026). Личные сообщения Яндекс
-- Мессенджера о новых заявках: (а) заявка от инициатора — всем активным руководителям;
-- (б) импорт ITSM — сводка автору импорта. Ручные заявки руководителя не рассылаются.
-- Токен бота лежит в vault (имя messenger_bot_token), код и репозиторий его не содержат.
-- Адрес в мессенджере: логин сотрудника + домен организации (@lemanapro.ru).
-- Отправка асинхронная через pg_net; результат пишется в bot_log по request_id.
-- Откат: supabase/rollback/20261123000001_bot_notifications_down.sql.

-- ---------- Журнал отправок (виден только на сервере) ----------
create table public.bot_log (
  id bigserial primary key,
  sent_at timestamptz not null default now(),
  request_id bigint,
  target text not null,
  message text not null,
  important boolean not null default false,
  ok boolean,
  response text
);
create index bot_log_sent_at_idx on public.bot_log (sent_at desc);
alter table public.bot_log enable row level security;
revoke all on public.bot_log from anon, authenticated;

-- ---------- Отправка одного сообщения ----------
-- Возвращает id запроса pg_net (ответ придёт позже в net._http_response).
create function public.bot_send(p_login text, p_message text, p_important boolean default false)
returns bigint
language plpgsql security definer set search_path = public, net, vault as $$
declare
  v_token text;
  v_req bigint;
begin
  if coalesce(p_login, '') = '' or coalesce(p_message, '') = '' then return null; end if;
  select decrypted_secret into v_token
  from vault.decrypted_secrets
  where name = 'messenger_bot_token';
  if v_token is null then
    insert into bot_log (target, message, important, ok, response)
    values (p_login, p_message, p_important, false, 'нет токена в vault');
    return null;
  end if;
  select net.http_post(
    url => 'https://botapi.messenger.yandex.net/bot/v1/messages/sendText/',
    headers => jsonb_build_object(
      'Authorization', 'OAuth ' || v_token),
    body => jsonb_build_object(
      'login', p_login || '@lemanapro.ru',
      'text', left(p_message, 4000),
      'important', coalesce(p_important, false)),
    timeout_milliseconds => 15000
  ) into v_req;
  insert into bot_log (request_id, target, message, important)
  values (v_req, p_login, p_message, coalesce(p_important, false));
  return v_req;
end $$;
revoke all on function public.bot_send(text, text, boolean) from public, anon, authenticated;

-- ---------- Ответ API -> журнал ----------
create function public.bot_log_response()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update bot_log
  set ok = (new.status_code = 200),
      response = left(new.content, 500)
  where request_id = new.id;
  return null;
end $$;
revoke all on function public.bot_log_response() from public, anon, authenticated;

create trigger bot_http_response
after insert on net._http_response
for each row execute function public.bot_log_response();

-- ---------- Всем активным руководителям ----------
create function public.bot_notify_managers(p_message text, p_important boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select login from employees
    where role = 'manager' and is_active and coalesce(login, '') <> ''
  loop
    perform public.bot_send(r.login, p_message, p_important);
  end loop;
end $$;
revoke all on function public.bot_notify_managers(text, boolean) from public, anon, authenticated;

-- ---------- Заявка от инициатора -> руководителям ----------
create function public.bot_on_initiator_request()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_from text;
  v_msg text;
begin
  if new.source is distinct from 'initiator' then return new; end if;
  select e.display_name || ' (' || e.ldap_code || ')' into v_from
  from employees e where e.id = new.created_by;
  v_msg := 'LM сервис: новая заявка № ' || coalesce(new.number, new.id::text) || E'\n'
    || coalesce(nullif(trim(new.subject), ''), coalesce(new.operation, '')) ||
    (case when coalesce(new.operation, '') <> '' then E'\nКатегория: ' || new.operation else '' end) ||
    (case when coalesce(new.place, '') <> '' then E'\nКабинет: ' || new.place else '' end) ||
    (case when coalesce(v_from, '') <> '' then E'\nОт: ' || v_from else '' end) ||
    (case when new.priority = 1 then E'\nСрочно' else '' end);
  perform public.bot_notify_managers(v_msg, new.priority = 1);
  return new;
end $$;
revoke all on function public.bot_on_initiator_request() from public, anon, authenticated;

create trigger bot_initiator_request
after insert on public.requests
for each row execute function public.bot_on_initiator_request();

-- ---------- Импорт ITSM -> сводка автору импорта ----------
create function public.bot_on_import()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_login text;
  v_urgent int;
begin
  if new.new_rows is null or new.new_rows <= 0 or new.new_rows is not distinct from old.new_rows then
    return new;
  end if;
  select login into v_login from employees where id = new.created_by;
  if coalesce(v_login, '') = '' then return new; end if;
  select count(*) into v_urgent from requests where import_id = new.id and priority = 1;
  perform public.bot_send(
    v_login,
    'LM сервис: загружено ' || new.new_rows || ' заявок' ||
      (case when v_urgent > 0 then ', из них ' || v_urgent || ' срочных' else '' end)
  );
  return new;
end $$;
revoke all on function public.bot_on_import() from public, anon, authenticated;

create trigger bot_import
after update of new_rows on public.request_imports
for each row when (old.new_rows is distinct from new.new_rows)
execute function public.bot_on_import();
