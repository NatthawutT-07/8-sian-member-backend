import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { itemOrderInput, saveItemOrder, menuOrderBy } from '../../src/ordering/item-order.js';
import { mountPublicOrdering } from '../../src/ordering/routes.js';

const items = [
  { id: randomUUID(), name: 'กุ้ง', category: 'ทะเล', zone: 'ปกติ' },
  { id: randomUUID(), name: 'ปลา', category: 'ทะเล', zone: 'พิเศษ' },
];
test('item ordering validates category and unique complete item identifiers', () => {
  assert.equal(
    itemOrderInput.safeParse({ category: 'ทะเล', itemIds: items.map((x) => x.id) }).success,
    true,
  );
  for (const itemIds of [[], [items[0].id, items[0].id], ['invalid']])
    assert.equal(itemOrderInput.safeParse({ category: 'ทะเล', itemIds }).success, false);
});

test('reorder persists positions across zones and audits the authenticated admin', async () => {
  const updates = [],
    audits = [];
  const tx = {
    orderingMenuItem: {
      findMany: async ({ where }) => {
        assert.deepEqual(where, { category: 'ทะเล' });
        return items;
      },
      update: async (data) => updates.push(data),
    },
    auditLog: { create: async ({ data }) => audits.push(data) },
  };
  const db = { $transaction: (fn) => fn(tx) };
  const data = { category: 'ทะเล', itemIds: [items[1].id, items[0].id] };
  assert.deepEqual(await saveItemOrder(db, data, 'admin-1'), { ok: true });
  assert.deepEqual(
    updates.map((x) => [x.where.id, x.data.sortOrder]),
    [
      [items[1].id, 1],
      [items[0].id, 2],
    ],
  );
  assert.equal(audits[0].actor, 'admin-1');
  assert.deepEqual(audits[0].details, data);
});

test('stale, partial or cross-category reorder is rejected without modifying positions', async () => {
  const tx = {
    orderingMenuItem: { findMany: async () => items, update: () => assert.fail('must not update') },
  };
  for (const itemIds of [[items[0].id], [items[0].id, randomUUID()]])
    await assert.rejects(
      saveItemOrder({ $transaction: (fn) => fn(tx) }, { category: 'ทะเล', itemIds }, 'admin'),
      { orderingStatus: 409 },
    );
});

test('customer API uses saved ordering without exposing ranking numbers', async () => {
  let handler, response;
  const db = {
    diningTable: {
      findUnique: async () => ({
        number: 1,
        sessionId: 'session',
        orderingEnabled: true,
        qrExpiresAt: new Date(Date.now() + 7200000),
        zones: ['ปกติ', 'พิเศษ'],
      }),
    },
    orderingMenuItem: {
      findMany: async ({ orderBy, select }) => {
        assert.deepEqual(orderBy, menuOrderBy);
        assert.equal(select.sortOrder, undefined);
        return [items[1], items[0]];
      },
    },
    orderingCategory: { findMany: async () => [] },
  };
  mountPublicOrdering(
    {
      use() {},
      post() {},
      get(path, fn) {
        if (path === '/api/ordering/:token') handler = fn;
      },
    },
    db,
  );
  await handler(
    { params: { token: randomUUID() } },
    {
      json(data) {
        response = data;
      },
    },
    (error) => {
      throw error;
    },
  );
  assert.deepEqual(
    response.menu.map((x) => x.id),
    [items[1].id, items[0].id],
  );
  assert.equal(
    response.menu.some((x) => 'sortOrder' in x),
    false,
  );
});
