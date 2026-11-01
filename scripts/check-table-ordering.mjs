// Uses a new isolated schema on a loopback PostgreSQL server; never touches app tables.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { hashPassword, digest } from '../src/shared/security.js';
import { completeSale } from '../src/pos/checkout.js';
import { activateTable, closeTable, submitOrder } from '../src/ordering/service.js';

const url = new URL(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('This check requires a loopback test PostgreSQL server');
const schema = `ordering_qa_${randomUUID().replaceAll('-', '')}`;
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
let server;
try {
  const migration = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)),
      'migrate',
      'deploy',
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url.href },
      encoding: 'utf8',
    },
  );
  assert.equal(migration.status, 0, migration.stderr);
  const actor = randomUUID(),
    auth = randomUUID(),
    adminAuth = randomUUID();
  await db.posUser.create({
    data: {
      id: actor,
      username: `qa-${actor}`,
      displayName: 'QA',
      passwordHash: await hashPassword(randomUUID()),
    },
  });
  await db.posSession.create({
    data: { tokenHash: digest(auth), userId: actor, expiresAt: new Date(Date.now() + 3600000) },
  });
  await db.admin.upsert({
    where: { id: 'owner' },
    update: {},
    create: { id: 'owner', username: 'qa-owner', passwordHash: await hashPassword(randomUUID()) },
  });
  await db.adminSession.create({
    data: {
      tokenHash: digest(adminAuth),
      adminId: 'owner',
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  const app = await createApp({
    db,
    config: {
      production: false,
      origin: 'http://localhost:5173',
      posOrigin: 'http://localhost:3001',
      cookieOptions: { path: '/' },
      trustProxy: false,
    },
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let chefCookie = '';
  async function request(path, { body, role, method, contentType = 'application/json' } = {}) {
    const response = await fetch(`${base}/api/${path}`, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers: {
        Origin: 'http://localhost:5173',
        'Content-Type': contentType,
        ...(role === 'pos'
          ? { Cookie: `pos_session=${auth}` }
          : role === 'admin'
            ? { Cookie: `admin_session=${adminAuth}` }
            : role === 'chef'
              ? { Cookie: chefCookie }
              : {}),
      },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
    });
    return {
      status: response.status,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      data: response.headers.get('content-type')?.includes('application/json')
        ? await response.json()
        : null,
    };
  }
  assert.equal((await request('admin/dining-tables')).status, 401);
  assert.equal((await request('pos/tables')).status, 401);
  let chefResult = await request('admin/pos/users', {
    role: 'admin',
    body: {
      username: 'qa-chef',
      displayName: 'พ่อครัว QA',
      password: 'qa-chef-password',
      role: 'CHEF',
    },
  });
  assert.equal(chefResult.status, 201);
  assert.equal(chefResult.data.role, 'CHEF');
  chefResult = await request('pos/login', {
    body: { username: 'qa-chef', password: 'qa-chef-password' },
  });
  assert.equal(chefResult.status, 200);
  chefCookie = chefResult.cookie;
  assert.equal((await request('pos/me', { role: 'chef' })).data.role, 'CHEF');
  for (const path of ['pos/products', 'pos/shift', 'pos/sales', 'pos/tables'])
    assert.equal((await request(path, { role: 'chef' })).status, 403);
  for (const path of ['pos/checkout', 'pos/shift/close', 'pos/tables/fake/close'])
    assert.equal((await request(path, { role: 'chef', body: {} })).status, 403);
  let result = await request('admin/dining-tables', { role: 'admin', body: { from: 1, to: 2 } });
  assert.equal(result.status, 200);
  const table = result.data[0];
  result = await request('admin/dining-tables', { role: 'admin', body: { from: 1, to: 3 } });
  assert.equal(result.data.find((row) => row.id === table.id).qrToken, table.qrToken);
  assert.equal(result.data.length, 3);
  const meat = await db.orderingMenuItem.create({
    data: { zone: 'เนื้อสัตว์', category: 'หมู', name: 'หมูสามชั้น' },
  });
  const seafood = await db.orderingMenuItem.create({
    data: { zone: 'ทะเล', category: 'กุ้ง', name: 'กุ้งสด' },
  });
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS1kAAAAASUVORK5CYII=',
    'base64',
  );
  const imagePath = `admin/ordering-menu/${meat.id}/image`;
  assert.equal(
    (await request(imagePath, { method: 'PUT', body: png, contentType: 'image/png' })).status,
    401,
  );
  result = await request(imagePath, {
    role: 'admin',
    method: 'PUT',
    body: png,
    contentType: 'image/png',
  });
  assert.equal(result.status, 200);
  assert.ok(result.data.imageUrl);
  assert.equal(result.data.imageData, undefined);
  const firstImage = result.data.imageUrl;
  let imageResponse = await fetch(`${base}${firstImage}`);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');
  assert.equal(imageResponse.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
  assert.equal(
    (
      await request(imagePath, {
        role: 'admin',
        method: 'PUT',
        contentType: 'image/png',
        body: Buffer.from('<svg onload="alert(1)"/>'),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request(imagePath, {
        role: 'admin',
        method: 'PUT',
        contentType: 'image/png',
        body: Buffer.alloc(2 * 1024 * 1024 + 1),
      })
    ).status,
    413,
  );
  result = await request('admin/ordering-menu', { role: 'admin' });
  assert.equal(result.data.find((item) => item.id === meat.id).imageUrl, firstImage);
  assert.equal(result.data.find((item) => item.id === meat.id).imageData, undefined);
  result = await request(imagePath, { role: 'admin', method: 'DELETE' });
  assert.equal(result.data.imageUrl, null);
  assert.equal((await fetch(`${base}${firstImage}`)).status, 404);
  result = await request(imagePath, {
    role: 'admin',
    method: 'PUT',
    body: png,
    contentType: 'image/png',
  });
  assert.notEqual(result.data.imageUrl, firstImage);
  const currentImage = result.data.imageUrl;
  assert.equal((await request(`ordering/${table.qrToken}`)).status, 403);
  const product = await db.posProduct.create({
    data: { barcode: 'QA-BUFFET', name: 'บุฟเฟต์', priceSatang: 19900 },
  });
  const shift = await db.posShift.create({
    data: {
      openedBy: actor,
      activeSlot: 'STORE',
      businessDate: '2026-11-02',
      openingCashSatang: 0,
    },
  });
  const payment = {
    key: randomUUID(),
    shiftId: shift.id,
    tableId: table.id,
    items: [{ productId: product.id, quantity: 1 }],
    method: 'CASH',
    receivedSatang: 20000,
    expectedTotalSatang: 19900,
  };
  await assert.rejects(completeSale(db, { ...payment, receivedSatang: 1 }, actor));
  assert.equal((await db.diningTable.findUnique({ where: { id: table.id } })).sessionId, null);
  result = await request('pos/checkout', { role: 'pos', body: payment });
  assert.equal(result.status, 200);
  const sale = result.data;
  assert.equal(sale.tableNumber, 1);
  assert.equal(
    (await request(`ordering/${table.qrToken}`)).status,
    403,
    'paid table must wait for zone choice',
  );
  result = await request(`pos/tables/${table.id}/activate`, {
    role: 'pos',
    body: { sessionId: sale.tableSessionId, zones: ['เนื้อสัตว์'] },
  });
  assert.equal(result.status, 200);
  result = await request(`ordering/${table.qrToken}`);
  assert.deepEqual(
    result.data.menu.map((item) => item.id),
    [meat.id],
  );
  assert.equal(result.data.menu[0].imageUrl, currentImage);
  assert.equal(result.data.menu[0].imageData, undefined);
  const order = {
    key: randomUUID(),
    sessionId: sale.tableSessionId,
    items: [{ menuItemId: meat.id, quantity: 2 }],
  };
  assert.equal(
    (
      await request(`ordering/${table.qrToken}/orders`, {
        body: { ...order, items: [{ menuItemId: seafood.id, quantity: 1 }] },
      })
    ).status,
    403,
  );
  result = await request(`ordering/${table.qrToken}/orders`, { body: order });
  assert.deepEqual(result.data, { ok: true });
  assert.deepEqual((await request(`ordering/${table.qrToken}/orders`, { body: order })).data, {
    ok: true,
  });
  assert.equal(await db.tableOrder.count(), 1);
  assert.equal(
    (await request(`ordering/${table.qrToken}/orders`)).status,
    404,
    'no public history endpoint',
  );
  result = await request('pos/table-orders', { role: 'pos' });
  assert.equal(result.data[0].items[0].name, meat.name);
  assert.equal(result.data[0].table.number, 1);
  const firstOrderId = result.data[0].id;
  chefResult = await request('pos/kitchen/orders', { role: 'chef' });
  assert.equal(chefResult.data[0].id, firstOrderId);
  chefResult = await request(`pos/kitchen/tables/${table.id}/${sale.tableSessionId}/summary`, {
    role: 'chef',
  });
  assert.equal(chefResult.data.quantity, 2);
  assert.equal(chefResult.data.items[0].pending, 2);
  assert.equal(chefResult.data.receiptNumber, sale.receiptNumber);
  chefResult = await request(`pos/kitchen/orders/${firstOrderId}/ticket`, { role: 'chef' });
  assert.equal(chefResult.data.tableNumber, 1);
  assert.equal(chefResult.data.items[0].quantity, 2);
  assert.equal(
    (await request(`pos/kitchen/orders/${firstOrderId}/complete`, { role: 'chef', body: {} }))
      .status,
    200,
  );
  assert.equal((await request('pos/kitchen/orders', { role: 'chef' })).data.length, 0);
  assert.equal(
    (await request(`pos/table-orders/${result.data[0].id}/complete`, { role: 'pos', body: {} }))
      .status,
    200,
  );
  assert.equal((await request('pos/table-orders', { role: 'pos' })).data.length, 0);
  const outstanding = { ...order, key: randomUUID() };
  await submitOrder(db, table.qrToken, outstanding);
  const later = { ...order, key: randomUUID(), items: [{ menuItemId: meat.id, quantity: 3 }] };
  await submitOrder(db, table.qrToken, later);
  chefResult = await request('pos/kitchen/orders', { role: 'chef' });
  assert.equal(chefResult.data[0].key, outstanding.key);
  assert.equal(chefResult.data[1].key, later.key);
  chefResult = await request(`pos/kitchen/tables/${table.id}/${sale.tableSessionId}/summary`, {
    role: 'chef',
  });
  assert.equal(chefResult.data.quantity, 7);
  assert.equal(chefResult.data.items[0].completed, 2);
  assert.equal(chefResult.data.items[0].pending, 5);
  const otherTable = await db.diningTable.findUnique({ where: { number: 2 } });
  const otherSession = randomUUID();
  await db.diningTable.update({ where: { id: otherTable.id }, data: { sessionId: otherSession } });
  const unrelated = await db.tableOrder.create({
    data: {
      key: randomUUID(),
      requestHash: 'qa-other-table',
      tableId: otherTable.id,
      sessionId: otherSession,
      items: [],
    },
  });
  assert.equal(
    (await request(`pos/tables/${table.id}/close`, { body: { sessionId: sale.tableSessionId } }))
      .status,
    401,
  );
  await closeTable(db, table.id, sale.tableSessionId, actor);
  assert.equal(
    (
      await request(`pos/kitchen/tables/${table.id}/${sale.tableSessionId}/summary`, {
        role: 'chef',
      })
    ).status,
    409,
  );
  assert.equal(
    (await request(`pos/kitchen/orders/${firstOrderId}/ticket`, { role: 'chef' })).status,
    409,
  );
  assert.equal(
    (await db.tableOrder.findUnique({ where: { key: outstanding.key } })).status,
    'CANCELLED',
  );
  assert.equal((await db.tableOrder.findUnique({ where: { key: order.key } })).status, 'DONE');
  assert.equal((await db.tableOrder.findUnique({ where: { id: unrelated.id } })).status, 'NEW');
  assert.equal(
    (await request('pos/table-orders', { role: 'pos' })).data.some(
      (item) => item.tableId === table.id,
    ),
    false,
  );
  await assert.rejects(submitOrder(db, table.qrToken, outstanding), { orderingStatus: 403 });
  assert.equal((await request(`ordering/${table.qrToken}`)).status, 403);
  await assert.rejects(submitOrder(db, table.qrToken, { ...order, key: randomUUID() }), {
    orderingStatus: 403,
  });
  // Replaying a paid receipt must not reopen a table after the customers leave.
  await completeSale(db, payment, actor);
  assert.equal((await db.diningTable.findUnique({ where: { id: table.id } })).sessionId, null);
  const nextSale = await completeSale(db, { ...payment, key: randomUUID() }, actor);
  assert.notEqual(nextSale.tableSessionId, sale.tableSessionId);
  await activateTable(db, table.id, nextSale.tableSessionId, [], actor);
  chefResult = await request(`pos/kitchen/tables/${table.id}/${nextSale.tableSessionId}/summary`, {
    role: 'chef',
  });
  assert.equal(chefResult.data.quantity, 0);
  assert.deepEqual((await request(`ordering/${table.qrToken}`)).data.menu, []);
  await assert.rejects(submitOrder(db, table.qrToken, { ...order, key: randomUUID() }), {
    orderingStatus: 403,
  });
  await assert.rejects(
    submitOrder(db, table.qrToken, {
      ...order,
      key: randomUUID(),
      sessionId: nextSale.tableSessionId,
    }),
    { orderingStatus: 403 },
  );
  await assert.rejects(closeTable(db, table.id, sale.tableSessionId, actor), {
    orderingStatus: 409,
  });
  await closeTable(db, table.id, nextSale.tableSessionId, actor);
  const thirdSale = await completeSale(db, { ...payment, key: randomUUID() }, actor);
  await activateTable(db, table.id, thirdSale.tableSessionId, ['เนื้อสัตว์', 'ทะเล'], actor);
  assert.equal((await request(`ordering/${table.qrToken}`)).data.menu.length, 2);
  const concurrent = { ...order, key: randomUUID(), sessionId: thirdSale.tableSessionId };
  const results = await Promise.allSettled([
    submitOrder(db, table.qrToken, concurrent),
    submitOrder(db, table.qrToken, concurrent),
  ]);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  await submitOrder(db, table.qrToken, concurrent);
  assert.equal(
    await db.tableOrder.count({ where: { key: concurrent.key } }),
    1,
    'concurrent retry inserts only once',
  );
  const racingOrder = { ...concurrent, key: randomUUID() };
  await Promise.allSettled([
    submitOrder(db, table.qrToken, racingOrder),
    closeTable(db, table.id, thirdSale.tableSessionId, actor),
  ]);
  if ((await db.diningTable.findUnique({ where: { id: table.id } })).sessionId)
    await closeTable(db, table.id, thirdSale.tableSessionId, actor);
  assert.equal(
    await db.tableOrder.count({
      where: { tableId: table.id, sessionId: thirdSale.tableSessionId, status: 'NEW' },
    }),
    0,
  );
  await assert.rejects(submitOrder(db, table.qrToken, { ...racingOrder, key: randomUUID() }), {
    orderingStatus: 403,
  });
  // A failed audit must roll back table reservation and receipt together.
  const broken = {
    ...db,
    posSale: db.posSale,
    $transaction: (fn, options) =>
      db.$transaction(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(target, property) {
                return property === 'auditLog'
                  ? {
                      create: async () => {
                        throw new Error('QA audit failure');
                      },
                    }
                  : target[property];
              },
            }),
          ),
        options,
      ),
  };
  const failedKey = randomUUID();
  await assert.rejects(completeSale(broken, { ...payment, key: failedKey }, actor));
  assert.equal(await db.posSale.findUnique({ where: { key: failedKey } }), null);
  assert.equal((await db.diningTable.findUnique({ where: { id: table.id } })).sessionId, null);
  console.log(
    'PASS: stable QR, auth, payment atomicity, zone gating, empty/multiple zones, menu hierarchy, ordering, retries, staff queue, close, stale rounds and rollback',
  );
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  // schema consists exclusively of the generated UUID above, not user input.
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
}
