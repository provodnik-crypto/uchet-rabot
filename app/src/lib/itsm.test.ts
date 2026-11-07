// Проверка разбора выгрузки ITSM на выдуманных данных (настоящих имён и телефонов здесь нет).
// Запуск: cd app && npm run test:itsm
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { cleanDescription, findSuspects, inWindow, parseItsmFile, parseRegistered, parseRequester, PHONE_MARK, titleFromText, workPhones } from './itsm.ts';

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
  assert.equal(t('тел 12 802 и 12 602'), PHONE_MARK, 'два внутренних номера подряд');
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

test('рабочий телефон 031xxx остаётся и выносится отдельно', () => {
  const t = (s: string) => cleanDescription(s, []).text;
  assert.equal(t('1. Служба персонала 031323\n2. Установить пурефаеры'), '1. Служба персонала 031323\n2. Установить пурефаеры');
  assert.equal(t('тел. 031-899, сломан кран'), 'тел. 031899, сломан кран');
  assert.equal(t('вн 031 802 и 031 602'), 'вн 031802 и 031602');
  assert.equal(t('тел. 031899 или +7 900 000-00-00'), `тел. 031899 или ${PHONE_MARK}`, 'мобильный по-прежнему удаляется');
  assert.equal(t('вн. 12345, розетка'), `${PHONE_MARK}, розетка`, 'другие внутренние номера удаляются');
  assert.deepEqual(workPhones('Служба 031323, ещё тел. 031-899 и снова 031323'), ['031323', '031899']);
  assert.deepEqual(workPhones('магазин MAG-031 123 и mag031 456, артикул 0315678, 89031234567'), [], 'не номер магазина и не часть длинного числа');
});

/** Книга с картинками: «поверх ячеек» (drawing) и/или «в ячейке» (richData). Картинки — несколько байт-заглушек. */
function bookWithImages(rows: (string | number)[][], opts: { floating?: [number, number][]; inCell?: string[] }) {
  const base = book(rows);
  const files = unzipSync(base);
  const img = (i: number) => new Uint8Array([0xff, 0xd8, 0xff, i]);
  let sheet = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']);
  if (opts.floating?.length) {
    const anchors = opts.floating
      .map(([row, col], i) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>71439</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>4762</xdr:rowOff></xdr:from><xdr:to><xdr:col>${col}</xdr:col><xdr:colOff>5</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>5</xdr:rowOff></xdr:to><xdr:pic><xdr:blipFill><a:blip r:embed="rId${i + 1}"/></xdr:blipFill></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`)
      .join('');
    files['xl/drawings/drawing1.xml'] = strToU8(`<xdr:wsDr xmlns:xdr="d" xmlns:a="a" xmlns:r="r">${anchors}</xdr:wsDr>`);
    files['xl/drawings/_rels/drawing1.xml.rels'] = strToU8(`<Relationships>${opts.floating.map((_, i) => `<Relationship Id="rId${i + 1}" Target="../media/image${i + 1}.jpeg"/>`).join('')}<Relationship Id="rId99" Target="https://example.com/x.jpg" TargetMode="External"/></Relationships>`);
    opts.floating.forEach((_, i) => (files[`xl/media/image${i + 1}.jpeg`] = img(i + 1)));
    files['xl/worksheets/_rels/sheet1.xml.rels'] = strToU8('<Relationships><Relationship Id="rId1" Target="../drawings/drawing1.xml"/></Relationships>');
    sheet = sheet.replace('</x:worksheet>', '<x:drawing r:id="rId1" xmlns:r="r"/></x:worksheet>');
  }
  if (opts.inCell?.length) {
    // ячейки с картинкой: <c r="N2" vm="1"><v>#VALUE!</v></c>
    opts.inCell.forEach((ref, i) => {
      const row = ref.replace(/^[A-Z]+/, '');
      sheet = sheet.replace(new RegExp(`(<x:row r="${row}">[\\s\\S]*?)(</x:row>)`), `$1<x:c r="${ref}" t="e" vm="${i + 1}"><x:v>#VALUE!</x:v></x:c>$2`);
      files[`xl/media/cell${i + 1}.png`] = img(50 + i);
    });
    files['xl/richData/rdrichvalue.xml'] = strToU8(`<rvData>${opts.inCell.map((_, i) => `<rv s="0"><v>${i}</v><v>5</v></rv>`).join('')}</rvData>`);
    files['xl/richData/richValueRel.xml'] = strToU8(`<richValueRels xmlns:r="r">${opts.inCell.map((_, i) => `<rel r:id="rId${i + 1}"/>`).join('')}</richValueRels>`);
    files['xl/richData/_rels/richValueRel.xml.rels'] = strToU8(`<Relationships>${opts.inCell.map((_, i) => `<Relationship Id="rId${i + 1}" Target="../media/cell${i + 1}.png"/>`).join('')}</Relationships>`);
  }
  files['xl/worksheets/sheet1.xml'] = strToU8(sheet);
  return zipSync(files);
}

const HEAD = ['Номер', 'Конечный потребитель', 'Дата регистрации', 'Услуга', 'Тема', 'Ответственный', 'Состояние', 'Время разрешения', 'Фото'];
const line = (n: string, text: string) => [n, 'mag031 cs001 (cs001.mag031)', '16.10.2026 09:00', 'Общие заявки', text, 'mag031 ing001 (ing001.mag031)', 'В работе', ''];

test('фото поверх ячеек столбца «Фото» — к своей строке; ссылки из интернета не читаются', () => {
  const f = parseItsmFile(bookWithImages([HEAD, line('RFS261023_0001', 'Ручки'), line('RFS261023_0002', 'МДФ'), line('RFS261023_0003', 'Свет')], {
    floating: [[1, 8], [3, 8], [3, 8], [2, 2]],
  }));
  assert.ok(f.photoColumn);
  assert.deepEqual(f.unknownColumns, []);
  assert.deepEqual(f.rows.map((r) => r.photos.length), [1, 0, 2], 'картинка в другом столбце не считается');
  assert.equal(f.rows[0].photos[0].ext, 'jpeg');
  assert.deepEqual(Array.from(f.rows[0].photos[0].bytes), [0xff, 0xd8, 0xff, 1]);
});

test('фото «в ячейке» (Excel 365)', () => {
  const f = parseItsmFile(bookWithImages([HEAD, line('RFS261023_0001', 'Ручки'), line('RFS261023_0002', 'МДФ')], { inCell: ['I3'] }));
  assert.deepEqual(f.rows.map((r) => r.photos.length), [0, 1]);
  assert.equal(f.rows[1].photos[0].ext, 'png');
});

test('без столбца «Фото» картинки не читаются, файл — как раньше', () => {
  const head = HEAD.slice(0, 8);
  const f = parseItsmFile(bookWithImages([head, line('RFS261023_0001', 'Ручки тел. 031-323')], { floating: [[1, 8]] }));
  assert.equal(f.photoColumn, false);
  assert.deepEqual(f.absentColumns, [], 'про отсутствие «Фото» не предупреждаем');
  assert.equal(f.rows[0].photos.length, 0);
  assert.equal(f.rows[0].contactPhone, '031323');
  assert.ok(f.rows[0].description.includes('031323'));
});

test('больше 3 фото в строке — лишние пропускаются и считаются', () => {
  const f = parseItsmFile(bookWithImages([HEAD, line('RFS261023_0001', 'Ручки')], { floating: [[1, 8], [1, 8], [1, 8], [1, 8]] }));
  assert.equal(f.rows[0].photos.length, 3);
  assert.equal(f.skippedPhotos, 1);
});
