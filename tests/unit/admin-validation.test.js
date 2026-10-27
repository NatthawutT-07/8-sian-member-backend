import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminLogin, campaignInput, resetInput } from '../../src/modules/admin/admin.validation.js';
test('campaign validates price, content and bounded expiry', () => {
  const valid = {
    title: 'ทะเล +79',
    description: 'กินทะเลไม่อั้น',
    extraPrice: 79,
    validityDays: 30,
  };
  assert.equal(campaignInput.safeParse(valid).success, true);
  for (const extraPrice of [-100000, -20, -1, 0, 79, 100000])
    assert.equal(campaignInput.parse({ ...valid, extraPrice }).extraPrice, extraPrice);
  for (const change of [
    { title: ' ' },
    { validityDays: 0 },
    { validityDays: 366 },
    { extraPrice: -100001 },
    { extraPrice: 100001 },
    { extraPrice: -1.5 },
    { extraPrice: 1.5 },
  ])
    assert.equal(campaignInput.safeParse({ ...valid, ...change }).success, false);
});
test('password help requires reason and admin confirmation', () => {
  const valid = {
    newPassword: 'new-password',
    adminPassword: 'admin-password',
    reason: 'ยืนยันตัวตนที่ร้านแล้ว',
  };
  assert.equal(resetInput.safeParse(valid).success, true);
  for (const change of [{ newPassword: '123' }, { adminPassword: '' }, { reason: '' }])
    assert.equal(resetInput.safeParse({ ...valid, ...change }).success, false);
});
test('role supplied by browser does not become an authority', () => {
  const data = adminLogin.parse({ username: 'admin', password: 'password', role: 'ADMIN' });
  assert.equal(data.role, undefined);
});
