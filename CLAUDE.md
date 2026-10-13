# «Учёт работ» — заметки для Claude

Приложение для Android (Expo + Supabase). Заказчик общается по-русски, объяснять просто, по шагам.
Подробности: `docs/GUIDE.md` (сопровождение), `docs/RUN.md` (этапы и проверки), `docs/PLAN.md` (схема базы).

## Правила заказчика
* **Никаких персональных данных** (серверы за рубежом): у сотрудника только имя и первая буква фамилии
  («Иван П.»), вместо фото — значок инструмента 1–12 (`app/src/lib/toolIcons.ts`). Не хранить ФИО,
  телефоны, почты, табельные номера, фото людей — ни в базе, ни в коде, ни в тестах, ни в коммитах.
  Исключение (решение заказчика): заявитель заявки из ITSM хранится как «Имя Ф. (ldap)»
  (`requests.requester`), мастеру показывается только «Имя Ф.» через `open_requests`.
* Заявки из ITSM: руководитель загружает .xlsx, файл разбирается и обезличивается **на телефоне**
  (`app/src/lib/itsm.ts`), в базу — только очищенные строки (`request_import_apply`). Исходный файл
  не сохранять нигде; реальную выгрузку в репозиторий не класть. Окно дат — по `work_calendar`
  (праздники РФ 2026–2027; на 2028 год дописать после постановления о переносах).
  Ручные заявки, введённые мастерами в октябре 2026, — тестовые, их не трогать.
* Мастер не видит цены и суммы отдельных работ; видит только итоги: свою сумму за месяц и рейтинг команды.
* После каждой части: опубликовать сборку или обновление, объяснить, как получить на телефон,
  дать чек-лист для мастера и руководителя, обновить инструкцию мастера (`docs/instrukciya-mastera.*`).
* Работать в ветке, которую назначила сессия; без запроса не создавать PR.

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
cd app && npm run test:itsm                      # разбор и обезличивание выгрузки ITSM
cd app && set -a && . ./.env && set +a
npx eas-cli@latest update --branch preview --environment preview --message "…" --platform android --non-interactive
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait   # новый APK
npx supabase functions deploy <имя> --use-api --project-ref $SUPABASE_PROJECT_REF
```
* Миграции — новые файлы в `supabase/migrations/`, применяются вручную через Management API.
* Новый нативный модуль → поднять `runtimeVersion` в `app/app.json` (сейчас `3`) и собрать APK,
  иначе обновление «по воздуху» уронит старые установки.
