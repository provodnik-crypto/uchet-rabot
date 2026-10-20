// Распознавание ошибок и очистка текста для журнала. Запуск: cd app && npm run test:errors
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorKind, sanitize } from './errorText.ts';

test('нет связи и долгий ответ', () => {
  assert.equal(errorKind({ message: 'TypeError: Network request failed', code: '' }), 'network');
  assert.equal(errorKind(new Error('Timeout: server did not respond')), 'timeout');
  assert.equal(errorKind({ message: 'TimeoutError: Timeout: server did not respond', code: '' }), 'timeout');
});

test('идёт обновление базы или сервера', () => {
  assert.equal(errorKind({ message: 'Could not find the function public.x(p) in the schema cache', code: 'PGRST202' }), 'updating');
  assert.equal(errorKind({ message: 'function public.x() does not exist', code: '42883' }), 'updating');
  assert.equal(errorKind({ message: '<html><body>503 Service Unavailable</body></html>', code: '' }), 'updating');
});

test('отказы с понятным текстом — не сбой', () => {
  assert.equal(errorKind({ message: 'Заявку уже взял другой мастер', code: 'P0001' }), 'user');
  assert.equal(errorKind(new Error('Invalid login credentials')), 'user');
  assert.equal(errorKind({ message: 'permission denied for table x', code: '42501' }), 'other');
});

test('из журнала убираются почты, номера и значения полей', () => {
  assert.equal(sanitize('user ivan@uchet.local failed'), 'user <почта> failed');
  assert.equal(sanitize('call +7 (900) 000-00-00 now'), 'call +<число> now');
  assert.equal(sanitize('Key (login)=(ivan) already exists'), 'Key (login)=(…) already exists');
  assert.equal(sanitize('x'.repeat(400)).length, 300);
});
