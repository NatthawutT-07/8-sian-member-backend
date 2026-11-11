import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { orderingCatalog, invalidateOrderingMenu } from '../../src/ordering/menu-cache.js';
import { menuImage } from '../../src/ordering/image-cache.js';
import { checkOrderThrottle } from '../../src/ordering/order-throttle.js';
import { submitOrder, orderHash } from '../../src/ordering/service.js';
import { mountPublicOrdering } from '../../src/ordering/routes.js';

test('100 simultaneous menu readers share one catalog; table rights remain live and status is small', async () => {
  const expiry = new Date(Date.now() + 7200000);
  let menuReads = 0,
    categoryReads = 0,
    tableReads = 0,
    open = true;
  const db = {
    orderingMenuItem: {
      findMany: async () => {
        menuReads++;
        await new Promise((r) => setTimeout(r, 5));
        return [
          { id: 'visible', category: 'หมู', zone: 'standard' },
          { id: 'hidden', category: 'ทะเล', zone: 'premium' },
        ];
      },
    },
    orderingCategory: {
      findMany: async () => {
        categoryReads++;
        return [];
      },
    },
    diningTable: {
      findUnique: async () => {
        tableReads++;
        return {
          number: 1,
          sessionId: 'session',
          orderingEnabled: open,
          qrExpiresAt: expiry,
          zones: ['standard'],
        };
      },
    },
  };
  const routes = new Map();
  mountPublicOrdering(
    {
      use() {},
      post() {},
      get(path, fn) {
        routes.set(path, fn);
      },
    },
    db,
  );
  const token = randomUUID();
  const call = async (path) => {
    let status = 200,
      body;
    await routes.get(path)(
      { params: { token } },
      {
        status(code) {
          status = code;
          return this;
        },
        json(data) {
          body = data;
        },
      },
      (error) => {
        throw error;
      },
    );
    return { status, body };
  };
  const responses = await Promise.all(
    Array.from({ length: 100 }, () => call('/api/ordering/:token')),
  );
  assert.equal(menuReads, 1);
  assert.equal(categoryReads, 1);
  assert.equal(tableReads, 100);
  assert.ok(responses.every((r) => r.body.menu.length === 1 && r.body.menu[0].id === 'visible'));
  const status = await call('/api/ordering/:token/status');
  assert.equal(status.body.menu, undefined);
  assert.equal(status.body.menuVersion, responses[0].body.menuVersion);
  open = false;
  assert.equal((await call('/api/ordering/:token')).status, 403);
  assert.equal((await call('/api/ordering/:token/status')).status, 403);
  assert.equal(menuReads, 1);
  invalidateOrderingMenu(db);
  open = true;
  await call('/api/ordering/:token');
  assert.equal(menuReads, 2);
});

test('catalog failures are not cached and concurrent image readers share immutable bytes', async () => {
  let fail = true,
    imageReads = 0;
  const db = {
    orderingMenuItem: {
      findMany: async () => {
        if (fail) throw Error('offline');
        return [];
      },
      findFirst: async () => {
        imageReads++;
        await new Promise((r) => setTimeout(r, 5));
        return { imageData: Buffer.from('image'), imageMime: 'image/png' };
      },
    },
    orderingCategory: { findMany: async () => [] },
  };
  await assert.rejects(orderingCatalog(db), /offline/);
  fail = false;
  assert.deepEqual((await orderingCatalog(db)).menu, []);
  const images = await Promise.all(Array.from({ length: 100 }, () => menuImage(db, 'id', 'v1')));
  assert.equal(imageReads, 1);
  assert.ok(images.every((x) => x.imageData.toString() === 'image'));
  await menuImage(db, 'id', 'v2');
  assert.equal(imageReads, 2);
});

test('durable per-table throttle enforces 5 seconds and 12 new orders per minute, then resets', () => {
  const now = new Date('2026-11-10T10:00:00Z');
  const first = checkOrderThrottle({}, now);
  assert.equal(first.orderWindowCount, 1);
  assert.throws(() => checkOrderThrottle(first, new Date(+now + 1000)), {
    orderingStatus: 429,
    retryAfter: 4,
  });
  assert.equal(checkOrderThrottle(first, new Date(+now + 5000)).orderWindowCount, 2);
  const full = { ...first, lastOrderAt: new Date(+now + 50000), orderWindowCount: 12 };
  assert.throws(() => checkOrderThrottle(full, new Date(+now + 55000)), {
    orderingStatus: 429,
    retryAfter: 5,
  });
  assert.equal(checkOrderThrottle(full, new Date(+now + 60000)).orderWindowCount, 1);
});

test('acknowledging an already-saved idempotency key never consumes a new throttle slot', async () => {
  const data = {
      key: randomUUID(),
      sessionId: randomUUID(),
      items: [{ menuItemId: randomUUID(), quantity: 1 }],
    },
    token = randomUUID();
  const tx = {
    tableOrder: {
      findUnique: async () => ({ requestHash: orderHash(data, token), status: 'NEW' }),
    },
    diningTable: {
      findUnique: async () => ({
        sessionId: data.sessionId,
        orderingEnabled: true,
        qrExpiresAt: new Date(Date.now() + 7200000),
      }),
    },
  };
  assert.deepEqual(await submitOrder({ $transaction: (fn) => fn(tx) }, token, data), { ok: true });
});

test('submission returns Retry-After and creates nothing when a table sends too quickly', async () => {
  let handler, status, retry;
  const sessionId = randomUUID(),
    token = randomUUID();
  const tx = {
    tableOrder: { findUnique: async () => null, create: () => assert.fail('must not create') },
    diningTable: {
      findUnique: async () => ({
        sessionId,
        orderingEnabled: true,
        qrExpiresAt: new Date(Date.now() + 7200000),
        lastOrderAt: new Date(),
      }),
      updateMany: () => assert.fail('must not update'),
    },
  };
  mountPublicOrdering(
    {
      use() {},
      get() {},
      post(path, ...fns) {
        if (path.endsWith('/orders')) handler = fns.at(-1);
      },
    },
    { $transaction: (fn) => fn(tx) },
  );
  await handler(
    {
      params: { token },
      body: {
        key: randomUUID(),
        sessionId,
        items: [{ menuItemId: randomUUID(), quantity: 1 }],
        location: {
          latitude: 13.944698337170372,
          longitude: 100.54483398858625,
          accuracy: 10,
          timestamp: Date.now(),
        },
      },
    },
    {
      set(name, value) {
        if (name === 'Retry-After') retry = Number(value);
      },
      status(code) {
        status = code;
        return this;
      },
      json() {},
    },
    (error) => {
      throw error;
    },
  );
  assert.equal(status, 429);
  assert.ok(retry >= 1 && retry <= 5);
});
