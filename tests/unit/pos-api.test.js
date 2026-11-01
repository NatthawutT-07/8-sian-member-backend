import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../src/app.js';
import { hashPassword, digest } from '../../src/shared/security.js';
import { businessDate } from '../../src/pos/shifts.js';

test('POS session, scan, paid sale and retry keep member visits idempotent', async () => {
  const admin = {
    id: 'owner',
    username: 'owner',
    role: 'ADMIN',
    passwordHash: await hashPassword('test-password'),
  };
  const product = {
    id: 'c23096c1-cbe5-465d-9348-673e7b43cb1a',
    name: 'อาหาร',
    barcode: '123456',
    priceSatang: 19900,
    active: true,
  };
  const user = {
    id: '4b03f82c-977e-4726-a3d8-d58719d7457e',
    username: 'cashier01',
    displayName: 'พนักงาน',
    role: 'USER',
    active: true,
    passwordHash: await hashPassword('cashier-password'),
  };
  const shifts = [];
  const member = { id: 'member-1', firstName: 'ทดสอบ', memberNumber: 1, phone: '0812345678' };
  let qrActive = true;
  const sessions = new Map(),
    sales = [],
    visits = [],
    audits = [];
  const db = {
    posReceiptCounter: { upsert: async () => ({ lastNumber: sales.length + 1 }) },
    admin: { findUnique: async () => admin },
    adminSession: {
      findUnique: async () => ({ admin, expiresAt: new Date(Date.now() + 600000) }),
    },
    posUser: {
      findUnique: async ({ where }) => (where.username === user.username ? user : null),
      findMany: async () => [
        {
          id: user.id,
          username: user.username,
          displayName: user.displayName,
          role: user.role,
          active: user.active,
        },
      ],
    },
    posSession: {
      create: async ({ data }) => sessions.set(data.tokenHash, { ...data, user }),
      findUnique: async ({ where }) => sessions.get(where.tokenHash),
      deleteMany: async ({ where }) => sessions.delete(where.tokenHash),
    },
    posShift: {
      findUnique: async ({ where }) =>
        shifts.find((s) => (where.id ? s.id === where.id : s.activeSlot === where.activeSlot)) ||
        null,
      create: async ({ data }) => {
        const row = {
          ...data,
          id: '4566cad7-b7bb-49dd-9a85-07ebd3878f36',
          openedAt: new Date(),
          closedAt: null,
          version: 0,
        };
        shifts.push(row);
        return row;
      },
      updateMany: async ({ where }) => {
        const row = shifts.find((s) => s.id === where.id && !s.closedAt);
        if (row) row.version++;
        return { count: row ? 1 : 0 };
      },
      update: async ({ where, data }) => {
        const row = shifts.find((s) => s.id === where.id);
        Object.assign(row, data);
        return row;
      },
      findMany: async ({ where }) =>
        shifts.filter((s) =>
          where.closedAt ? !!s.closedAt : s.businessDate === where.businessDate,
        ),
    },
    posProduct: {
      findMany: async () => [product],
      findUnique: async ({ where }) => (where.barcode === product.barcode ? product : null),
    },
    posSale: {
      findMany: async ({ where } = {}) =>
        where?.shiftId ? sales.filter((sale) => sale.shiftId === where.shiftId) : sales,
      findUnique: async ({ where }) =>
        sales.find((s) => (where.id ? s.id === where.id : s.key === where.key)),
      create: async ({ data }) => {
        const sale = { ...data, id: 'receipt-1', createdAt: new Date() };
        sales.push(sale);
        return sale;
      },
      groupBy: async ({ where }) => {
        const rows = sales.filter((s) =>
          where.shiftId
            ? s.shiftId === where.shiftId
            : s.createdAt >= where.createdAt.gte && s.createdAt < where.createdAt.lt,
        );
        return ['CASH', 'TRANSFER'].map((method) => {
          const group = rows.filter((s) => s.method === method);
          return {
            method,
            _sum: { totalSatang: group.reduce((n, s) => n + s.totalSatang, 0) },
            _count: { _all: group.length },
          };
        });
      },
    },
    member: {
      findMany: async ({ where }) =>
        where.id.in.includes(member.id) ? [{ id: member.id, phone: member.phone }] : [],
      findUnique: async ({ where, select }) =>
        where.phone === member.phone
          ? select
            ? {
                firstName: member.firstName,
                memberNumber: member.memberNumber,
                phone: member.phone,
              }
            : member
          : null,
      findFirst: async ({ where }) =>
        qrActive && where.loyaltyQrHash === digest(`8SM-${'a'.repeat(64)}`) ? member : null,
    },
    diningVisit: { create: async ({ data }) => visits.push(data) },
    auditLog: { create: async ({ data }) => audits.push(data) },
    $transaction: async (fn) => fn(db),
  };
  const app = await createApp({
    db,
    config: {
      origin: 'http://localhost:5173',
      posOrigin: 'http://localhost:3001',
      trustProxy: false,
      cookieOptions: { httpOnly: true, path: '/' },
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie;
  async function call(path, body, origin = 'http://localhost:3001') {
    return fetch(`${base}/api/pos/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }
  try {
    assert.equal((await call('products')).status, 401);
    assert.equal((await call('hardware/claim', { saleId: 'receipt-1' })).status, 401);
    assert.equal((await call('sales/receipt-1')).status, 401);
    assert.equal((await call('shifts/closed')).status, 401);
    assert.equal(
      (
        await call(
          'login',
          { username: 'owner', password: 'test-password' },
          'https://evil.example',
        )
      ).status,
      403,
    );
    // Admin credentials and admin cookies cannot authorize POS.
    assert.equal(
      (await call('login', { username: 'owner', password: 'test-password' })).status,
      401,
    );
    cookie = 'admin_session=admin-token';
    assert.equal((await call('products')).status, 401);
    cookie = 'pos_session=admin-token';
    assert.equal((await call('products')).status, 401);
    cookie = undefined;
    const login = await call('login', { username: 'cashier01', password: 'cashier-password' });
    assert.equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
    assert.match(cookie, /^pos_session=/);
    assert.equal((await login.json()).role, 'USER');
    assert.equal(
      (await fetch(`${base}/api/admin/me`, { headers: { Cookie: cookie } })).status,
      401,
    );
    assert.equal((await call('products', { name: 'forbidden' })).status, 403);
    assert.equal((await call('products')).status, 200);
    assert.equal((await call('scan', { code: '123456' })).status, 200);
    const memberCode = `8SM-${'a'.repeat(64)}`;
    assert.equal((await call('scan', { code: memberCode })).status, 200);
    const phoneLookup = await call('scan', { code: '081-234-5678' });
    assert.equal(phoneLookup.status, 200);
    assert.deepEqual((await phoneLookup.json()).selection, { memberPhone: '0812345678' });
    assert.equal((await call('scan', { code: '0899999999' })).status, 404);
    assert.equal((await call('scan', { code: `88${'0'.repeat(30)}` })).status, 400);
    qrActive = false;
    assert.equal((await call('scan', { code: memberCode })).status, 400);
    qrActive = true;
    const originalBarcode = product.barcode;
    product.barcode = member.phone;
    assert.equal((await (await call('scan', { code: member.phone })).json()).type, 'PRODUCT');
    product.barcode = originalBarcode;
    assert.equal(visits.length, 0);
    const bill = {
      key: '14c628f5-819d-44ef-acf0-f80d600c141e',
      items: [{ productId: product.id, quantity: 1 }],
      method: 'CASH',
      receivedSatang: 20000,
      expectedTotalSatang: 19900,
      memberCode,
      shiftId: '4566cad7-b7bb-49dd-9a85-07ebd3878f36',
    };
    assert.equal((await call('checkout', bill)).status, 400);
    assert.equal(
      (await call('shift/open', { key: bill.shiftId, openingCashSatang: 10000 })).status,
      200,
    );
    assert.equal(
      (await call('shift/open', { key: bill.shiftId, openingCashSatang: 10000 })).status,
      200,
    );
    assert.equal(shifts.length, 1);
    assert.equal((await call(`shifts/${bill.shiftId}/report`)).status, 409);
    const paid = await call('checkout', bill);
    assert.equal(paid.status, 200);
    const paidReceipt = await paid.json();
    assert.equal(paidReceipt.changeSatang, 100);
    assert.equal(paidReceipt.cashierDisplayName, user.displayName);
    assert.equal(paidReceipt.memberPhone, member.phone);
    assert.equal(
      (await (await call(`sales/${paidReceipt.id}`)).json()).receiptNumber,
      paidReceipt.receiptNumber,
    );
    assert.equal((await call('sales/missing')).status, 404);
    assert.equal(
      (
        await call('hardware/events', {
          jobId: 'f80b1cb4-d812-4e54-8cc4-5ef10dd165e8',
          operation: 'OPEN_DRAWER',
          status: 'REQUESTED',
          reason: 'ทดสอบลิ้นชัก',
          deviceName: 'JP80H',
          saleId: paidReceipt.id,
        })
      ).status,
      200,
    );
    assert.equal(audits.filter((row) => row.action === 'POS_HARDWARE').length, 1);
    assert.equal(
      (await call('hardware/events', { operation: 'RAW_BYTES', bytes: 'anything' })).status,
      400,
    );
    assert.equal((await (await call('sales')).json())[0].memberPhone, member.phone);
    assert.equal((await (await call('sales')).json())[0].cashierDisplayName, user.displayName);
    assert.equal((await call('checkout', bill)).status, 200);
    assert.equal(sales.length, 1);
    assert.equal(visits.length, 1);
    assert.equal(audits.filter((a) => a.action === 'POS_PAID').length, 1);
    assert.equal((await call('checkout', { ...bill, receivedSatang: 30000 })).status, 409);
    assert.equal((await fetch(`${base}/pos/`)).status, 404);
    const transfer = {
      ...bill,
      memberCode: undefined,
      memberPhone: member.phone,
      key: '5303841f-d720-4d7a-964a-ad8784f685d1',
      method: 'TRANSFER',
      receivedSatang: 19900,
    };
    assert.equal((await call('checkout', { ...transfer, memberPhone: '0899999999' })).status, 400);
    assert.equal((await call('checkout', transfer)).status, 200);
    const report = await (await call(`reports/daily?date=${businessDate()}`)).json();
    assert.equal(report.summary.billCount, 2);
    assert.equal(report.summary.totalSatang, 39800);
    assert.equal(report.summary.cashSatang, 19900);
    assert.equal(report.summary.transferSatang, 19900);
    assert.equal((await call('reports/daily?date=2026-02-30')).status, 400);
    const close = { shiftId: bill.shiftId, countedCashSatang: 29800 };
    const closed = await (await call('shift/close', close)).json();
    assert.equal(closed.shift.expectedCashSatang, 29900);
    assert.equal(closed.shift.cashDifferenceSatang, -100);
    const shiftReceiptResponse = await call(`shifts/${bill.shiftId}/report`);
    assert.equal(shiftReceiptResponse.status, 200);
    const shiftReceipt = await shiftReceiptResponse.json();
    assert.equal(shiftReceipt.summary.cashSatang, 19900);
    assert.equal(shiftReceipt.summary.transferSatang, 19900);
    assert.equal(shiftReceipt.items[0].quantity, 2);
    assert.equal(shiftReceipt.shift.closedByName, user.displayName);
    assert.equal((await (await call('shifts/closed')).json()).length, 1);
    assert.equal((await call('shifts/missing/report')).status, 404);
    assert.equal((await call('shift/close', close)).status, 200);
    assert.equal(audits.filter((a) => a.action === 'POS_CLOSE').length, 1);
    assert.equal(
      (await call('checkout', { ...bill, key: '25b258a6-7698-4ae4-9002-e2cae81ac616' })).status,
      400,
    );
    // An already committed sale remains retrievable after close; no new visit is added.
    assert.equal((await call('checkout', bill)).status, 200);
    assert.equal(visits.length, 2);
    assert.equal(
      (await call('shift/open', { key: bill.shiftId, openingCashSatang: 10000 })).status,
      200,
    );
    assert.equal((await (await call('shift')).json()).shift, null);
    user.active = false;
    assert.equal((await call('products')).status, 401);
    user.active = true;
    user.role = 'ADMIN';
    assert.equal((await call('products')).status, 401);
    user.role = 'USER';
    await call('logout', {});
    assert.equal((await call('products')).status, 401);
    const staffResponse = await fetch(`${base}/api/admin/pos/users`, {
      headers: { Cookie: 'admin_session=admin-token' },
    });
    assert.equal(staffResponse.status, 200);
    assert.equal('passwordHash' in (await staffResponse.json())[0], false);
    const injection = await fetch(`${base}/api/admin/pos/users`, {
      method: 'POST',
      headers: {
        Cookie: 'admin_session=admin-token',
        Origin: 'http://localhost:5173',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'newuser',
        displayName: 'พนักงาน',
        password: 'test12345',
        role: 'ADMIN',
      }),
    });
    assert.equal(injection.status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
