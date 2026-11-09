import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  categoryOrderInput,
  orderedCategories,
  getCategories,
  saveCategoryOrder,
} from '../../src/ordering/categories.js';
import { mountPublicOrdering, mountOrderingAdmin } from '../../src/ordering/routes.js';

const menu = [
  { category: 'ของหวาน' },
  { category: 'เนื้อสัตว์' },
  { category: 'อาหารทะเล' },
  { category: 'เนื้อสัตว์' },
];
function database() {
  const positions = [],
    audits = [];
  const db = {
    orderingMenuItem: { findMany: async () => menu },
    orderingCategory: {
      findMany: async () => positions,
      upsert: async ({ create, update, where }) => {
        const row = positions.find((row) => row.name === where.name);
        if (row) Object.assign(row, update);
        else positions.push(create);
      },
    },
    auditLog: { create: async ({ data }) => audits.push(data) },
    $transaction: async (work) => work(db),
  };
  return { db, positions, audits };
}

test('category ordering persists globally, deduplicates zones and appends new categories', async () => {
  const { db, positions, audits } = database();
  assert.deepEqual(await getCategories(db), orderedCategories(menu, []));
  const names = ['เนื้อสัตว์', 'อาหารทะเล', 'ของหวาน'];
  await saveCategoryOrder(db, names, 'admin-1');
  assert.deepEqual(await getCategories(db), names);
  assert.deepEqual(
    positions.map((row) => row.sortOrder),
    [0, 1, 2],
  );
  assert.equal(audits[0].actor, 'admin-1');
  assert.deepEqual(orderedCategories([...menu, { category: 'ผัก' }], positions), [...names, 'ผัก']);
});

test('category reorder rejects duplicates, unknown categories and stale partial lists', async () => {
  for (const categories of [['หมู', ' หมู '], [''], ['a'.repeat(81)]])
    assert.equal(categoryOrderInput.safeParse({ categories }).success, false);
  const { db, positions, audits } = database();
  for (const names of [['เนื้อสัตว์'], ['เนื้อสัตว์', 'อาหารทะเล', 'ชื่อปลอม']])
    await assert.rejects(saveCategoryOrder(db, names, 'admin'), { orderingStatus: 409 });
  assert.deepEqual(positions, []);
  assert.deepEqual(audits, []);
});

test('public menu returns configured order filtered to visible menu categories only', async () => {
  let handler, response;
  const { db, positions } = database();
  positions.push(
    { name: 'เนื้อสัตว์', sortOrder: 0 },
    { name: 'อาหารทะเล', sortOrder: 1 },
    { name: 'ของหวาน', sortOrder: 2 },
  );
  db.diningTable = {
    findUnique: async () => ({
      number: 3,
      sessionId: 'session',
      orderingEnabled: true,
      zones: ['standard'],
    }),
  };
  db.orderingMenuItem.findMany = async ({ where }) => {
    assert.deepEqual(where, { active: true });
    return [
      { id: 'dessert', category: 'ของหวาน', zone: 'standard' },
      { id: 'meat', category: 'เนื้อสัตว์', zone: 'standard' },
      { id: 'hidden', category: 'อาหารทะเล', zone: 'premium' },
    ];
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
      json(value) {
        response = value;
      },
    },
    (error) => {
      throw error;
    },
  );
  assert.deepEqual(response.categories, ['เนื้อสัตว์', 'ของหวาน']);
  assert.equal(response.menu.length, 2);
});

test('admin category API validates input and uses the authenticated admin for its audit', async () => {
  const routes = new Map();
  const { db, audits } = database();
  mountOrderingAdmin(
    {
      get() {},
      post() {},
      delete() {},
      put(path, ...handlers) {
        routes.set(path, handlers.at(-1));
      },
    },
    db,
    { origin: 'https://example.com' },
  );
  let status = 200,
    response;
  const res = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      response = value;
      return this;
    },
  };
  const handler = routes.get('/api/admin/ordering-categories');
  await handler(
    { admin: { id: 'admin-2' }, body: { categories: ['เนื้อสัตว์', 'เนื้อสัตว์'] } },
    res,
    (error) => {
      throw error;
    },
  );
  assert.equal(status, 400);
  await handler(
    { admin: { id: 'admin-2' }, body: { categories: ['เนื้อสัตว์', 'อาหารทะเล', 'ของหวาน'] } },
    res,
    (error) => {
      throw error;
    },
  );
  assert.deepEqual(response, ['เนื้อสัตว์', 'อาหารทะเล', 'ของหวาน']);
  assert.equal(audits[0].actor, 'admin-2');
});
