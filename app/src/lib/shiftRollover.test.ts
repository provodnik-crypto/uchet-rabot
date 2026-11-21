// Перенос нового из отправленной смены в смену за сегодня. Запуск: cd app && npm run test:rollover
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Draft, DraftEntry } from './draft.tsx';
import { unsentPart, type ServerEntry } from './shiftRollover.ts';

const entry = (key: string, req: string | null, price: number | null, qty: string, custom?: string): DraftEntry => ({
  key, requestNumber: req, departmentId: 1, departmentName: 'Отдел', priceItemId: price, customName: custom ?? null,
  name: custom ?? `Работа ${price}`, category: null, unitId: 1, unitCode: 'шт', integerOnly: false, quantity: qty,
  note: '', performerIds: [1], performerNames: ['Мастер М.'],
});
const server = (req: string | null, price: number | null, qty: number, custom?: string): ServerEntry => ({
  request_number: req, department_id: 1, price_item_id: price, is_custom: !price, name: custom ?? `Работа ${price}`, quantity: qty,
});

test('вчера отправлено 2 работы, сегодня добавлены 2 — переносятся только новые и прибавка времени', () => {
  const draft: Draft = {
    clientUuid: 'u', workDate: '2026-10-19', editing: true,
    entries: [entry('a', 'R1', 10, '2'), entry('b', 'R1', 11, '1,5'), entry('c', 'R2', 10, '2'), entry('d', 'R2', null, '2', 'Ремонт розеток')],
    requests: [{ number: 'R1', minutes: 60, status: 'done' }, { number: 'R2', minutes: 120, status: 'done' }],
  };
  const part = unsentPart(draft, [server('R1', 10, 2), server('R1', 11, 1.5)], [{ request_number: 'R1', minutes: 60 }]);
  assert.deepEqual(part.entries.map((e) => e.key), ['c', 'd']);
  assert.deepEqual(part.requests, [{ number: 'R2', minutes: 120, status: 'done' }]);
});

test('ничего нового — пусто (черновик просто убирается)', () => {
  const draft: Draft = { clientUuid: 'u', workDate: '2026-10-19', editing: true, entries: [entry('a', 'R1', 10, '2')], requests: [{ number: 'R1', minutes: 60, status: 'done' }] };
  const part = unsentPart(draft, [server('R1', 10, 2)], [{ request_number: 'R1', minutes: 60 }]);
  assert.equal(part.entries.length + part.requests.length, 0);
});

test('одинаковые работы считаются поштучно; добавленное время по заявке без новых работ переносится', () => {
  const draft: Draft = {
    clientUuid: 'u', workDate: '2026-10-19', editing: true,
    entries: [entry('a', 'R1', 10, '1'), entry('b', 'R1', 10, '1')],
    requests: [{ number: 'R1', minutes: 90, status: 'done' }],
  };
  const part = unsentPart(draft, [server('R1', 10, 1)], [{ request_number: 'R1', minutes: 60 }]);
  assert.deepEqual(part.entries.map((e) => e.key), ['b']);
  assert.deepEqual(part.requests, [{ number: 'R1', minutes: 30, status: 'done' }]);
});
