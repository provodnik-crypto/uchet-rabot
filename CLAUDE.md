# «Учёт работ» — заметки для Claude

Приложение для Android (Expo + Supabase). Заказчик общается по-русски, объяснять просто, по шагам.
Подробности: `docs/GUIDE.md` (сопровождение), `docs/RUN.md` (этапы и проверки), `docs/PLAN.md` (схема базы).

## Правила заказчика
* **Никаких персональных данных** (серверы за рубежом): у сотрудника только имя и первая буква фамилии
  («Иван П.»), вместо фото — значок инструмента 1–12 (`app/src/lib/toolIcons.ts`). Не хранить ФИО,
  телефоны, почты, табельные номера, фото людей — ни в базе, ни в коде, ни в тестах, ни в коммитах.
  Исключение (решение заказчика): заявитель заявки из ITSM хранится как «Имя Ф. (ldap)»
  (`requests.requester`), мастеру показывается только «Имя Ф.» через `open_requests`.
  Исключение (24.10.2026): **рабочий телефон 031xxx** (6 цифр) не удаляется (`WORK_PHONE`/`workPhones` в `itsm.ts`),
  хранится в `requests.contact_phone` («031899, 031900») и в тексте; остальные телефоны и почты удаляются как раньше.
* **Фото из файла ITSM** (24.10.2026): столбец «Фото» (картинки поверх ячеек или «в ячейке» Excel 365) → `readXlsxImages`
  → сжатие на телефоне (`photoFromBytes`) → `extra_photos.owner_kind = 'request'` через `attach_request_photos` (только если
  у заявки фото ещё нет). Руководитель видит все фото до загрузки и убирает ✕ (на фото не должно быть людей). Мастеру —
  `request_extras` (телефон + фото) → `components/RequestExtras.tsx`, 📷 в списке — `request_photo_ids`. Без столбца — как раньше.
* Заявки из ITSM: руководитель загружает .xlsx, файл разбирается и обезличивается **на телефоне**
  (`app/src/lib/itsm.ts`), в базу — только очищенные строки (`request_import_apply`). Исходный файл
  не сохранять нигде; реальную выгрузку в репозиторий не класть. Окно дат — по `work_calendar`
  (праздники РФ 2026–2027; на 2028 год дописать после постановления о переносах).
  18.10.2026 по просьбе заказчика удалены все заявки и всё, что внесено в приложении 11–17.10.2026; история из старого
  файла (01.08–09.10.2026) оставлена. Копия удалённого — схема `backup_20261018` в базе (закрыта для приложения).
* **Мастер не видит денег по людям** (30.10.2026): ни цен, ни сумм работ, ни своей суммы, ни рейтинга и выработки коллег —
  только итог всей команды магазина за месяц (`team_result`: сумма принятых работ, заявки, работы; на главной «Команда за …»).
  `team_rating`/`team_by_month` мастеру отдают пусто, `my_month_summary.total_kop` — null. Вкладки «Команда» у мастера нет.
  Тест — `supabase/tests/30_team_result.sql`.
  Руководителю цены работ заявки и итог — `request_money` (только руководитель) → `components/WorksMoney.tsx`.
* После каждой части: опубликовать сборку или обновление, объяснить, как получить на телефон,
  дать чек-лист для мастера и руководителя, обновить инструкцию мастера (`docs/instrukciya-mastera.*`).
* Работать в ветке, которую назначила сессия; без запроса не создавать PR.
* Доработки идут по одной: перед этапом изучить код и базу, показать короткий план и задать вопросы;
  работающее не переписывать. После этапа — сборка/обновление, как получить на телефон, списки проверки
  отдельно для мастера и руководителя, и ждать «дальше». Следующий этап без сообщения заказчика не начинать.
* Интерфейс на русском, удобно одной рукой; существующие экраны меняются только в части, о которой этап.
* Заявки из ITSM руководитель загружает файлом (решение заказчика 13.10.2026; с 18.10.2026 шаблон `case_*.xlsx`:
  Тема, Состояние, Ответственный, Время разрешения → срок `due_at`, «Просрочена» красным; старый шаблон тоже читается). Свои заявки мастер и руководитель создают
  «+ Новая заявка» с номерами 1, 2, 3… (общая нумерация, `create_manual_request`, показ «№ 12»). С 23.10.2026 заявки создаёт
  **только руководитель**; у мастера — «Работа без заявки» (`start_planned_work`) и «Сообщить руководителю» (`master_reports`).
* **Один путь мастера** (23.10.2026): работы вносятся только в карточке своей заявки «В работе» и сразу сохраняются
  (`add_request_work` → «день» мастера `day_shift_uuid`), отправка — `send_request_for_review_photos` (≥ 1 фото результата).
  «Закрыть смену» нет; `submit_shift` остался для дослать старых черновиков (`lib/legacyDraft.ts`) и старых версий.
  Фото результата/сообщений — `extra_photos` (чистка фото их учитывает). Дату работы меняет руководитель (`admin_set_entry_date`).
