import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminMemberInput,
  profileInput,
  mountAdminManagement,
} from '../../src/modules/admin/admin-management.routes.js';

test('admin accepts phone-only, blank and null profiles but validates supplied fields', () => {
  for (const input of [
    {},
    { firstName: null, lastName: '', phone: null, birthDate: '' },
    { phone: '0812345678' },
  ]) {
    const data = adminMemberInput.parse(input);
    assert.equal(data.firstName, '');
    assert.equal(data.lastName, '');
    assert.equal(data.birthDate, null);
    assert.equal(data.password, null);
    assert.equal(profileInput.parse(input).firstName, '');
  }
  for (const input of [
    { phone: '123' },
    { firstName: '<script>' },
    { birthDate: '2026-02-30' },
    { password: '123' },
  ])
    assert.equal(adminMemberInput.safeParse(input).success, false);
});

test('admin saves phone-only member without password and can clear an existing profile', async () => {
  const routes = new Map();
  const app = Object.fromEntries(
    ['post', 'put', 'delete'].map((method) => [
      method,
      (path, handler) => routes.set(`${method} ${path}`, handler),
    ]),
  );
  let saved;
  let sessionsCleared = false;
  const tx = {
    member: {
      create: async ({ data }) => (saved = { id: 'member', ...data }),
      findUnique: async () => ({ id: 'member', phone: '0812345678' }),
      update: async ({ data }) => (saved = { id: 'member', ...data }),
    },
    auditLog: { create: async () => ({}) },
    session: {
      deleteMany: async () => {
        sessionsCleared = true;
      },
    },
  };
  mountAdminManagement(app, { $transaction: (operation) => operation(tx) });
  const res = {
    json() {},
    status() {
      return this;
    },
  };
  const fail = (error) => {
    throw error;
  };
  await routes.get('post /api/admin/members')(
    { body: { phone: '0812345678' }, admin: { id: 'admin' } },
    res,
    fail,
  );
  assert.equal(saved.phone, '0812345678');
  assert.equal(saved.firstName, '');
  assert.equal(saved.passwordHash, null);
  assert.equal(saved.birthDate, null);
  assert.equal(saved.privacyVersion, 'not-recorded');
  await routes.get('put /api/admin/members/:id')(
    {
      body: { firstName: null, lastName: '', phone: '', birthDate: null, reason: '' },
      params: { id: 'member' },
      admin: { id: 'admin' },
    },
    res,
    fail,
  );
  assert.equal(saved.phone, null);
  assert.equal(saved.firstName, '');
  assert.equal(saved.loyaltyQrHash, null);
  assert.equal(sessionsCleared, true);
});
