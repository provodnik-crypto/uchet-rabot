// Раскладка отчёта по листам. Данные приходят из функций базы report_* (только оценённые работы).
import { excelDate, type Cell, type Sheet } from './xlsx.ts';

export type ReportData = {
  from: string;
  to: string;
  totals: { total_kop: number; entries: number; pending: number; rejected: number };
  employees: { employee_id: number; display_name: string; in_output_chart: boolean; total_kop: number; entries: number; shifts: number }[];
  months: { month: string; total_kop: number; entries: number }[];
  monthEmployees: { month: string; employee_id: number; display_name: string; in_output_chart: boolean; total_kop: number }[];
  rows: {
    work_date: string;
    department_name: string;
    request_number: string | null;
    name: string;
    unit_code: string;
    quantity: number;
    unit_price_kop: number;
    entry_total_kop: number;
    share_kop: number;
    performer_count: number;
    performer_name: string;
    note: string | null;
  }[];
  works: { category: string; name: string; unit_code: string; quantity: number; entries: number; total_kop: number }[];
};

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const monthLabel = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const ruDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const rub = (kop: number) => kop / 100;
const money = (kop: number): Cell => ({ v: rub(kop), s: 'money' });
const moneyBold = (kop: number): Cell => ({ v: rub(kop), s: 'moneyBold' });
const h = (v: string): Cell => ({ v, s: 'header' });
const b = (v: string): Cell => ({ v, s: 'bold' });
const muted = (v: string): Cell => ({ v, s: 'muted' });
const qty = (n: number): Cell => ({ v: Number(n), s: 'qty' });

/** Доля исполнителя для подписи: 1/2, 1/3… */
const shareLabel = (count: number) => (count > 1 ? `1/${count}` : '');

