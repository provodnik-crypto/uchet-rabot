# «Учёт работ» — заметки для Claude

Приложение для Android (Expo + Supabase). Заказчик общается по-русски, объяснять просто, по шагам.
Подробности: `docs/GUIDE.md` (сопровождение), `docs/RUN.md` (этапы и проверки), `docs/PLAN.md` (схема базы).

## Правила заказчика
* **Никаких персональных данных** (серверы за рубежом): у сотрудника только имя и первая буква фамилии
  («Иван П.»), вместо фото — значок инструмента 1–12 (`app/src/lib/toolIcons.ts`). Не хранить ФИО,
  телефоны, почты, табельные номера, фото людей — ни в базе, ни в коде, ни в тестах, ни в коммитах.
* Мастер не видит цены и суммы отдельных работ; видит только итоги: свою сумму за месяц и рейтинг команды.
* После каждой части: опубликовать сборку или обновление, объяснить, как получить на телефон,
  дать чек-лист для мастера и руководителя, обновить инструкцию мастера (`docs/instrukciya-mastera.*`).
* Работать в ветке, которую назначила сессия; без запроса не создавать PR.
* Доработки идут по одной: перед этапом изучить код и базу, показать короткий план и задать вопросы;
  работающее не переписывать. После этапа — сборка/обновление, как получить на телефон, списки проверки
  отдельно для мастера и руководителя, и ждать «дальше». Следующий этап без сообщения заказчика не начинать.
* Интерфейс на русском, удобно одной рукой; существующие экраны меняются только в части, о которой этап.
* Автоматическую подгрузку заявок из ITSM не делаем — номер заявки мастер вводит сам.
* Если заказчику нужно что-то сделать самому (настройки, ключи, внешние сервисы) — сказать заранее, по пунктам.
* Перед этапом — резервная копия: номер коммита-точки отката, выгрузка данных базы в закрытую папку
  хранилища `backups` (JSON всех таблиц `public`), скрипт отката миграции в `supabase/rollback/`.

## Доступы
Токены лежат в переменных окружения облачной среды: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`,
`SUPABASE_DB_PASSWORD`, `EXPO_TOKEN`. Файла `app/.env` в репозитории нет — создать его:
```bash
curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/api-keys"   # anon и service_role
# app/.env: EXPO_PUBLIC_SUPABASE_URL=https://$SUPABASE_PROJECT_REF.supabase.co и EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon>
```
SQL на рабочей базе — только через Management API (`POST /v1/projects/$SUPABASE_PROJECT_REF/database/query`),
прямой порт Postgres закрыт.

## Команды
```bash
bash supabase/tests/run.sh                       # тесты базы (локальный PostgreSQL)
cd app && npx tsc --noEmit                       # проверка типов
cd app && set -a && . ./.env && set +a
npx eas-cli@latest update --branch preview --environment preview --message "…" --platform android --non-interactive
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait   # новый APK
npx supabase functions deploy <имя> --use-api --project-ref $SUPABASE_PROJECT_REF
```
* Миграции — новые файлы в `supabase/migrations/`, применяются вручную через Management API.
* Новый нативный модуль → поднять `runtimeVersion` в `app/app.json` (сейчас `2`) и собрать APK,
  иначе обновление «по воздуху» уронит старые установки. После сборки обновить строку `app_release`
  (версия среды и ссылка на APK) — по ней старые телефоны видят полосу «Вышла новая сборка».
* Время по заявкам: таблица `shift_requests` (минуты и статус за смену), `requests.plan_minutes/state`;
  длина смены — `public.shift_minutes()` = 480 и `SHIFT_MINUTES` в `app/src/lib/requestTime.ts`.
* «Магазин» — не отдел для мастера, а «весь магазин» в фильтрах (`isWholeStore` в `lib/departments.ts`).
