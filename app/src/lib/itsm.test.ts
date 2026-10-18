// Проверка разбора выгрузки ITSM на выдуманных данных (настоящих имён и телефонов здесь нет).
// Запуск: cd app && npm run test:itsm
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, zipSync } from 'fflate';
import { cleanDescription, findSuspects, inWindow, parseItsmFile, parseRegistered, parseRequester, PHONE_MARK, titleFromText } from './itsm.ts';

test('заявитель: «Имя Ф. (ldap)», отчество отбрасывается', () => {
  assert.equal(parseRequester('Тестов Пётр Сидорович (60000001)').value, 'Пётр Т. (60000001)');
  assert.equal(parseRequester('ПРИМЕРОВА анна (60000002)').value, 'Анна П. (60000002)');
  assert.equal(parseRequester('mag031 rr13 (rr13.mag031)').value, 'rr13.mag031');
  const bad = parseRequester('Отдел снабжения');
  assert.equal(bad.value, null);
  assert.equal(bad.recognized, false);
});

test('телефоны и почты удаляются', () => {
  const t = (s: string) => cleanDescription(s, []).text;
  assert.equal(t('Звонить +7 (900) 000-00-00 срочно'), `Звонить ${PHONE_MARK} срочно`);
  assert.equal(t('прошу помочь 89000000000'), `прошу помочь ${PHONE_MARK}`);
  assert.equal(t('вн. 12345, сломана розетка'), `${PHONE_MARK}, сломана розетка`);
  assert.equal(t('тел 031 802 и 031 602'), PHONE_MARK);
  assert.equal(t('моб: 8-900-000-00-00'), PHONE_MARK);
  assert.equal(t('почта test.user@example.com, кабинет 5'), 'почта, кабинет 5');
  assert.equal(t('артикул 89424148, 3 шт.'), 'артикул 89424148, 3 шт.', 'артикул из 8 цифр — не телефон');
  assert.equal(t('заявка INC251207_0535 повторно'), 'заявка INC251207_0535 повторно');
});

test('ФИО заявителя удаляется в любом падеже, смысл остаётся', () => {
  const parts = ['Тестов', 'Павел', 'Сидорович'];
  assert.equal(cleanDescription('Тестов Павел Сидорович просит заменить лампу в отделе Сад', parts).text, 'просит заменить лампу в отделе Сад');
  assert.equal(cleanDescription('Срочно! Передать Тестову П.С. ключи от склада', parts).text, 'Срочно! Передать ключи от склада');
  assert.equal(cleanDescription('Для Павла: починить стул', parts).text, 'Для: починить стул');
  assert.equal(cleanDescription('белый стеллаж, ряд 12', ['Белый', 'Иван']).text, 'белый стеллаж, ряд 12', 'слово со строчной не трогаем');
});

test('подсветка слов, похожих на имена', () => {
  assert.deepEqual(findSuspects('Повесить плакат. Согласовано с Примеровой Анной СОК'), ['Примеровой', 'Анной']);
  assert.deepEqual(findSuspects('Заменить лампу в отделе Сад, Тюмень'), []);
  assert.deepEqual(findSuspects('Ольга просила повесить зеркало'), ['Ольга']);
});

test('дата регистрации: число Excel и строка', () => {
  assert.equal(parseRegistered(46294.25342592593), '2026-09-29 06:04:56');
  assert.equal(parseRegistered('09.10.2026 14:05'), '2026-10-09 14:05:00');
  assert.equal(parseRegistered(''), null);
  assert.ok(inWindow('2026-10-09 14:05:00', '2026-10-09', '2026-10-11'));
  assert.ok(!inWindow('2026-10-08 23:59:59', '2026-10-09', '2026-10-11'));
  assert.ok(inWindow('2025-01-01 00:00:00', null, null), 'первая загрузка — без ограничения');
});

