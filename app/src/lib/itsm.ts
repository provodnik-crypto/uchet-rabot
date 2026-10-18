// Разбор выгрузки ITSM (.xlsx) и обезличивание — целиком в памяти телефона.
// Исходный файл и удаляемые столбцы никуда не сохраняются; наружу выходят только очищенные строки.
// Файл без зависимостей от React Native: его проверяют тесты на node (itsm.test.ts).
import { strFromU8, unzipSync } from 'fflate';

// ---------- Чтение .xlsx ----------
type Cell = string | number | null;

const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      : ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e],
  );

/** Текст элемента: все <t>…</t> внутри (строки с форматированием разбиты на куски). */
const innerText = (xml: string) => decodeXml(Array.from(xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g), (m) => m[1]).join(''));

/** Убирает префиксы пространств имён: <x:row> → <row> (так пишет выгрузка ITSM). */
const xmlOf = (b: Uint8Array) => strFromU8(b).replace(/<(\/?)[A-Za-z][\w.-]*:/g, '<$1');

const colIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

/** Листы книги: имя → строки (массив ячеек). Читается только нужный лист. */
export function readXlsx(bytes: Uint8Array, preferSheet: string): { sheet: string; rows: Cell[][] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name),
    });
  } catch {
    throw new Error('Это не файл Excel (.xlsx). Выгрузите заявки из ITSM в формате Excel.');
  }
  const wb = files['xl/workbook.xml'];
  if (!wb) throw new Error('Это не файл Excel (.xlsx).');
  const sheets = Array.from(xmlOf(wb).matchAll(/<sheet\b[^>]*>/g), (m) => ({
    name: decodeXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? ''),
    rid: /r:id="([^"]*)"/.exec(m[0])?.[1] ?? '',
  }));
  const sheet = sheets.find((s) => s.name.trim().toLowerCase() === preferSheet.toLowerCase()) ?? sheets[0];
  if (!sheet) throw new Error('В файле нет листов');
  const rels = files['xl/_rels/workbook.xml.rels'] ? xmlOf(files['xl/_rels/workbook.xml.rels']) : '';
  const relTag = Array.from(rels.matchAll(/<Relationship\b[^>]*>/g), (m) => m[0]).find((t) => t.includes(`Id="${sheet.rid}"`));
  let target = relTag ? /Target="([^"]*)"/.exec(relTag)?.[1] ?? '' : '';
  target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
  const sheetXml = files[`xl/${target}`] ?? files['xl/worksheets/sheet1.xml'];
  if (!sheetXml) throw new Error('Не удалось прочитать лист с заявками');

  const shared = files['xl/sharedStrings.xml']
    ? Array.from(xmlOf(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g), (m) => innerText(m[1]))
    : [];

  const rows: Cell[][] = [];
  for (const rm of xmlOf(sheetXml).matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNum = Number(/\br="(\d+)"/.exec(rm[1])?.[1] ?? rows.length + 1);
    const row: Cell[] = [];
    for (const cm of (rm[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? '';
      const ref = /\br="([A-Z]+)\d*"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : row.length;
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      const v = raw === '' ? undefined : raw;
      let val: Cell = null;
      if (type === 's') val = v != null ? shared[Number(v)] ?? null : null;
      else if (type === 'inlineStr') val = innerText(body);
      else if (type === 'str' || type === 'e') val = v != null ? decodeXml(v) : null;
      else if (type === 'b') val = v ?? null;
      else if (v != null) val = Number(v);
      row[idx] = val;
    }
    rows[rowNum - 1] = Array.from(row, (x) => x ?? null);
  }
  return { sheet: sheet.name, rows: Array.from(rows, (r) => r ?? []) };
}

// ---------- Столбцы ----------
// Поддерживаются два шаблона выгрузки: старый (Операция, Краткое описание, Статус, Рабочая группа)
// и новый case_*.xlsx с 18.10.2026 (Тема, Состояние, Ответственный, Время разрешения). Шаблон определяется сам.
const KEEP = {
  number: ['Номер'],
  service: ['Услуга'],
  operation: ['Операция'],
  description: ['Краткое описание', 'Тема'],
  status: ['Статус', 'Состояние'],
  registered: ['Дата регистрации'],
  group: ['Рабочая группа', 'Ответственный'],
  requester: ['Конечный потребитель'],
  due: ['Время разрешения'],
} as const;
type Key = keyof typeof KEEP;

/** Столбцы, которые известны и сознательно отбрасываются. */
const DROP = [
  'Создал', 'Категория', 'Категория услуг', 'Рабочая группа.Линия поддержки', 'Исполнитель',
  'Дата закрытия', 'Техническое описание', 'Создавшая группа',
  '80 процентов до времени разрешения', '50 процентов до времени разрешения',
  'Просрочен по реакции', 'Просрочен по разрешению',
];
const REQUIRED: Key[] = ['number', 'group', 'registered'];
/** Необязательные, о которых не предупреждаем: в новом шаблоне их нет, название берётся из текста. */
const QUIET: Key[] = ['operation', 'due'];

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

// ---------- Дата ----------
const pad = (n: number) => String(n).padStart(2, '0');

/** Дата регистрации → «ГГГГ-ММ-ДД ЧЧ:ММ:СС», как в файле (местное время). */
export function parseRegistered(v: Cell): string | null {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const ms = Math.round((v - 25569) * 86400) * 1000; // 25569 — 01.01.1970 в днях Excel
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  }
  const s = String(v ?? '').trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])} ${pad(+(m[4] ?? 0))}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`;
  return null;
}

// ---------- Заявитель ----------
export type Requester = { value: string | null; nameParts: string[]; recognized: boolean };

/** «Фамилия Имя Отчество (60035226)» → «Имя Ф. (60035226)»; «mag031 rr13 (rr13.mag031)» → «rr13.mag031». */
export function parseRequester(raw: Cell): Requester {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { value: null, nameParts: [], recognized: true };
  const m = /^(.+?)\s*\(([^()]+)\)$/.exec(s);
  if (m) {
    const words = m[1].split(' ');
    const ldap = m[2].trim();
    if (/^[a-z0-9_-]+\.[a-z0-9_-]+$/i.test(ldap) && words.every((w) => /^[a-z0-9_-]+$/i.test(w))) {
      return { value: ldap.toLowerCase(), nameParts: [], recognized: true };
    }
    const nameOk = (w: string) => /^[А-ЯЁа-яё]+(-[А-ЯЁа-яё]+)*$/.test(w);
    if (/^\d{3,12}$/.test(ldap) && words.length >= 2 && words.length <= 4 && words.every(nameOk)) {
      const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase().replace(/-(.)/g, (_, c: string) => '-' + c.toUpperCase());
      const value = `${cap(words[1])} ${words[0].charAt(0).toUpperCase()}. (${ldap})`;
      return { value, nameParts: words, recognized: true };
    }
  }
  // Не распознали: не сохраняем, но всё, что похоже на слова имени, вычищаем из описания.
  const parts = s.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter((w) => /^[А-ЯЁа-яё-]{2,}$/.test(w));
  return { value: null, nameParts: parts, recognized: false };
}

// ---------- Очистка описания ----------
export const PHONE_MARK = '[тел. удалён]';
const L = 'А-ЯЁа-яёA-Za-z';

const lowerE = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Основы слова имени для сравнения в любом падеже: «Павел» → павел, павл; «Иванова» → иванов. */
function stems(word: string): string[] {
  const w = lowerE(word);
  const out = new Set<string>();
  const two = /(ий|ый|ой|ая|яя|ая)$/.exec(w);
  const base = two ? w.slice(0, -2) : w.replace(/[аяоеиыуюйь]$/, '');
  out.add(base);
  const fleeting = /^(.*[^аеиоуыэюя])[ео]([^аеиоуыэюя])$/.exec(base); // Павел → Павл(а)
  if (fleeting) out.add(fleeting[1] + fleeting[2]);
  return Array.from(out).filter((x) => x.length >= 3);
}

function matchesName(token: string, parts: string[]): boolean {
  if (!/^[А-ЯЁ]/.test(token)) return false; // «Белый» в описании цвета не трогаем: только с заглавной
  const t = lowerE(token);
  return parts.some((p) => {
    const pl = lowerE(p);
    if (t === pl) return true;
    if (pl.length < 4) return false;
    return stems(p).some((s) => t.startsWith(s) && t.length - s.length <= 3);
  });
}

const KEYWORD = '(?:(?:телефон|тел|моб(?:ильный)?|вн(?:утр(?:енний)?)?|т)\\.?(?:\\s*для\\s+связи)?|для\\s+связи)';
const NUM_AFTER_KEYWORD = '\\+?\\d[\\d\\s()-]{3,16}\\d';
const MOBILE = '(?<!\\d)(?:(?:\\+7|8|7)[\\s(-]*|\\(?)\\d{3}[\\s)-]{0,2}\\d{3}[\\s-]?\\d{2}[\\s-]?\\d{2}(?!\\d)';
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+/g;

/** Убирает телефоны (со словами «тел», «т.», «вн», «моб») и почты. */
export function stripContacts(text: string): string {
  let s = text.replace(EMAIL, '');
  s = s.replace(new RegExp(`(?<![${L}])${KEYWORD}\\s*[:№.-]?\\s*(${NUM_AFTER_KEYWORD})`, 'gi'), (all, num: string) => {
    const digits = num.replace(/\D/g, '').length;
    return digits >= 5 && digits <= 11 ? PHONE_MARK : all;
  });
  s = s.replace(new RegExp(MOBILE, 'g'), PHONE_MARK);
  // «… [тел. удалён], 12345» — второй внутренний номер рядом с первым
  const tail = new RegExp(`(\\[тел\\. удалён\\])\\s*(?:[,;/]|или|и)\\s*(\\d[\\d -]{3,7}\\d)(?!\\d)`, 'g');
  for (let i = 0; i < 5; i++) {
    const next = s.replace(tail, (all, mark: string, num: string) => {
      const n = num.replace(/\D/g, '').length;
      return n >= 5 && n <= 6 ? mark : all;
    });
    if (next === s) break;
    s = next;
  }
  return s.replace(/(\[тел\. удалён\][\s,;]*){2,}/g, `${PHONE_MARK} `);
}

const ZERO = '\u0000';

/** Убирает слова ФИО заявителя (любой падеж) и стоящие рядом инициалы. */
export function stripNames(text: string, nameParts: string[]): string {
  if (!nameParts.length) return text;
  let s = text.replace(new RegExp(`[${L}]+(?:-[${L}]+)*`, 'g'), (w) => (matchesName(w, nameParts) ? ZERO : w));
  s = s.replace(new RegExp(`${ZERO}(\\s*[А-ЯЁ]\\.){1,2}`, 'g'), ZERO).replace(new RegExp(`([А-ЯЁ]\\.\\s?){1,2}\\s*${ZERO}`, 'g'), ZERO);
  return s.replace(new RegExp(`\\s*${ZERO}(\\s*${ZERO})*`, 'g'), ' ');
}

const tidy = (s: string) =>
  s
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/([(])\s+/g, '$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/\(\s*\)/g, '')
    .replace(/^[\s,.;:–-]+/, '')
    .replace(/[\s,;:–-]+$/, '')
    .trim();

// Слова с заглавной буквы, которые точно не имена (отделы, места, служебные слова).
const NOT_NAMES = new Set(
  (
    'Тюмень Тюмени Россия Леруа Мерлен Касса Кассы Кассе Склад Склада Складе Сад Сада Декор Декора Плитка Плитки Сантехника Сантехники ' +
    'Электрика Электрики Столярка Столярки Краски Освещение Освещения Инструменты Инструментов Стройматериалы Стройматериалов ' +
    'Напольные Покрытия Кухни Кухня Хранение Хранения Двери Окна Текстиль Текстиля Скобяные Изделия Отдел Отдела Отделе Отделы Магазин Магазина ' +
    'Магазине Зал Зала Зале Торговый Торговом Торгового Офис Офиса Офисе Ресепшн Ресепшен Вход Входа Входе Выход Выхода Выходе ' +
    'Парковка Парковки Парковке Шоурум Стенд Стенда Стенде Стеллаж Стеллажа Стеллаже Ряд Ряда Ряду Ряде Аллея Аллеи Аллее Зона Зоны Зоне ' +
    'Срочно Просьба Прошу Просим Необходимо Нужно Требуется Сделать Заменить Починить Отремонтировать Установить Демонтировать ' +
    'Монтаж Демонтаж Ремонт Замена Покраска Добрый Здравствуйте Спасибо Пожалуйста Уважаемые Коллеги Также Так Для При После Перед ' +
    'Около Возле Напротив Над Под Между Рядом Справа Слева На Не Нет Да Есть Еще Ещё Все Всё Это Этот Эта Эти Там Тут Где Когда ' +
    'Понедельник Вторник Среда Среду Четверг Пятница Пятницу Суббота Субботу Воскресенье Январь Февраль Март Апрель Май Июнь Июль ' +
    'Август Сентябрь Октябрь Ноябрь Декабрь Января Февраля Марта Апреля Мая Июня Июля Августа Сентября Октября Ноября Декабря ' +
    'Директор Директора Руководитель Руководителя Менеджер Менеджера Сотрудник Сотрудника Клиент Клиента Клиенту Покупатель Покупателя ' +
    'Инженер Инженеры Инженера Инженеров Телефон Фото Цена Цены Старт Сезона Центра Центр Вне Про Два Три Щит Щита ' +
    'Столярные Выкладка Выкладки Укладка Укладки Крепление Покрасить Утилизировать Заранее Очередной Нужное Лучшая Услуг Услуги ' +
    'Керамогранит Ламинат Ламината Травертин Мрамор Кедр Листами Ливневка Садового Садовый'
  )
    .split(' ')
    .map(lowerE),
);

// Частые имена: такое слово подсвечивается даже в начале предложения.
const FIRST_NAMES = (
  'Александр Алексей Анатолий Андрей Антон Аркадий Артем Артур Богдан Борис Вадим Валентин Валерий Василий Виктор Виталий ' +
  'Владимир Владислав Вячеслав Геннадий Георгий Глеб Григорий Даниил Денис Дмитрий Евгений Егор Иван Игорь Илья Кирилл ' +
  'Константин Леонид Максим Марат Михаил Никита Николай Олег Павел Петр Роман Руслан Сергей Станислав Степан Тимур Федор ' +
  'Юрий Ярослав Саша Алексеевич Дима Женя Коля Миша Сережа Вова Паша Алена Александра Алина Алла Анастасия Ангелина Анна ' +
  'Антонина Валентина Валерия Вера Вероника Виктория Галина Дарья Диана Евгения Екатерина Елена Елизавета Жанна Зоя Инна ' +
  'Ирина Карина Кристина Ксения Лариса Лилия Любовь Людмила Маргарита Марина Мария Надежда Наталья Наталия Нина Оксана ' +
  'Ольга Полина Раиса Светлана Софья Тамара Татьяна Ульяна Юлия Юля Яна Катя Лена Маша Настя Наташа Оля Таня Света Ксюша'
)
  .split(' ')
  .map(lowerE);
const looksLikeName = (w: string) => {
  const t = lowerE(w);
  return FIRST_NAMES.some((n) => t === n || stems(n).some((s) => s.length >= 4 && t.startsWith(s) && t.length - s.length <= 3));
};
const SURNAME_END = /(ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкий|цкая|ко|юк|ук|ич|ых|их)$/;

/** Слова, похожие на имена: с заглавной буквы не в начале предложения и не из списка обычных слов. */
export function findSuspects(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(`[${L}]+(?:-[${L}]+)*`, 'g'))) {
    const w = m[0];
    if (!/^[А-ЯЁ][а-яё]{2,}(-[А-ЯЁ][а-яё]+)?$/.test(w)) continue;
    if (NOT_NAMES.has(lowerE(w))) continue;
    const raw = text.slice(0, m.index);
    const before = raw.trimEnd();
    const sentenceStart = before === '' || /\n\s*$/.test(raw) || /[.!?:;"«()–—-]$/.test(before);
    if (sentenceStart && !looksLikeName(w) && !(SURNAME_END.test(w) && w.length >= 5)) {
      // в начале предложения подозрительно, только если сразу за ним ещё слово с заглавной
      const after = text.slice((m.index ?? 0) + w.length);
      if (!/^\s+[А-ЯЁ][а-яё]{2,}/.test(after) && !/^\s+[А-ЯЁ]\./.test(after)) continue;
      const next = /^\s+([А-ЯЁ][а-яё]{2,})/.exec(after)?.[1];
      if (next && NOT_NAMES.has(lowerE(next))) continue;
    }
    if (!out.includes(w)) out.push(w);
  }
  return out;
}

/** Полная очистка описания одной строки. */
export function cleanDescription(text: string, nameParts: string[]): { text: string; suspects: string[] } {
  const cleaned = tidy(stripNames(stripContacts(text.replace(/\r/g, '')), nameParts));
  return { text: cleaned.slice(0, 1000), suspects: findSuspects(cleaned) };
}

// ---------- Название из текста ----------
const GREETING = /^(?:добр(?:ый|ое|ого)\s+(?:день|утро|вечер|времени\s+суток)|здравствуйте|приветствую|привет|коллеги|уважаемые\s+коллеги)[\s!.,:;)-]*/i;

/**
 * Короткое название заявки из текста (в новом шаблоне нет «Операции»): первая строка без приветствия,
 * до 60 знаков по границе слова. По точкам не режем — «ауд. 2.30», «т.к.» встречаются часто.
 */
export function titleFromText(text: string, max = 60): string | null {
  const strip = (l: string) => {
    let t = l.replace(/\s+/g, ' ').trim();
    for (let i = 0; i < 3; i++) {
      const n = t.replace(GREETING, '').trim();
      if (n === t) break;
      t = n;
    }
    return t.replace(/^[\s!.,:;-]+/, '').replace(/[\s,;:-]+$/, '');
  };
  let s = text.split('\n').map(strip).find((l) => l.length >= 3) ?? '';
  if (!s) return null;
  if (s.length > max) {
    const cut = s.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    s = (sp > 25 ? cut.slice(0, sp) : cut).replace(/[\s,.;:-]+$/, '') + '…';
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ---------- Строки файла ----------
export type ItsmRow = {
  line: number; // строка в Excel
  number: string;
  storeCode: string | null;
  service: string | null;
  operation: string | null;
  description: string;
  status: string | null;
  registeredAt: string | null; // «ГГГГ-ММ-ДД ЧЧ:ММ:СС»
  /** Срок ITSM («Время разрешения»), местное время; в старом шаблоне — null. */
  dueAt: string | null;
  /** Название собрано из текста (нового шаблона): после правки текста пересобрать. */
  autoTitle: boolean;
  requester: string | null;
  requesterUnrecognized: boolean;
  suspects: string[];
  errors: string[];
};

export type ItsmFile = {
  sheet: string;
  rows: ItsmRow[];
  unknownColumns: string[]; // пропущены: их нет в списке известных
  missingColumns: string[]; // нет обязательных — файл не загрузить
  absentColumns: string[]; // нет необязательных — поля останутся пустыми
};

const NUMBER_RE = /^(RFS|INC)\d{6}_\d{4}$/;
const text = (v: Cell) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim() || null);
/** Многострочный текст: пробелы внутри строк схлопываются, переносы строк остаются. */
const multiline = (v: Cell) =>
  String(v ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');

/** Таблица → очищенные строки. Удаляемые столбцы не читаются дальше заголовка. */
export function parseItsmRows(sheet: string, table: Cell[][]): ItsmFile {
  const headerIdx = table.findIndex((r) => r.some((c) => KEEP.number.some((n) => norm(c) === norm(n))));
  if (headerIdx < 0) throw new Error('В файле нет столбца «Номер». Это точно выгрузка заявок из ITSM?');
  const header = table[headerIdx];
  const col = {} as Record<Key, number>;
  const unknownColumns: string[] = [];
  header.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    const key = (Object.keys(KEEP) as Key[]).find((k) => KEEP[k].some((name) => norm(name) === n));
    if (key && col[key] === undefined) col[key] = i;
    else if (!DROP.some((d) => norm(d) === n)) unknownColumns.push(String(h).trim());
  });
  const missingColumns = REQUIRED.filter((k) => col[k] === undefined).map((k) => KEEP[k].join(' / '));
  const optionalMissing = (Object.keys(KEEP) as Key[])
    .filter((k) => !REQUIRED.includes(k) && !QUIET.includes(k) && col[k] === undefined)
    .map((k) => KEEP[k].join(' / '));
  if (missingColumns.length) return { sheet, rows: [], unknownColumns, missingColumns, absentColumns: optionalMissing };

  const get = (r: Cell[], k: Key) => (col[k] === undefined ? null : r[col[k]] ?? null);
  const rows: ItsmRow[] = [];
  for (let i = headerIdx + 1; i < table.length; i++) {
    const r = table[i];
    if (!r || r.every((c) => c == null || String(c).trim() === '')) continue;
    const errors: string[] = [];
    const number = (text(get(r, 'number')) ?? '').toUpperCase();
    if (!NUMBER_RE.test(number)) errors.push(`номер «${number || 'пусто'}» не похож на RFS/INC`);
    const group = text(get(r, 'group')) ?? '';
    // «L2-MAG-031» (рабочая группа) или «mag031 ing001 (…)» (ответственный)
    const storeCode = /\bMAG-?(\d{3})\b/i.exec(group)?.[1] ?? null;
    if (!storeCode) errors.push('нет номера магазина (MAG-031 / mag031)');
    const registeredAt = parseRegistered(get(r, 'registered'));
    if (!registeredAt) errors.push('нет даты регистрации');
    const req = parseRequester(get(r, 'requester'));
    const { text: description, suspects } = cleanDescription(multiline(get(r, 'description')), req.nameParts);
    rows.push({
      line: i + 1,
      number,
      storeCode,
      service: text(get(r, 'service')),
      operation: col.operation === undefined ? titleFromText(description) : text(get(r, 'operation')),
      description,
      status: text(get(r, 'status')),
      registeredAt,
      dueAt: col.due === undefined ? null : parseRegistered(get(r, 'due')),
      autoTitle: col.operation === undefined,
      requester: req.value,
      requesterUnrecognized: !req.recognized,
      suspects,
      errors,
    });
  }
  return { sheet, rows, unknownColumns, missingColumns, absentColumns: optionalMissing };
}

export function parseItsmFile(bytes: Uint8Array): ItsmFile {
  const { sheet, rows } = readXlsx(bytes, 'Обращение');
  return parseItsmRows(sheet, rows);
}

/** Пересчитать подсветку после правки описания руководителем (телефоны и почты убираются снова). */
export function recheckDescription(edited: string): { text: string; suspects: string[] } {
  return cleanDescription(edited, []);
}

// ---------- Окно дат ----------
export const dayOf = (registeredAt: string | null) => (registeredAt ? registeredAt.slice(0, 10) : null);

export function inWindow(registeredAt: string | null, from: string | null, to: string | null): boolean {
  const d = dayOf(registeredAt);
  if (!d) return false;
  return (!from || d >= from) && (!to || d <= to);
}
