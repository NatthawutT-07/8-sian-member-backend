// Local PostgreSQL integration/load check. Never writes to the real menu/tables.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PrismaClient } from '@prisma/client';
import express from 'express';
import { mountPublicOrdering } from '../src/ordering/routes.js';
import { restaurantLocation } from '../src/ordering/location.js';
import { closeTable } from '../src/ordering/service.js';

const url = new URL(process.env.DATABASE_URL);
assert.ok(
  ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
  'Use a local development database only',
);
const schema = `ordering_load_${randomBytes(6).toString('hex')}`;
assert.match(schema, /^ordering_load_[a-f0-9]{12}$/);
const bootstrap = new PrismaClient();
url.searchParams.set('schema', schema);
url.searchParams.set('connection_limit', '10');
url.searchParams.set('pool_timeout', '10');
const db = new PrismaClient({
  datasources: { db: { url: url.href } },
  log: [{ level: 'query', emit: 'event' }],
});
const db2 = new PrismaClient({ datasources: { db: { url: url.href } } });
let server,
  otherServer,
  created = false,
  menuQueries = 0;
db.$on('query', (event) => {
  if (event.query.startsWith('SELECT') && event.query.includes('OrderingMenuItem')) menuQueries++;
});
const stats = {};
try {
  await bootstrap.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  created = true;
  for (const table of [
    'DiningTable',
    'OrderingMenuItem',
    'OrderingCategory',
    'TableOrder',
    'AuditLog',
  ])
    await bootstrap.$executeRawUnsafe(
      `CREATE TABLE "${schema}"."${table}" (LIKE "public"."${table}" INCLUDING ALL)`,
    );
  const menu = Array.from({ length: 50 }, (_, index) => ({
    id: randomUUID(),
    zone: 'standard',
    category: 'หมู',
    name: `เมนูทดสอบ ${index}`,
    sortOrder: index + 1,
    active: true,
  }));
  await db.orderingMenuItem.createMany({ data: menu });
  const tables = Array.from({ length: 100 }, (_, index) => ({
    id: randomUUID(),
    number: index + 1,
    qrToken: randomUUID(),
    sessionId: randomUUID(),
    orderingEnabled: true,
    zones: ['standard'],
  }));
  await db.diningTable.createMany({ data: tables });
  const createServer = async (client) => {
    const app = express();
    app.use(express.json({ limit: '8kb' }));
    mountPublicOrdering(app, client);
    app.use((error, _req, res, _next) => {
      console.error('Test API error:', error.code || error.name);
      res.status(500).json({ message: 'failed' });
    });
    const instance = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => instance.once('listening', resolve));
    return instance;
  };
  server = await createServer(db);
  otherServer = await createServer(db2);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const secondOrigin = `http://127.0.0.1:${otherServer.address().port}`;
  const measure = async (name, work) => {
    const start = performance.now();
    const value = await work();
    stats[name] = Math.round(performance.now() - start);
    return value;
  };
  menuQueries = 0;
  const menus = await measure('menu_100_concurrent_ms', () =>
    Promise.all(
      tables.map(async (table) => {
        const response = await fetch(`${origin}/api/ordering/${table.qrToken}`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.menu.length, 50);
        return body;
      }),
    ),
  );
  assert.equal(menuQueries, 1);
  stats.catalog_database_reads = menuQueries;
  const fullBytes = Buffer.byteLength(JSON.stringify(menus[0]));
  const statuses = await measure('status_100_concurrent_ms', () =>
    Promise.all(
      tables.map(async (table) => {
        const response = await fetch(`${origin}/api/ordering/${table.qrToken}/status`);
        assert.equal(response.status, 200);
        return response.json();
      }),
    ),
  );
  assert.equal(menuQueries, 1);
  stats.menu_bytes = fullBytes;
  stats.status_bytes = Buffer.byteLength(JSON.stringify(statuses[0]));
  const orders = tables.map((table) => ({
    key: randomUUID(),
    sessionId: table.sessionId,
    items: [{ menuItemId: menu[0].id, quantity: 1 }],
  }));
  const send = async (index, data, host = origin) =>
    fetch(`${host}/api/ordering/${tables[index].qrToken}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        location: {
          latitude: restaurantLocation.latitude,
          longitude: restaurantLocation.longitude,
          accuracy: 10,
          timestamp: Date.now(),
        },
      }),
    });
  const submissions = await measure('orders_100_tables_concurrent_ms', () =>
    Promise.all(orders.map((order, index) => send(index, order))),
  );
  assert.ok(
    submissions.every((r) => r.status === 200),
    'Every distinct table should accept its first order',
  );
  assert.equal(await db.tableOrder.count(), 100);
  const replay = await measure('same_order_20_retries_ms', () =>
    Promise.all(Array.from({ length: 20 }, () => send(0, orders[0], secondOrigin))),
  );
  assert.ok(replay.every((r) => r.status === 200));
  assert.equal(await db.tableOrder.count(), 100);
  // Ensure this assertion is independent of how long the load test machine took.
  await db.diningTable.update({
    where: { id: tables[1].id },
    data: { lastOrderAt: new Date(), orderWindowAt: new Date(), orderWindowCount: 1 },
  });
  const spam = await Promise.all(
    Array.from({ length: 20 }, () => send(1, { ...orders[1], key: randomUUID() }, secondOrigin)),
  );
  assert.ok(spam.every((r) => r.status === 429));
  assert.ok(spam.every((r) => Number(r.headers.get('Retry-After')) >= 1));
  assert.equal(await db.tableOrder.count(), 100);
  stats.rapid_new_orders_blocked = spam.length;
  // Simultaneous retries of a not-yet-created key must still create one order.
  const shared = {
    key: randomUUID(),
    sessionId: tables[2].sessionId,
    items: [{ menuItemId: menu[0].id, quantity: 1 }],
  };
  await db.diningTable.update({
    where: { id: tables[2].id },
    data: { lastOrderAt: null, orderWindowAt: null, orderWindowCount: 0 },
  });
  const duplicateBurst = await measure('same_new_key_20_concurrent_ms', () =>
    Promise.all(Array.from({ length: 20 }, () => send(2, shared))),
  );
  assert.ok(duplicateBurst.every((r) => r.status === 200));
  assert.equal(await db.tableOrder.count({ where: { key: shared.key } }), 1);
  const before = await db.tableOrder.count();
  await db.orderingMenuItem.update({ where: { id: menu[1].id }, data: { active: false } });
  await db.diningTable.update({
    where: { id: tables[3].id },
    data: { lastOrderAt: null, orderWindowAt: null, orderWindowCount: 0 },
  });
  const unavailable = await send(3, {
    ...orders[3],
    key: randomUUID(),
    items: [{ menuItemId: menu[1].id, quantity: 1 }],
  });
  assert.equal(unavailable.status, 400);
  assert.equal(await db.tableOrder.count(), before);
  await closeTable(db, tables[4].id, tables[4].sessionId, 'capacity-test');
  assert.equal((await fetch(`${origin}/api/ordering/${tables[4].qrToken}`)).status, 403);
  assert.equal((await send(4, orders[4])).status, 403);
  console.log(
    'PASS: local PostgreSQL, 100 concurrent readers/orders, shared catalog, two API instances, idempotent retries, persistent spam prevention, live menu/closed-table validation',
  );
  console.log(JSON.stringify(stats, null, 2));
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (otherServer) await new Promise((resolve) => otherServer.close(resolve));
  await Promise.all([db.$disconnect(), db2.$disconnect()]);
  if (created) await bootstrap.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
  await bootstrap.$disconnect();
}
