import test from 'node:test';
import assert from 'node:assert/strict';
import { couponValue } from '../../src/pos/coupon-discounts.js';
import { priceItems } from '../../src/pos/pricing.js';
import { productInput, couponReserveInput, checkoutInput } from '../../src/pos/validation.js';
const id = '1756358a-bb88-4153-a3df-1bd6b5809eec';
const coupon = () => ({
  memberId: 'member-1',
  usedAt: null,
  expiresAt: new Date(Date.now() + 60000),
  barcodeExpiresAt: new Date(Date.now() + 60000),
  offer: { active: true, extraPrice: -20, posDiscountSatang: 9999, posMinSubtotalSatang: 10000 },
});
test('coupon discount is fixed baht and cannot exceed the bill', async () => {
  assert.equal(await couponValue({}, coupon(), [{ group: 'MAIN' }], 15000, null), 2000);
  const c = coupon();
  c.offer.extraPrice = -500;
  assert.equal(await couponValue({}, c, [{ group: 'MAIN' }], 15000, null), 15000);
});
test('coupon rejects wrong owner, used, expired, disabled and insufficient bills', async () => {
  await assert.rejects(couponValue({}, coupon(), [], 15000, { id: 'member-2' }));
  for (const change of [
    { usedAt: new Date() },
    { expiresAt: new Date(0) },
    { barcodeExpiresAt: new Date(0) },
    { offer: { active: false, extraPrice: -20 } },
    { offer: { active: true, extraPrice: 0, posDiscountSatang: 2000 } },
    { offer: { active: true, extraPrice: 79, posDiscountSatang: 2000 } },
  ])
    await assert.rejects(couponValue({}, { ...coupon(), ...change }, [], 15000, null));
  await assert.rejects(couponValue({}, coupon(), [], 9999, null));
  await assert.rejects(couponValue({}, coupon(), [], 0, null));
  await assert.rejects(couponValue({}, coupon(), [{ group: 'DISCOUNT' }], 15000, null));
});
test('discount entries must be configured by admin and cannot make a negative bill', () => {
  assert.equal(
    productInput.safeParse({ name: 'ลด20', barcode: 'D20', priceSatang: -2000, group: 'DISCOUNT' })
      .success,
    true,
  );
  assert.equal(
    productInput.safeParse({ name: 'bad', barcode: 'B', priceSatang: -2000, group: 'MAIN' })
      .success,
    false,
  );
  assert.equal(
    productInput.safeParse({ name: 'bad', barcode: 'B', priceSatang: 2000, group: 'DISCOUNT' })
      .success,
    false,
  );
  const p = { id, active: true, name: 'Test', barcode: '1', priceSatang: 10000, group: 'MAIN' },
    d = { ...p, id: 'discount', priceSatang: -2000, group: 'DISCOUNT' };
  assert.equal(
    priceItems(
      [
        { productId: id, quantity: 1 },
        { productId: 'discount', quantity: 1 },
      ],
      [p, d],
    ).totalSatang,
    8000,
  );
  assert.throws(() => priceItems([{ productId: 'discount', quantity: 1 }], [d]));
  assert.throws(() =>
    priceItems(
      [
        { productId: id, quantity: 1 },
        { productId: 'discount', quantity: 2 },
      ],
      [p, d],
    ),
  );
});
test('coupon input accepts scanner digits and checkout accepts only server reservation references', () => {
  assert.equal(
    couponReserveInput.safeParse({
      billKey: id,
      code: `88${'0'.repeat(30)}`,
      items: [{ productId: id, quantity: 1 }],
    }).success,
    true,
  );
  const bill = {
    key: id,
    shiftId: id,
    items: [{ productId: id, quantity: 1 }],
    method: 'CASH',
    receivedSatang: 10000,
    expectedTotalSatang: 8000,
    couponReservationId: id,
  };
  assert.equal(checkoutInput.safeParse(bill).success, true);
  assert.equal(checkoutInput.safeParse({ ...bill, discountSatang: 2000 }).success, false);
  assert.equal(
    checkoutInput.safeParse({ ...bill, couponCode: `88${'0'.repeat(30)}` }).success,
    false,
  );
});
