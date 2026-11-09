import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  productOrderInput,
  saveProductOrder,
  productOrderBy,
} from '../../src/pos/product-order.js';
import { mountPosAdmin } from '../../src/pos/admin.routes.js';

const products = [
  { id: randomUUID(), active: true },
  { id: randomUUID(), active: false },
];
test('product order accepts known groups and rejects duplicate or malformed product identifiers', () => {
  for (const group of ['MAIN', 'DISCOUNT', 'PROMOTION'])
    assert.equal(
      productOrderInput.safeParse({ group, productIds: products.map((x) => x.id) }).success,
      true,
    );
  for (const data of [
    { group: 'OTHER', productIds: products.map((x) => x.id) },
    { group: 'MAIN', productIds: [] },
    { group: 'MAIN', productIds: [products[0].id, products[0].id] },
    { group: 'MAIN', productIds: ['invalid'] },
  ])
    assert.equal(productOrderInput.safeParse(data).success, false);
});

test('product order includes stopped products, affects positions only and audits the admin', async () => {
  const updates = [],
    audits = [];
  const tx = {
    posProduct: {
      findMany: async ({ where }) => {
        assert.deepEqual(where, { group: 'MAIN' });
        return products;
      },
      update: async (data) => updates.push(data),
    },
    auditLog: { create: async ({ data }) => audits.push(data) },
  };
  await saveProductOrder(
    { $transaction: (fn) => fn(tx) },
    { group: 'MAIN', productIds: [products[1].id, products[0].id] },
    'admin-1',
  );
  assert.deepEqual(updates, [
    { where: { id: products[1].id }, data: { sortOrder: 1 } },
    { where: { id: products[0].id }, data: { sortOrder: 2 } },
  ]);
  assert.equal(audits[0].actor, 'admin-1');
  assert.equal(audits[0].action, 'POS_PRODUCTS_REORDERED');
});

test('stale or cross-group product order never modifies positions', async () => {
  const tx = {
    posProduct: { findMany: async () => products, update: () => assert.fail('must not modify') },
  };
  for (const productIds of [[products[0].id], [products[0].id, randomUUID()]])
    await assert.rejects(
      saveProductOrder({ $transaction: (fn) => fn(tx) }, { group: 'MAIN', productIds }, 'admin'),
      { status: 409 },
    );
});

test('admin product catalog queries saved positions and reorder endpoint rejects invalid inputs', async () => {
  const routes = new Map();
  const db = {
    posProduct: {
      findMany: async ({ orderBy }) => {
        assert.deepEqual(orderBy, productOrderBy);
        return [products[1], products[0]];
      },
    },
  };
  mountPosAdmin(
    {
      get(path, fn) {
        routes.set('GET ' + path, fn);
      },
      put(path, fn) {
        routes.set('PUT ' + path, fn);
      },
      post() {},
      patch() {},
    },
    db,
  );
  let result, status;
  const res = {
    json(data) {
      result = data;
      return this;
    },
    status(code) {
      status = code;
      return this;
    },
  };
  await routes.get('GET /api/admin/pos/products')({}, res);
  assert.deepEqual(
    result.map((x) => x.id),
    [products[1].id, products[0].id],
  );
  await routes.get('PUT /api/admin/pos/product-order')(
    { body: { group: 'OTHER', productIds: [] } },
    res,
  );
  assert.equal(status, 400);
});
