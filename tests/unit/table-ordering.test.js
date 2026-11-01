import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  orderInput,
  orderHash,
  submitOrder,
  activateTable,
  openPaidTable,
} from '../../src/ordering/service.js';

const token = randomUUID(),
  sessionId = randomUUID(),
  menuItemId = randomUUID();
const data = { key: randomUUID(), sessionId, items: [{ menuItemId, quantity: 2 }] };
const transaction = (tx) => ({ $transaction: (fn) => fn(tx) });
test('ordering validates quantities, item IDs, unique lines and forbids client names/prices', () => {
  assert.equal(orderInput.safeParse(data).success, true);
  assert.equal(
    orderInput.safeParse({ ...data, items: [{ menuItemId, quantity: 10 }] }).success,
    true,
  );
  for (const items of [
    [],
    [{ menuItemId, quantity: 0 }],
    [{ menuItemId, quantity: 11 }],
    [{ menuItemId, quantity: 1.5 }],
    [...data.items, ...data.items],
    [{ menuItemId, quantity: 1, name: 'forged' }],
  ])
    assert.equal(orderInput.safeParse({ ...data, items }).success, false);
  assert.equal(orderInput.safeParse({ ...data, zones: ['ทะเล'] }).success, false);
});
test('closed, not-yet-activated and previous customer rounds cannot order', async () => {
  for (const table of [
    null,
    { sessionId: null },
    { sessionId, orderingEnabled: false },
    { sessionId: randomUUID(), orderingEnabled: true },
  ]) {
    const tx = {
      tableOrder: { findUnique: async () => null },
      diningTable: { findUnique: async () => table },
    };
    await assert.rejects(submitOrder(transaction(tx), token, data), { orderingStatus: 403 });
  }
});
test('server refuses a forged item from a zone not granted to the table', async () => {
  const tx = {
    tableOrder: { findUnique: async () => null, create: () => assert.fail('must not create') },
    diningTable: {
      findUnique: async () => ({
        id: 'table',
        sessionId,
        orderingEnabled: true,
        version: 1,
        zones: ['เนื้อสัตว์'],
      }),
      updateMany: async () => ({ count: 1 }),
    },
    orderingMenuItem: { findMany: async () => [{ id: menuItemId, zone: 'ทะเล' }] },
  };
  await assert.rejects(submitOrder(transaction(tx), token, data), { orderingStatus: 403 });
});
test('order retries return acknowledgement only and cannot change table, round or quantity', async () => {
  const tx = { tableOrder: { findUnique: async () => ({ requestHash: orderHash(data, token) }) } };
  assert.deepEqual(await submitOrder(transaction(tx), token, data), { ok: true });
  await assert.rejects(submitOrder(transaction(tx), randomUUID(), data), { orderingStatus: 409 });
  await assert.rejects(submitOrder(transaction(tx), token, { ...data, sessionId: randomUUID() }), {
    orderingStatus: 409,
  });
});

test('cancelled orders cannot be retried after staff close the table', async () => {
  const tx = {
    tableOrder: {
      findUnique: async () => ({ requestHash: orderHash(data, token), status: 'CANCELLED' }),
    },
  };
  await assert.rejects(submitOrder(transaction(tx), token, data), { orderingStatus: 403 });
});
test('paid rounds remain locked until zone confirmation; empty or multiple zones are supported', async () => {
  let updated;
  const tx = {
    diningTable: {
      findUnique: async () => ({ id: 'table', number: 1, sessionId: null, version: 0 }),
      updateMany: async ({ data }) => {
        updated = data;
        return { count: 1 };
      },
    },
  };
  const opened = await openPaidTable(tx, 'table', 'cashier');
  assert.ok(opened.sessionId);
  assert.equal(updated.orderingEnabled, false);
  assert.deepEqual(updated.zones, []);
  tx.diningTable.findUnique = async () => ({
    id: 'table',
    sessionId,
    version: 1,
    orderingEnabled: false,
  });
  tx.orderingMenuItem = { findMany: async () => [{ zone: 'เนื้อสัตว์' }, { zone: 'ทะเล' }] };
  tx.auditLog = { create: async () => {} };
  for (const zones of [[], ['เนื้อสัตว์', 'ทะเล']]) {
    assert.deepEqual(await activateTable(transaction(tx), 'table', sessionId, zones, 'cashier'), {
      ok: true,
    });
    assert.equal(updated.orderingEnabled, true);
    assert.deepEqual(updated.zones, [...zones].sort());
  }
});