export function buildReport(d: ReportData): Sheet[] {
  const period = `Период: ${ruDate(d.from)} — ${ruDate(d.to)}`;
  const pendingNote = d.totals.pending ? `Без цены (на оценке): ${d.totals.pending} работ — в суммы не входят` : '';

  // ---------- 1. Сотрудники ----------
  const emp = [...d.employees].sort((a, b) => b.total_kop - a.total_kop);
  const chartEmp = emp.filter((e) => e.in_output_chart);
  const s1: Cell[][] = [
    [{ v: 'Выработка по сотрудникам', s: 'title' }],
    [muted(period)],
    [pendingNote ? muted(pendingNote) : null],
    [h('Сотрудник'), h('Сумма'), h('Работ'), h('Смен'), h('Средняя сумма за смену')],
  ];
  const empHeader = 3;
  // сначала сотрудники для диаграммы (по убыванию), затем служебные — вне диапазона диаграммы
  for (const e of [...chartEmp, ...emp.filter((x) => !x.in_output_chart)]) {
    s1.push([
      e.in_output_chart ? e.display_name : `${e.display_name} (без исполнителя)`,
      money(e.total_kop),
      e.entries,
      e.shifts,
      money(Math.round(e.total_kop / Math.max(1, e.shifts))),
    ]);
  }
  s1.push([b('Итого выполнено работ'), moneyBold(d.totals.total_kop), d.totals.entries, null, null]);
  s1.push([muted('Совместные работы засчитаны каждому по доле; в «Итого» каждая работа учтена один раз.')]);
  const sheet1: Sheet = {
    name: 'Сотрудники',
    rows: s1,
    widths: [30, 16, 10, 10, 24],
    freezeRows: empHeader + 1,
    charts: chartEmp.length
      ? [
          {
            title: 'Выработка сотрудников, ₽',
            grouping: 'clustered',
            categories: { sheet: 'Сотрудники', r1: empHeader + 1, c1: 0, r2: empHeader + chartEmp.length, c2: 0 },
            series: [{ name: 'Сумма', values: { sheet: 'Сотрудники', r1: empHeader + 1, c1: 1, r2: empHeader + chartEmp.length, c2: 1 } }],
            legend: false,
            at: { col: 6, row: 0, toCol: 15, toRow: 18 },
            valueFormat: '#,##0',
          },
        ]
      : [],
  };

  // ---------- 2. Итого за месяц ----------
  const people = [...new Map(d.monthEmployees.filter((m) => m.in_output_chart).map((m) => [m.employee_id, m.display_name])).entries()];
  const s2: Cell[][] = [
    [{ v: 'Итого за месяц', s: 'title' }],
    [muted(period)],
    [h('Месяц'), h('Сумма выполненных работ'), h('Работ')],
  ];
  const monthHeader = 2;
  for (const m of d.months) s2.push([monthLabel(m.month), money(m.total_kop), m.entries]);
  s2.push([b('Итого'), moneyBold(d.months.reduce((a, m) => a + m.total_kop, 0)), d.months.reduce((a, m) => a + Number(m.entries), 0)]);
  // таблица для диаграммы с накоплением: месяцы × сотрудники
  const breakdownHeader = s2.length + 1;
  s2.push([]);
  s2.push([h('Месяц'), ...people.map(([, name]) => h(name))]);
  for (const m of d.months) {
    s2.push([
      monthLabel(m.month),
      ...people.map(([id]) => {
        const x = d.monthEmployees.find((r) => r.month === m.month && r.employee_id === id);
        return money(x ? x.total_kop : 0);
      }),
    ]);
  }
  const nMonths = d.months.length;
  const sheet2: Sheet = {
    name: 'Итого за месяц',
    rows: s2,
    widths: [20, 24, 14, ...people.map(() => 14)],
    freezeRows: monthHeader + 1,
    charts: nMonths
      ? [
          {
            title: 'Сумма выполненных работ по месяцам, ₽',
            grouping: 'clustered',
            categories: { sheet: 'Итого за месяц', r1: monthHeader + 1, c1: 0, r2: monthHeader + nMonths, c2: 0 },
            series: [{ name: 'Сумма', values: { sheet: 'Итого за месяц', r1: monthHeader + 1, c1: 1, r2: monthHeader + nMonths, c2: 1 } }],
            legend: false,
            at: { col: Math.max(5, people.length + 2), row: 0, toCol: Math.max(5, people.length + 2) + 9, toRow: 18 },
            valueFormat: '#,##0',
          },
          ...(people.length
            ? [
                {
                  title: 'По сотрудникам (с накоплением), ₽',
                  grouping: 'stacked' as const,
                  categories: { sheet: 'Итого за месяц', r1: breakdownHeader + 1, c1: 0, r2: breakdownHeader + nMonths, c2: 0 },
                  series: people.map(([, name], i) => ({
                    name,
                    values: { sheet: 'Итого за месяц', r1: breakdownHeader + 1, c1: i + 1, r2: breakdownHeader + nMonths, c2: i + 1 },
                  })),
                  legend: true,
                  at: { col: Math.max(5, people.length + 2), row: 20, toCol: Math.max(5, people.length + 2) + 9, toRow: 40 },
                  valueFormat: '#,##0',
                },
              ]
            : []),
        ]
      : [],
  };

  // ---------- 3. Основной подсчет ----------
  const s3: Cell[][] = [
    [
      h('Дата'),
      h('Отдел'),
      h('Заявка'),
      h('Наименование работ'),
      h('Ед. измерения'),
      h('Кол-во'),
      h('Стоимость за ед.'),
      h('Стоимость общая'),
      h('Примечание'),
      h('Исполнитель'),
      h('Доля'),
    ],
  ];
  for (const r of d.rows) {
    s3.push([
      { v: excelDate(r.work_date), s: 'date' },
      r.department_name,
      r.request_number,
      r.name,
      r.unit_code,
      qty(r.quantity),
      money(r.unit_price_kop),
      // при нескольких исполнителях — доля этого исполнителя; сумма по столбцу = полной стоимости работ
      money(r.share_kop),
      r.note,
      r.performer_name,
      shareLabel(r.performer_count),
    ]);
  }
  const lastRow3 = s3.length - 1;
  s3.push([]);
  s3.push([b('Итого'), null, null, null, null, null, null, moneyBold(d.rows.reduce((a, r) => a + r.share_kop, 0))]);
  const sheet3: Sheet = {
    name: 'Основной подсчет',
    rows: s3,
    widths: [12, 14, 17, 50, 14, 9, 15, 16, 28, 16, 7],
    freezeRows: 1,
    autoFilter: { r1: 0, c1: 0, r2: Math.max(lastRow3, 1), c2: 10 },
  };

  // ---------- 4. По видам работ ----------
  const cats = new Map<string, { total: number; entries: number }>();
  for (const w of d.works) {
    const c = cats.get(w.category) ?? { total: 0, entries: 0 };
    c.total += w.total_kop;
    c.entries += Number(w.entries);
    cats.set(w.category, c);
  }
  const catList = [...cats.entries()].sort((a, b) => b[1].total - a[1].total);
  const s4: Cell[][] = [
    [{ v: 'По видам работ', s: 'title' }],
    [muted(period)],
    [h('Категория'), h('Сумма'), h('Работ')],
  ];
  const catHeader = 2;
  for (const [name, c] of catList) s4.push([name, money(c.total), c.entries]);
  s4.push([b('Итого'), moneyBold(catList.reduce((a, [, c]) => a + c.total, 0)), catList.reduce((a, [, c]) => a + c.entries, 0)]);
  s4.push([]);
  s4.push([h('Категория'), h('Вид работ'), h('Ед. изм.'), h('Объём'), h('Работ'), h('Сумма')]);
  const worksSorted = [...d.works].sort((a, b) => a.category.localeCompare(b.category, 'ru') || b.total_kop - a.total_kop);
  for (const w of worksSorted) s4.push([w.category, w.name, w.unit_code, qty(w.quantity), w.entries, money(w.total_kop)]);
  const sheet4: Sheet = {
    name: 'По видам работ',
    rows: s4,
    widths: [36, 50, 9, 10, 9, 16],
    charts: catList.length
      ? [
          {
            title: 'Сумма по категориям работ, ₽',
            grouping: 'clustered',
            categories: { sheet: 'По видам работ', r1: catHeader + 1, c1: 0, r2: catHeader + catList.length, c2: 0 },
            series: [{ name: 'Сумма', values: { sheet: 'По видам работ', r1: catHeader + 1, c1: 1, r2: catHeader + catList.length, c2: 1 } }],
            legend: false,
            at: { col: 7, row: 0, toCol: 16, toRow: 20 },
            valueFormat: '#,##0',
          },
        ]
      : [],
  };

  return [sheet1, sheet2, sheet3, sheet4];
}
