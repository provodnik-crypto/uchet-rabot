// Собирает отчёт на тестовых данных тем же кодом, что и серверная функция excel-report.
import { writeFileSync } from 'node:fs';
import { strToU8, zipSync } from 'fflate';
import { buildReport, type ReportData } from '../../functions/excel-report/report.ts';
import { buildXlsx } from '../../functions/excel-report/xlsx.ts';

const rows: ReportData['rows'] = [
  { work_date: '2026-01-15', department_name: 'Магазин', request_number: 'RFS260115_1001', name: 'Установка скамеек', unit_code: 'шт', quantity: 3, unit_price_kop: 58800, entry_total_kop: 176400, share_kop: 88200, performer_count: 2, performer_name: 'Николай Х.', note: null },
  { work_date: '2026-01-15', department_name: 'Магазин', request_number: 'RFS260115_1001', name: 'Установка скамеек', unit_code: 'шт', quantity: 3, unit_price_kop: 58800, entry_total_kop: 176400, share_kop: 88200, performer_count: 2, performer_name: 'Михаил М.', note: null },
  { work_date: '2026-02-03', department_name: 'Плитка', request_number: null, name: 'Распил МДФ & <ЛДСП>', unit_code: 'м', quantity: 2.5, unit_price_kop: 33333, entry_total_kop: 83333, share_kop: 27779, performer_count: 3, performer_name: 'Евгений Г.', note: 'срочно "по звонку"' },
  { work_date: '2026-02-03', department_name: 'Плитка', request_number: null, name: 'Распил МДФ & <ЛДСП>', unit_code: 'м', quantity: 2.5, unit_price_kop: 33333, entry_total_kop: 83333, share_kop: 27777, performer_count: 3, performer_name: 'Николай Х.', note: 'срочно "по звонку"' },
  { work_date: '2026-02-03', department_name: 'Плитка', request_number: null, name: 'Распил МДФ & <ЛДСП>', unit_code: 'м', quantity: 2.5, unit_price_kop: 33333, entry_total_kop: 83333, share_kop: 27777, performer_count: 3, performer_name: 'Владимир К.', note: 'срочно "по звонку"' },
  { work_date: '2026-02-10', department_name: 'Магазин', request_number: 'INC260210_2002', name: 'Монтаж светильников любых', unit_code: 'шт', quantity: 10, unit_price_kop: 50000, entry_total_kop: 500000, share_kop: 500000, performer_count: 1, performer_name: 'Не указан', note: null },
];
const total = rows.reduce((a, r) => a + r.share_kop, 0);
const data: ReportData = {
  from: '2026-01-01',
  to: '2026-02-28',
  totals: { total_kop: total, entries: 3, pending: 2, rejected: 0 },
  employees: [
    { employee_id: 1, display_name: 'Николай Х.', in_output_chart: true, total_kop: 88200 + 27777, entries: 2, shifts: 2 },
    { employee_id: 2, display_name: 'Михаил М.', in_output_chart: true, total_kop: 88200, entries: 1, shifts: 1 },
    { employee_id: 3, display_name: 'Евгений Г.', in_output_chart: true, total_kop: 27779, entries: 1, shifts: 1 },
    { employee_id: 4, display_name: 'Владимир К.', in_output_chart: true, total_kop: 27777, entries: 1, shifts: 1 },
    { employee_id: 5, display_name: 'Не указан', in_output_chart: false, total_kop: 500000, entries: 1, shifts: 1 },
  ],
  months: [
    { month: '2026-01-01', total_kop: 176400, entries: 1 },
    { month: '2026-02-01', total_kop: 83333 + 500000, entries: 2 },
  ],
  monthEmployees: [
    { month: '2026-01-01', employee_id: 1, display_name: 'Николай Х.', in_output_chart: true, total_kop: 88200 },
    { month: '2026-01-01', employee_id: 2, display_name: 'Михаил М.', in_output_chart: true, total_kop: 88200 },
    { month: '2026-02-01', employee_id: 1, display_name: 'Николай Х.', in_output_chart: true, total_kop: 27777 },
    { month: '2026-02-01', employee_id: 3, display_name: 'Евгений Г.', in_output_chart: true, total_kop: 27779 },
    { month: '2026-02-01', employee_id: 4, display_name: 'Владимир К.', in_output_chart: true, total_kop: 27777 },
    { month: '2026-02-01', employee_id: 5, display_name: 'Не указан', in_output_chart: false, total_kop: 500000 },
  ],
  rows,
  works: [
    { category: 'Благоустройство', name: 'Установка скамеек', unit_code: 'шт', quantity: 3, entries: 1, total_kop: 176400 },
    { category: 'Вне прайса', name: 'Распил МДФ & <ЛДСП>', unit_code: 'м', quantity: 2.5, entries: 1, total_kop: 83333 },
    { category: 'Внутренние инженерные сети', name: 'Монтаж светильников любых', unit_code: 'шт', quantity: 10, entries: 1, total_kop: 500000 },
  ],
  time: {
    kinds: [
      { kind: 'Внутренние инженерные сети', jobs: 4, avg_minutes: 210, median_minutes: 180 },
      { kind: 'Благоустройство', jobs: 2, avg_minutes: 95, median_minutes: 95 },
      { kind: 'Работы вне прайса', jobs: 3, avg_minutes: 60, median_minutes: 45 },
    ],
    masters: [
      { employee_id: 1, display_name: 'Николай Х.', requests: 5, jobs: 6, minutes: 900, expected_minutes: 1020, ratio: 0.882 },
      { employee_id: 2, display_name: 'Михаил М.', requests: 2, jobs: 2, minutes: 400, expected_minutes: 380, ratio: 1.053 },
    ],
    over_plan: [{ number: 'RFS260115_1001', plan_minutes: 240, spent_minutes: 300, state: 'done', since: '2026-01-14', last_date: '2026-01-15' }],
    requests: 7,
    carried: 2,
    done: 6,
    minutes: 1500,
  },
};

const files = buildXlsx(buildReport(data), '2026-10-11T00:00:00.000Z');
const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
const out = process.argv[2] ?? 'sample.xlsx';
writeFileSync(out, zip);
console.log(`${out}: ${zip.length} байт, итого ${total / 100} ₽`);
