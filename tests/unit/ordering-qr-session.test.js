import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openPaidTable, activateTable, closeTable } from '../../src/ordering/service.js';
import { requireActiveQr, qrHoursInput, presentTableQr } from '../../src/ordering/qr-session.js';
import { mountPublicOrdering, mountOrderingAdmin } from '../../src/ordering/routes.js';

test('QR lifetime validates whole hours and expires at the exact deadline', () => {
  for (const hours of [1, 2, 168]) assert.equal(qrHoursInput.safeParse(hours).success, true);
  for (const hours of [0, -1, 1.5, 169, '2'])
    assert.equal(qrHoursInput.safeParse(hours).success, false);
  const now = new Date();
  const table = { sessionId: randomUUID(), orderingEnabled: true, qrExpiresAt: new Date(+now + 1) };
  assert.equal(requireActiveQr(table, now), table);
  assert.throws(() => requireActiveQr(table, new Date(+now + 1)), { orderingStatus: 403 });
  assert.throws(() => requireActiveQr({ ...table, qrExpiresAt: null }, now), {
    orderingStatus: 403,
  });
  assert.throws(() => requireActiveQr({ ...table, qrExpiresAt: 'invalid' }, now), {
    orderingStatus: 403,
  });
  assert.equal(presentTableQr({ ...table, qrToken: null }, 'https://example.com').url, null);
});

test('each paid round gets a fresh token; activation starts two hours, retry cannot extend, close revokes it', async () => {
  let row = {
    id: randomUUID(),
    number: 1,
    sessionId: null,
    qrToken: null,
    qrDurationHours: 2,
    qrExpiresAt: null,
    orderingEnabled: false,
    version: 0,
    zones: [],
  };
  const tx = {
    diningTable: {
      findUnique: async () => ({ ...row }),
      updateMany: async ({ where, data }) => {
        if (Object.hasOwn(where, 'sessionId') && where.sessionId !== row.sessionId)
          return { count: 0 };
        if (Object.hasOwn(where, 'version') && where.version !== row.version) return { count: 0 };
        row = { ...row, ...data, version: row.version + (data.version?.increment || 0) };
        return { count: 1 };
      },
    },
    orderingMenuItem: { findMany: async () => [{ zone: 'main' }] },
    tableOrder: { updateMany: async () => ({ count: 0 }) },
    auditLog: { create: async () => {} },
  };
  const db = { $transaction: (fn) => fn(tx) };
  await openPaidTable(tx, row.id, 'cashier');
  const firstToken = row.qrToken,
    firstSession = row.sessionId;
  assert.ok(firstToken);
  assert.equal(row.qrExpiresAt, null);
  await activateTable(db, row.id, row.sessionId, ['main'], 'cashier');
  assert.ok(Math.abs(+row.qrExpiresAt - Date.now() - 7200000) < 2000);
  const firstExpiry = +row.qrExpiresAt;
  await activateTable(db, row.id, row.sessionId, ['main'], 'cashier', 5);
  assert.equal(+row.qrExpiresAt, firstExpiry);
  assert.equal(row.qrToken, firstToken);
  row.qrExpiresAt = new Date(0);
  await assert.rejects(activateTable(db, row.id, row.sessionId, ['main'], 'cashier', 5), {
    orderingStatus: 403,
  });
  await closeTable(db, row.id, row.sessionId, 'cashier');
  assert.equal(row.qrToken, null);
  assert.equal(row.qrExpiresAt, null);
  await openPaidTable(tx, row.id, 'cashier');
  assert.notEqual(row.qrToken, firstToken);
  assert.notEqual(row.sessionId, firstSession);
  await activateTable(db, row.id, row.sessionId, ['main'], 'cashier', 3);
  assert.ok(Math.abs(+row.qrExpiresAt - Date.now() - 10800000) < 2000);
});

test('orders do not require GPS, but all endpoints and saved retries reject an expired QR', async () => {
  const token = randomUUID(),
    sessionId = randomUUID(),
    id = randomUUID();
  let saved = null,
    writes = 0;
  const table = {
    id: randomUUID(),
    number: 1,
    qrToken: token,
    sessionId,
    orderingEnabled: true,
    qrExpiresAt: new Date(Date.now() + 7200000),
    zones: ['main'],
    version: 0,
  };
  const tx = {
    diningTable: { findUnique: async () => table, updateMany: async () => ({ count: 1 }) },
    tableOrder: {
      findUnique: async () => saved,
      create: async ({ data }) => {
        saved = data;
        writes++;
      },
    },
    orderingMenuItem: {
      findMany: async () => [{ id, name: 'หมู', zone: 'main', category: 'หมู' }],
    },
    orderingCategory: { findMany: async () => [] },
  };
  const db = { ...tx, $transaction: (fn) => fn(tx) },
    routes = new Map();
  mountPublicOrdering(
    {
      use() {},
      get(path, fn) {
        routes.set(path, fn);
      },
      post(path, ...handlers) {
        routes.set(path, handlers.at(-1));
      },
    },
    db,
  );
  const body = { key: randomUUID(), sessionId, items: [{ menuItemId: id, quantity: 1 }] };
  const call = async (path, data = body) => {
    let status = 200,
      result;
    await routes.get(path)(
      { params: { token }, body: data },
      {
        set() {},
        status(code) {
          status = code;
          return this;
        },
        json(value) {
          result = value;
        },
      },
      (error) => {
        throw error;
      },
    );
    return { status, result };
  };
  assert.equal((await call('/api/ordering/:token/orders')).status, 200);
  assert.equal(writes, 1);
  // Legacy location fields are ignored too, including coordinates outside the shop.
  assert.equal(
    (
      await call('/api/ordering/:token/orders', {
        ...body,
        location: { latitude: 0, longitude: 0 },
      })
    ).status,
    200,
  );
  table.qrExpiresAt = new Date(0);
  for (const path of [
    '/api/ordering/:token',
    '/api/ordering/:token/status',
    '/api/ordering/:token/orders',
  ])
    assert.equal((await call(path)).status, 403);
  assert.equal(writes, 1);
});

test('admin lifetime setting affects the next round only and cannot revive an expired QR', async () => {
  const table = {
    id: randomUUID(),
    number: 1,
    sessionId: randomUUID(),
    qrToken: randomUUID(),
    orderingEnabled: true,
    qrExpiresAt: new Date(0),
    qrDurationHours: 2,
  };
  let handler;
  const tx = {
    diningTable: {
      update: async ({ data }) => {
        assert.deepEqual(data, { qrDurationHours: 5 });
        return { ...table, ...data };
      },
    },
    auditLog: { create: async () => {} },
  };
  mountOrderingAdmin(
    {
      get() {},
      post() {},
      delete() {},
      put(path, ...handlers) {
        if (path.endsWith('/dining-tables/:id/settings')) handler = handlers.at(-1);
      },
    },
    { $transaction: (fn) => fn(tx) },
    { origin: 'https://example.com' },
  );
  let body;
  await handler(
    { params: { id: table.id }, admin: { id: 'admin' }, body: { qrHours: 5 } },
    {
      json(data) {
        body = data;
      },
    },
    (error) => {
      throw error;
    },
  );
  assert.equal(body.url, null);
  assert.equal(+body.qrExpiresAt, 0);
  assert.equal(body.qrDurationHours, 5);
});
