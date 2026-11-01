import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { digest } from '../src/shared/security.js';
import { openShift, closeShift, salesSummary } from '../src/pos/shifts.js';
import { reserveCoupon } from '../src/pos/coupon-discounts.js';
import { completeSale } from '../src/pos/checkout.js';
const schema = `pos_test_${randomUUID().replaceAll('-', '')}`;
const url = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  throw new Error('Use a local test database');
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
  const member = await db.member.create({
    data: { firstName: 'Coupon', lastName: 'Test', phone: '0812345678' },
  });
  const other = await db.member.create({
    data: { firstName: 'Other', lastName: 'Test', phone: '0899999999' },
  });
  const actor = 'test-cashier';
  const shift = await openShift(db, { key: randomUUID(), openingCashSatang: 0 }, actor);
  const product = await db.posProduct.create({
    data: { name: 'Main', barcode: 'M', priceSatang: 19900 },
  });
  const discount = await db.posProduct.create({
    data: { name: 'Discount', barcode: 'D', priceSatang: -500, group: 'DISCOUNT' },
  });
  let serial = 0;
  async function issue(owner = member) {
    const campaign = await db.campaign.create({
      data: {
        id: randomUUID(),
        title: 'ลด20',
        description: 'Test',
        extraPrice: -20,
        posDiscountSatang: 0,
        posMinSubtotalSatang: 10000,
      },
    });
    const code = `88${String(++serial).padStart(30, '0')}`;
    const coupon = await db.coupon.create({
      data: {
        memberId: owner.id,
        campaign: campaign.id,
        expiresAt: new Date(Date.now() + 86400000),
        barcodeTokenHash: digest(code),
        barcodeExpiresAt: new Date(Date.now() + 600000),
      },
    });
    return { coupon, code };
  }
  const issued = await issue();
  const billKey = randomUUID(),
    items = [{ productId: product.id, quantity: 1 }];
  const input = { billKey, items, code: issued.code, memberPhone: member.phone };
  const held = await reserveCoupon(db, input, actor);
  assert.equal(held.totalSatang, 17900);
  assert.equal((await reserveCoupon(db, input, actor)).reservationId, held.reservationId);
  assert.equal((await db.coupon.findUnique({ where: { id: issued.coupon.id } })).usedAt, null);
  await assert.rejects(reserveCoupon(db, { ...input, billKey: randomUUID() }, 'second-cashier'));
  await assert.rejects(reserveCoupon(db, { ...input, memberPhone: other.phone }, actor));
  const bill = {
    key: billKey,
    shiftId: shift.id,
    items,
    method: 'CASH',
    receivedSatang: 20000,
    expectedTotalSatang: 17900,
    memberPhone: member.phone,
    couponReservationId: held.reservationId,
  };
  await assert.rejects(completeSale(db, { ...bill, expectedTotalSatang: 1 }, actor));
  assert.equal((await db.coupon.findUnique({ where: { id: issued.coupon.id } })).usedAt, null);
  assert.equal(await db.posCouponReservation.count(), 1);
  const failing = {
    posSale: db.posSale,
    $transaction: (fn, options) =>
      db.$transaction(
        (tx) =>
          fn(
            new Proxy(tx, {
              get(target, key) {
                if (key === 'auditLog')
                  return {
                    create: async () => {
                      throw new Error('AUDIT_FAILED');
                    },
                  };
                return Reflect.get(target, key);
              },
            }),
          ),
        options,
      ),
  };
  await assert.rejects(completeSale(failing, bill, actor));
  assert.equal((await db.coupon.findUnique({ where: { id: issued.coupon.id } })).usedAt, null);
  assert.equal(await db.posSale.count(), 0);
  const attempts = await Promise.allSettled([
    completeSale(db, bill, actor),
    completeSale(db, bill, actor),
  ]);
  assert.ok(attempts.some((r) => r.status === 'fulfilled'));
  const sale = await completeSale(db, bill, actor);
  assert.equal(sale.totalSatang, 17900);
  assert.equal(sale.subtotalSatang, 19900);
  assert.equal(sale.discountSatang, 2000);
  assert.equal(sale.changeSatang, 2100);
  assert.equal(await db.posSale.count(), 1);
  assert.equal(await db.diningVisit.count(), 1);
  assert.equal(await db.posCouponReservation.count(), 0);
  const consumed = await db.coupon.findUnique({ where: { id: issued.coupon.id } });
  assert.ok(consumed.usedAt);
  assert.equal(consumed.barcodeTokenHash, null);
  await assert.rejects(reserveCoupon(db, { ...input, billKey: randomUUID() }, actor));
  const next = await issue();
  await assert.rejects(
    reserveCoupon(
      db,
      {
        billKey: randomUUID(),
        code: next.code,
        items: [...items, { productId: discount.id, quantity: 1 }],
      },
      actor,
    ),
  );
  const anotherKey = randomUUID();
  const reserved = await reserveCoupon(db, { billKey: anotherKey, code: next.code, items }, actor);
  await db.posCouponReservation.update({
    where: { id: reserved.reservationId },
    data: { expiresAt: new Date(0) },
  });
  await assert.rejects(
    completeSale(
      db,
      { ...bill, key: anotherKey, couponReservationId: reserved.reservationId },
      actor,
    ),
  );
  assert.equal((await db.coupon.findUnique({ where: { id: next.coupon.id } })).usedAt, null);
  const renewed = await reserveCoupon(db, { billKey: anotherKey, code: next.code, items }, actor);
  await db.posCouponReservation.deleteMany({
    where: { id: renewed.reservationId, billKey: anotherKey, actor },
  });
  const released = await reserveCoupon(
    db,
    { billKey: randomUUID(), code: next.code, items },
    'second-cashier',
  );
  assert.ok(released.reservationId);
  const third = await issue();
  const racing = await Promise.allSettled([
    reserveCoupon(db, { billKey: randomUUID(), code: third.code, items }, actor),
    reserveCoupon(db, { billKey: randomUUID(), code: third.code, items }, 'second-cashier'),
  ]);
  assert.equal(racing.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal((await salesSummary(db, { shiftId: shift.id })).cashSatang, 17900);
  const closed = await closeShift(db, { shiftId: shift.id, countedCashSatang: 17900 }, actor);
  assert.equal(closed.shift.expectedCashSatang, 17900);
  console.log(
    'POS coupon PostgreSQL passed: reservation, two tills racing, owner/minimum rules, fixed discount, rollback, expiry/release, one payment and one visit on retry.',
  );
} finally {
  if (!/^pos_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid test schema');
  await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await db.$disconnect();
}
