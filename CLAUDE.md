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
  18.10.2026 по просьбе заказчика удалены все заявки и всё, что внесено в приложении 11–17.10.2026; история из старого
  файла (01.08–09.10.2026) оставлена. Копия удалённого — схема `backup_20261018` в базе (закрыта для приложения).
* Мастер не видит цены и суммы отдельных работ; видит только итоги: свою сумму за месяц и рейтинг команды.
* После каждой части: опубликовать сборку или обновление, объяснить, как получить на телефон,
  дать чек-лист для мастера и руководителя, обновить инструкцию мастера (`docs/instrukciya-mastera.*`).
* Работать в ветке, которую назначила сессия; без запроса не создавать PR.
* Доработки идут по одной: перед этапом изучить код и базу, показать короткий план и задать вопросы;
  работающее не переписывать. После этапа — сборка/обновление, как получить на телефон, списки проверки
  отдельно для мастера и руководителя, и ждать «дальше». Следующий этап без сообщения заказчика не начинать.
* Интерфейс на русском, удобно одной рукой; существующие экраны меняются только в части, о которой этап.
* Заявки из ITSM руководитель загружает файлом (решение заказчика 13.10.2026; с 18.10.2026 шаблон `case_*.xlsx`:
  Тема, Состояние, Ответственный, Время разрешения → срок `due_at`, «Просрочена» красным; старый шаблон тоже читается). Свои заявки мастер и руководитель создают
  «+ Новая заявка» с номерами 1, 2, 3… (общая нумерация, `create_manual_request`, показ «№ 12»); ручной ввод RFS/INC — запасной.
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
cd app && npm run test:itsm                      # разбор и обезличивание выгрузки ITSM
cd app && npm run test:errors                    # распознавание ошибок и очистка текста для журнала
cd app && npm run test:rollover                  # перенос нового из отправленной смены в смену за сегодня
cd app && set -a && . ./.env && set +a
npx eas-cli@latest update --branch preview --environment preview --message "…" --platform android --non-interactive
npx eas-cli@latest build --platform android --profile preview --non-interactive --no-wait   # новый APK
npx supabase functions deploy <имя> --use-api --project-ref $SUPABASE_PROJECT_REF
```
* Миграции — новые файлы в `supabase/migrations/`, применяются вручную через Management API.
  **Сначала добавить, потом убрать:** миграция только добавляет (новые столбцы, функции, новые версии функций
  рядом со старыми); старое удаляется отдельной миграцией после того, как обновление приложения разошлось.
  Порядок: миграция «добавить» → обновление приложения → через день миграция «убрать». Так работающее
  приложение не ломается в момент изменения базы.
* Загрузка данных экранов — `useFocusQuery` (`lib/useQuery.ts`): ключ `key` с параметрами, последние данные
  в памяти и на телефоне, автоповтор при обрыве; `<Screen status={…}>` даёт свайп вниз, плашку ошибки
  с «Повторить» и «Обновлено в …». Запросы ждут ответа не дольше 20 с (`fetchWithTimeout` в `lib/supabase.ts`).
* Журнал ошибок устройств — таблица `app_errors` (пишет `log_app_errors`, читать через Management API):
  `select happened_at at time zone 'Asia/Yekaterinburg', screen, kind, message, app_version, role, device from app_errors order by id desc limit 50`.
  Логи Supabase: `GET /v1/projects/$SUPABASE_PROJECT_REF/analytics/endpoints/logs?sql=…&iso_timestamp_start=…`
  (одна таблица `logs`, поле `source`: edge_logs, postgres_logs, auth_logs, function_logs).
* Новый нативный модуль → поднять `runtimeVersion` в `app/app.json` (сейчас `3`) и собрать APK,
  иначе обновление «по воздуху» уронит старые установки. После сборки обновить строку `app_release`
  (версия среды и ссылка на APK) — по ней старые телефоны видят полосу «Вышла новая сборка».
* Жизненный цикл заявки: `requests.status` (waiting/in_work/review/accepted/contractor), `responsible_id`, `priority`,
  `request_members`, `request_events`. Работы по заявке — статус `awaiting` до «Принята» (в суммы не идут).
  Ключевые функции: `take_request`, `send_request_for_review`, `accept_request`, `return_request`; `submit_shift` —
  обёртка над `submit_shift_core` с проверкой, чья заявка.
* Переписка и уведомления (только внутри приложения): `add_request_comment`, `mark_request_read`, `my_notifications`;
  непрочитанное — `request_unread` по `request_reads`. Пуш-уведомлений нет.
* Время по заявкам: таблица `shift_requests` (минуты за смену; статус «Не закончено» больше не используется), `requests.plan_minutes/state`;
  длина смены — `public.shift_minutes()` = 480 и `SHIFT_MINUTES` в `app/src/lib/requestTime.ts`.
* «Магазин» — не отдел для мастера, а «весь магазин» в фильтрах (`isWholeStore` в `lib/departments.ts`).
* Обучение: тексты шагов и «Что нового» — `app/src/lib/tours.ts`; элементы помечаются `<TourTarget id=…>` (`lib/tour.tsx`).
  После каждого обновления добавить запись в начало `WHATS_NEW` (тексты пишет Claude, заказчик проверяет).