* Обновления ставятся сами при запуске (`lib/appUpdate.ts`); APK — только при смене иконки, разрешений, нативных модулей.
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
* Клавиатура на Android: окно не сжимается — отступ считает `Screen` (`useKeyboardInset`), поле держит над клавиатурой
  `keepAboveKeyboard(view, useScrollBy())`.
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
* **Одна заявка в работе** (21.10.2026): у ответственного не больше одной открытой `in_work` — индекс `requests_one_active_uq`
  и `assert_free` (блокировка строки сотрудника) во всех путях: `take_request`, `claim_request_for_work` (работы в смене),
  `create_manual_request` (занятому — «Ожидает» с назначением на него), `set_request_responsible` (обычную занятому — отказ,
  «Срочно» — текущая `paused/urgent`), `set_request_open`. Статус `paused` + `hold_reason`: `urgent`, `returned` (вернули,
  пока занят), `pause` (подтверждённая приостановка). Освободился (`send_request_for_review`, `refuse_request`, снятие,
  подрядчик, закрытие) → `resume_next`: сначала returned, потом urgent; `pause` — только `resume_request`. Запрос мастера
  `request_pause` → `decide_pause` руководителем. Обзор — `masters_now()`. Тест — `supabase/tests/20_one_active_request.sql`.
* Переписка и уведомления (только внутри приложения): `add_request_comment`, `edit_request_comment`, `delete_request_comment` (своё; руководитель — любое), `mark_request_read`, `my_notifications`;
  непрочитанное — `request_unread` по `request_reads`. Пуш-уведомлений нет.
* **Время выполнения не учитываем** (22.10.2026): ввода, плана и статистики нет. Архив (не показывать):
  `shift_requests.minutes`, `requests.plan_minutes`. Давность заявки — `request_work_days(taken_at)` (рабочие дни),
  порог `stores.stale_work_days` (`set_stale_work_days`). На проверку — только с работой.
* **Вид** (24.10.2026, макеты): все цвета/размеры/отступы — только `app/src/theme.ts`; текст — `Text`/`TextInput` из
  `components/Text.tsx` (шрифт LM Main по жирности). Статус заявки — `StatusPill` + `requestTone` (цвет + слово).
  Мастер: нижнее меню `BottomTabs`, жёлтая шапка `AppHeader`, главная кнопка — `footer` у `Screen`, редкие действия —
  `ActionSheet`. Руководитель — прежняя раскладка. «Передать подрядчику» мастера — просьба `request_contractor`
  в `master_reports` (`about_request`), решает руководитель (`decide_master_report … 'contractor'`).
* **«Не могу выполнить»** (26.10.2026): `cant_do(заявка, materials|not_needed|contractor, комментарий)`. Нет материалов —
  `paused/materials` («Ждёт материалы», мастер свободен, продолжить — `resume_request`); не нужна — просьба
  `master_reports.kind = 'close'`, закрывает только руководитель; подрядчик — `request_contractor`.
* **Деньги и дубли** (27.10.2026): работа — `client_key` (повтор без дубля); исполнители по умолчанию — мастер + напарники;
  `settle_request_works` — зачёт «ждут приёмки» при подрядчике/закрытии; отказ удаляет несданные работы; `submit_shift`
  у мастера — только своя заявка «В работе» (тестам 01–23 — `uchet.allow_legacy_shift`).
* **Зависающие заявки** (28.10.2026): закрытие in_work/paused снимает с мастера (`close_request_core`); массовые закрытия
  (ITSM, «старые») не трогают in_work/paused/review; отключение мастера освобождает его заявки (триггер `employees_release`);
  устаревшие просьбы мастеров закрываются триггером `requests_stale_asks`.
* **✏️ Исправить работу** (01.11.2026): руководитель в `WorksMoney` (✏️ у работы с ценой) → `CorrectWorkSheet` →
  `admin_correct_entry(работа, объём, цена_коп)`: только эта работа (прайс не меняется), пересчёт `entry_money`/`performer_money`,
  можно после «Принять». Мастеру не сообщается (в ленту не пишем); история — `entry_corrections`, «Исправлено …» — `request_money.corrected_at`.
* «Магазин» — не отдел для мастера, а «весь магазин» в фильтрах (`isWholeStore` в `lib/departments.ts`).
* Обучение: тексты шагов и «Что нового» — `app/src/lib/tours.ts`; элементы помечаются `<TourTarget id=…>` (`lib/tour.tsx`).
  После каждого обновления добавить запись в начало `WHATS_NEW` (тексты пишет Claude, заказчик проверяет).
