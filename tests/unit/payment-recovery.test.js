import test from 'node:test';
import assert from 'node:assert/strict';
import { recoverPayment, cancelledPaymentId } from '../../src/pos/payment-recovery.js';
import { completeSale } from '../../src/pos/checkout.js';

const key = '14c628f5-819d-44ef-acf0-f80d600c141e';
const shiftId = '4566cad7-b7bb-49dd-9a85-07ebd3878f36';
function fixture(sale = null) {
  const audit = new Map();
  let released = false;
  const db = {
    posSale: { findUnique: async () => sale, create: () => assert.fail('cancelled checkout must never create a sale') },
    posShift: { findUnique: async () => ({ id: shiftId }), updateMany: async () => ({ count: 1 }) },
    posProduct: { findMany: async () => [{ id: 'p', name: 'อาหาร', active: true, priceSatang: 10000 }] },
    posCouponReservation: { deleteMany: async () => { released = true; } },
    auditLog: {
      findUnique: async ({ where }) => audit.get(where.id) || null,
      upsert: async ({ where, create }) => { if (!audit.has(where.id)) audit.set(where.id, create); return audit.get(where.id); },
    },
    $transaction: async (fn, options) => { assert.equal(options.isolationLevel, 'Serializable'); return fn(db); },
  };
  return { db, audit, released: () => released };
}
test('recovering a paid bill returns its original sale; cancelling never deletes committed revenue', async () => {
  const sale = { key, actor: 'owner', totalSatang: 10000 };
  const f = fixture(sale);
  for (const action of ['CHECK', 'CANCEL']) {
    assert.deepEqual(await recoverPayment(f.db, { key, shiftId, action }, 'owner'), { status: 'PAID', sale });
    await assert.rejects(recoverPayment(f.db, { key, shiftId, action }, 'other'), { status: 403 });
  }
  assert.equal(f.audit.size, 0);
  assert.equal(f.released(), false);
});
test('cancellation fences late/retried checkout and is idempotent without deleting a sale', async () => {
  const f = fixture();
  assert.deepEqual(await recoverPayment(f.db, { key, shiftId, action: 'CHECK' }, 'owner'), { status: 'NOT_FOUND' });
  for (let i = 0; i < 2; i++) assert.deepEqual(await recoverPayment(f.db, { key, shiftId, action: 'CANCEL' }, 'owner'), { status: 'CANCELLED' });
  assert.equal(f.audit.size, 1);
  assert.equal(f.audit.get(cancelledPaymentId(key)).action, 'POS_PAYMENT_CANCELLED');
  assert.equal(f.released(), true);
  await assert.rejects(completeSale(f.db, {
    key, shiftId, items: [{ productId: 'p', quantity: 1 }], method: 'CASH', receivedSatang: 10000, expectedTotalSatang: 10000,
  }, 'owner'), /ถูกยกเลิก/);
});
