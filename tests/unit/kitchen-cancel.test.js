import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelKitchenOrder, mountKitchen } from '../../src/ordering/kitchen.js';
import express from 'express';
import { mountPos } from '../../src/pos/routes.js';

const sessionId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
function fixture(overrides = {}) {
  const order = { id: 'order', tableId: 'table', sessionId, status: 'NEW',
    requestHash: 'original-hash', items: [
      { menuItemId: itemId, name: 'กุ้งสด', quantity: 4 },
      { menuItemId: 'other', name: 'หมู', quantity: 2 },
    ], ...overrides };
  const audit = [];
  const tx = {
    tableOrder: {
      findUnique: async () => order,
      updateMany: async ({ data }) => { Object.assign(order, data); return { count: 1 }; },
    },
    diningTable: { updateMany: async () => ({ count: 1 }) },
    auditLog: { create: async ({ data }) => audit.push(data) },
  };
  return { order, audit, tx, db: { $transaction: (fn, options) => {
    assert.equal(options.isolationLevel, 'Serializable'); return fn(tx);
  } } };
}
test('chef cancels one line; remaining quantities, retry hash and audit stay correct', async () => {
  const f = fixture();
  await cancelKitchenOrder(f.db, 'order', { sessionId, menuItemId: itemId }, 'chef');
  assert.equal(f.order.status, 'NEW');
  assert.deepEqual(f.order.items, [{ menuItemId: 'other', name: 'หมู', quantity: 2 }]);
  assert.equal(f.order.requestHash, 'original-hash');
  assert.equal(f.audit[0].actor, 'chef');
  assert.equal(f.audit[0].details.removedItems[0].quantity, 4);
  await assert.rejects(cancelKitchenOrder(f.db, 'order', { sessionId, menuItemId: itemId }, 'chef'), { orderingStatus: 409 });
  assert.equal(f.audit.length, 1);
});
test('whole order and last remaining line become CANCELLED with original data retained', async () => {
  for (const data of [{ sessionId }, { sessionId, menuItemId: itemId }]) {
    const f = fixture({ items: [{ menuItemId: itemId, name: 'กุ้ง', quantity: 4 }] });
    await cancelKitchenOrder(f.db, 'order', data, 'chef');
    assert.equal(f.order.status, 'CANCELLED');
    assert.equal(f.order.items[0].quantity, 4);
    assert.equal(f.audit.length, 1);
  }
});
test('done, cancelled, old rounds, missing lines and closed tables cannot be changed', async () => {
  for (const overrides of [{ status: 'DONE' }, { status: 'CANCELLED' }, { sessionId: 'old' }]) {
    const f = fixture(overrides);
    await assert.rejects(cancelKitchenOrder(f.db, 'order', { sessionId }, 'chef'), { orderingStatus: 409 });
    assert.equal(f.audit.length, 0);
  }
  const f = fixture();
  f.tx.diningTable.updateMany = async () => ({ count: 0 });
  await assert.rejects(cancelKitchenOrder(f.db, 'order', { sessionId }, 'chef'), { orderingStatus: 409 });
  assert.equal(f.order.status, 'NEW');
});
test('cancellation endpoint rejects malformed or additional fields before database access', async () => {
  let handler;
  mountKitchen({ get() {}, post(path, fn) { if (path.endsWith('/cancel')) handler = fn; } }, {}, (fn) => fn);
  for (const body of [{}, { sessionId, menuItemId: 'invalid' }, { sessionId, status: 'DONE' }]) {
    let status;
    await handler({ body }, { status(value) { status = value; return this; }, json() {} });
    assert.equal(status, 400);
  }
});

test('CHEF can cancel through authenticated POS API but still cannot close tables', async () => {
  const f = fixture();
  const db = { ...f.db, posSession: { findUnique: async () => ({
    expiresAt: new Date(Date.now() + 60000),
    user: { id: 'chef', active: true, role: 'CHEF' },
  }) } };
  const app = express();
  app.use(express.json());
  await mountPos(app, db, { cookieOptions: { path: '/' } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/pos`;
  try {
    const call = (route, body, cookie = 'pos_session=test') => fetch(`${base}/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify(body),
    });
    assert.equal((await call('kitchen/orders/order/cancel', { sessionId }, '')).status, 401);
    assert.equal((await call('tables/table/close', { sessionId })).status, 403);
    assert.equal((await call('kitchen/orders/order/cancel', { sessionId, menuItemId: itemId })).status, 200);
    assert.equal(f.order.items.length, 1);
    assert.equal(f.audit[0].actor, 'chef');
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