// Маленькая книга Excel так, как её пишет ITSM: префиксы x:, строки t="str", столбцы в другом порядке.
function book(rows: (string | number)[][]): Uint8Array {
  const cell = (v: string | number, ref: string) =>
    typeof v === 'number' ? `<x:c r="${ref}"><x:v>${v}</x:v></x:c>` : `<x:c t="str" r="${ref}"><x:v>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</x:v></x:c>`;
  const sheet = rows
    .map((r, i) => `<x:row r="${i + 1}">${r.map((v, j) => cell(v, String.fromCharCode(65 + j) + (i + 1))).join('')}</x:row>`)
    .join('');
  return zipSync({
    'xl/workbook.xml': strToU8('<x:workbook xmlns:x="m"><x:sheets><x:sheet name="Обращение" sheetId="1" r:id="R1" xmlns:r="r"/></x:sheets></x:workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="R1" Target="/xl/worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(`<x:worksheet xmlns:x="m"><x:sheetData>${sheet}</x:sheetData></x:worksheet>`),
  });
}

test('файл: столбцы по названию, неизвестные отбрасываются, ошибки по строкам', () => {
  const f = parseItsmFile(
    book([
      ['Рабочая группа', 'Номер', 'Секретное поле', 'Конечный потребитель', 'Краткое описание', 'Дата регистрации', 'Исполнитель', 'Операция'],
      ['L2-MAG-031', 'RFS261009_0001', 'х', 'Тестов Пётр Сидорович (60000001)', 'Тестов просит, тел. 12345', 46304.5, 'Кто-то', 'Ремонт стульев'],
      ['L2-MAG-777', 'INC261009_0002', 'х', 'mag777 rr1 (rr1.mag777)', 'Розетка', 46304.25, '', ''],
      ['L2-MAG-031', 'НЕ-НОМЕР', 'х', '', '', 46304, '', ''],
    ]),
  );
  assert.deepEqual(f.unknownColumns, ['Секретное поле']);
  assert.deepEqual(f.absentColumns, ['Услуга', 'Статус / Состояние']);
  assert.equal(f.rows.length, 3);
  const [a, b, c] = f.rows;
  assert.equal(a.number, 'RFS261009_0001');
  assert.equal(a.storeCode, '031');
  assert.equal(a.requester, 'Пётр Т. (60000001)');
  assert.equal(a.description, `просит, ${PHONE_MARK}`);
  assert.equal(a.operation, 'Ремонт стульев');
  assert.equal(a.registeredAt, '2026-10-09 12:00:00');
  assert.equal(b.storeCode, '777');
  assert.ok(c.errors.length > 0);
  assert.ok(!JSON.stringify(f).includes('Кто-то'), 'удаляемые столбцы в результат не попадают');
  assert.ok(!JSON.stringify(f).includes('Сидорович'), 'отчества нет');
});

test('название из текста: без приветствия, по первой строке, до 60 знаков', () => {
  assert.equal(titleFromText('Добрый день.\nПрошу в ауд. 2.30 поменять фильтры,\nСпасибо.'), 'Прошу в ауд. 2.30 поменять фильтры');
  assert.equal(titleFromText('Добрый день! Безопасность. Прошу в зоне логистики произвести замену светильников над воротами склада'),
    'Безопасность. Прошу в зоне логистики произвести замену…');
  assert.equal(titleFromText('Здравствуйте, коллеги! Не работает розетка у кассы 5'), 'Не работает розетка у кассы 5');
  assert.equal(titleFromText('замена лампы'), 'Замена лампы');
  assert.equal(titleFromText(''), null);
});

test('новый шаблон (case_*.xlsx): Тема, Состояние, Ответственный, Время разрешения', () => {
  const f = parseItsmFile(
    book([
      ['Номер', 'Конечный потребитель', 'Дата регистрации', 'Категория', 'Услуга', 'Тема', 'Ответственный', 'Состояние',
       'Время разрешения', '80 процентов до времени разрешения', '50 процентов до времени разрешения', 'Просрочен по реакции', 'Просрочен по разрешению'],
      ['RFS261016_0001', 'Тестов Пётр Сидорович (60000001)', 46311.49386574074, 'Запрос на обслуживание', 'Общие заявки',
       'Добрый день.\nПрошу в ауд. 2.30 поменять фильтры, тел. 12345\nСпасибо.', 'mag031 ing001 (ing001.mag031)', 'В работе',
       46327.47310185185, 46324.27, 46319.48, 'Нет', 'Да'],
      ['INC261016_0002', 'mag031 cs001 (cs001.mag031)', '16.10.2026 09:00', 'Инцидент', 'Электрика', 'Не горит свет',
       'mag031 ing001 (ing001.mag031)', 'В работе', '', '', '', 'Нет', 'Нет'],
    ]),
  );
  assert.deepEqual(f.missingColumns, []);
  assert.deepEqual(f.unknownColumns, [], 'все столбцы нового шаблона известны');
  assert.deepEqual(f.absentColumns, [], 'нет «Операции» — не предупреждаем, название из текста');
  const [a, b] = f.rows;
  assert.deepEqual(a.errors, []);
  assert.equal(a.storeCode, '031');
  assert.equal(a.status, 'В работе');
  assert.equal(a.service, 'Общие заявки');
  assert.equal(a.operation, `Прошу в ауд. 2.30 поменять фильтры, ${PHONE_MARK}`);
  assert.ok(a.autoTitle);
  assert.ok(a.description.includes('поменять фильтры') && !a.description.includes('12345'));
  assert.equal(a.registeredAt, '2026-10-16 11:51:10');
  assert.equal(a.dueAt, '2026-11-01 11:21:16');
  assert.equal(a.requester, 'Пётр Т. (60000001)');
  assert.equal(b.dueAt, null, 'пустой срок');
  assert.equal(b.operation, 'Не горит свет');
  assert.ok(!JSON.stringify(f).includes('ing001'), 'ответственный (учётка магазина) не сохраняется');
});
