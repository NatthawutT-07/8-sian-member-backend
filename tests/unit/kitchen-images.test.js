import test from 'node:test';
import assert from 'node:assert/strict';
import { withKitchenImages } from '../../src/ordering/kitchen.js';

test('kitchen images use one metadata query and preserve historical order names and quantities', async () => {
  let calls = 0;
  const db = { orderingMenuItem: { findMany: async input => {
    calls++;
    assert.deepEqual(input.select, { id: true, imageVersion: true });
    assert.deepEqual(input.where.id.in, ['a', 'deleted', 'no-photo']);
    return [{ id: 'a', imageVersion: 'v2' }, { id: 'no-photo', imageVersion: null }];
  } } };
  const orders = [{ id: 'order', items: [
    { menuItemId: 'a', name: 'Original name', quantity: 3 },
    { menuItemId: 'a', name: 'Original name', quantity: 1 },
    { menuItemId: 'deleted', name: 'Deleted item', quantity: 2 },
    { menuItemId: 'no-photo', name: 'No photo', quantity: 1 },
  ] }];
  const result = await withKitchenImages(db, orders, 'https://api.example.com');
  assert.equal(calls, 1);
  assert.equal(result[0].items[0].imageUrl, 'https://api.example.com/api/ordering-images/a/v2');
  assert.equal(result[0].items[0].name, 'Original name');
  assert.equal(result[0].items[0].quantity, 3);
  assert.equal(result[0].items[2].imageUrl, null);
  assert.equal(result[0].items[3].imageUrl, null);
  assert.equal(orders[0].items[0].imageUrl, undefined);
  assert.deepEqual(await withKitchenImages(db, [], 'https://api.example.com'), []);
  assert.equal(calls, 1);
});
