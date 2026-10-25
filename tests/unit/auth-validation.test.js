import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registration } from '../../src/modules/auth/auth.validation.js';
const valid = {
  firstName: 'สมชาย',
  lastName: 'ใจดี',
  phone: '0812345678',
  birthDate: '1995-02-28',
  password: 'test-password',
  privacyConsent: true,
};
test('accepts registration and normalizes names', () => {
  assert.equal(registration.parse({ ...valid, firstName: ' สมชาย ' }).firstName, 'สมชาย');
});
test('rejects missing consent and invalid mobile', () => {
  for (const patch of [{ privacyConsent: false }, { phone: '123' }, { firstName: ' ' }])
    assert.equal(registration.safeParse({ ...valid, ...patch }).success, false);
});
test('rejects weak passwords', () => {
  for (const patch of [{ password: '1234' }, { password: 'x'.repeat(129) }])
    assert.equal(registration.safeParse({ ...valid, ...patch }).success, false);
});
test('requires real birthday within allowed range', () => {
  for (const birthDate of [
    '',
    '2025-02-29',
    '2000-02-30',
    '2100-01-01',
    '1899-12-31',
    'not-a-date',
  ])
    assert.equal(registration.safeParse({ ...valid, birthDate }).success, false);
  assert.equal(registration.safeParse({ ...valid, birthDate: '2000-02-29' }).success, true);
});
test('rejects markup, controls, excessive lengths and non-name values', () => {
  for (const firstName of [
    '<script>alert(1)</script>',
    'สมชาย123',
    'A\u0000B',
    'A\u202eB',
    'x'.repeat(81),
    '---',
  ]) {
    assert.equal(registration.safeParse({ ...valid, firstName }).success, false);
    assert.equal(registration.safeParse({ ...valid, lastName: firstName }).success, false);
  }
  for (const firstName of ['สมชาย', 'Anne-Marie', 'O’Connor', 'Jean Luc']) {
    assert.equal(registration.safeParse({ ...valid, firstName }).success, true);
  }
  assert.equal(registration.safeParse({ ...valid, password: ' '.repeat(8) }).success, false);
  for (const phone of ['+66812345678', '08123456789', '081234567a']) {
    assert.equal(registration.safeParse({ ...valid, phone }).success, false);
  }
});
