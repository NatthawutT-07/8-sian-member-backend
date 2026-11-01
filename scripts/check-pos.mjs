import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { openShift, closeShift, salesSummary, dayRange, businessDate } from '../src/pos/shifts.js';
import { completeSale } from '../src/pos/checkout.js';
import { receiptTime } from '../src/pos/receipt-number.js';
import { digest } from '../src/shared/security.js';

// Only an isolated schema is populated; the configured store schema is never changed.
const schema = `pos_test_${randomUUID().replaceAll('-', '')}`;
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('POS integration requires a local test database.');
url.searchParams.set('schema', schema);
const db = new PrismaClient({ datasourceUrl: url.href });
try {
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)),
      'migrate',
      'deploy',
    ],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: url.href },
      stdio: 'pipe',
    },
  );
  const user = await db.posUser.create({
    data: {
      username: 'testcashier',
      displayName: 'Integration',
      passwordHash: 'not-a-login-hash',
      role: 'USER',
    },
  });
  const product = await db.posProduct.create({
    data: { name: 'Test', barcode: 'TEST-001', priceSatang: 19900 },
  });
  const opening = { key: randomUUID(), openingCashSatang: 10000 };
  const memberCode = `8SM-${'a'.repeat(64)}`;
  const member = await db.member.create({
    data: {
      firstName: 'POS test',
      lastName: 'Integration',
      phone: '0812345678',
      loyaltyQrHash: digest(memberCode),
      loyaltyQrExpiresAt: new Date(Date.now() + 60000),
    },
  });
  const shift = await openShift(db, opening, user.id);
  const bill = {
    memberPhone: member.phone,
    key: randomUUID(),
    shiftId: shift.id,
    items: [{ productId: product.id, quantity: 1 }],
    method: 'CASH',
    receivedSatang: 20000,
    expectedTotalSatang: 19900,
  };
  const duplicate = await Promise.allSettled([
    completeSale(db, bill, user.id),
    completeSale(db, bill, user.id),
  ]);
  assert.ok(duplicate.some((r) => r.status === 'fulfilled'));
  assert.equal(await db.posSale.count(), 1);
  const firstSale = await completeSale(db, bill, user.id);
  assert.equal(firstSale.changeSatang, 100);
  assert.equal(firstSale.receiptNumber, `${receiptTime(firstSale.createdAt).prefix}001`);
  assert.equal((await completeSale(db, bill, user.id)).receiptNumber, firstSale.receiptNumber);
  assert.equal(await db.diningVisit.count({ where: { memberId: member.id } }), 1);
  await assert.rejects(
    completeSale(db, { ...bill, key: randomUUID(), memberPhone: '0899999999' }, user.id),
  );
  const nextBill = {
    ...bill,
    memberPhone: undefined,
    memberCode,
    key: randomUUID(),
    method: 'TRANSFER',
    receivedSatang: 19900,
  };
  const closeRequest = { shiftId: shift.id, countedCashSatang: 29900 };
  const racing = await Promise.allSettled([
    completeSale(db, nextBill, user.id),
    closeShift(db, closeRequest, user.id),
  ]);
  for (const result of racing)
    if (result.status === 'rejected')
      assert.ok(
        ['P2034', 'P2002'].includes(result.reason.code) ||
          /เปิดร้าน|ร้านปิด/.test(result.reason.message),
      );
  const closed = await closeShift(db, closeRequest, user.id);
  const count = await db.posSale.count();
  assert.equal(await db.diningVisit.count({ where: { memberId: member.id } }), count);
  const numbers = await db.posSale.findMany({ select: { receiptNumber: true } });
  assert.equal(new Set(numbers.map((row) => row.receiptNumber)).size, count);
  assert.equal(
    (
      await db.posReceiptCounter.findUnique({
        where: { businessDate: receiptTime(firstSale.createdAt).businessDate },
      })
    ).lastNumber,
    count,
  );
  assert.equal(closed.summary.billCount, count);
  assert.equal(closed.summary.cashSatang, 19900);
  assert.equal(closed.shift.expectedCashSatang, 29900);
  assert.equal(closed.shift.cashDifferenceSatang, 0);
  await assert.rejects(completeSale(db, { ...bill, key: randomUUID() }, user.id));
  assert.equal(
    (await completeSale(db, bill, user.id)).id,
    (await db.posSale.findUnique({ where: { key: bill.key } })).id,
  );
  assert.ok((await openShift(db, opening, user.id)).closedAt);
  assert.equal(await db.posShift.count(), 1);
  assert.equal((await salesSummary(db, { createdAt: dayRange(businessDate()) })).billCount, count);
  assert.equal(await db.auditLog.count({ where: { action: 'POS_CLOSE' } }), 1);
  console.log(
    'POS PostgreSQL integration passed: isolated migrations, duplicate checkout, close/checkout race, close retry and daily totals.',
  );
} finally {
  // Identifier is generated locally and verified before dropping only this temporary schema.
  if (!/^pos_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema');
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
}
