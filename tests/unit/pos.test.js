import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutInput, priceItems, requestHash, completeSale } from '../../src/pos/checkout.js';
const id = 'd01fe7bf-b3c4-4a3a-a554-5e52b1c13bd5';
const input = {
  key: 'ad6d30de-3e0e-40ac-aa58-42ec165b65de',
  shiftId: '4566cad7-b7bb-49dd-9a85-07ebd3878f36',
  items: [{ productId: id, quantity: 3 }],
  method: 'CASH',
  receivedSatang: 10000,
  expectedTotalSatang: 3750,
};
test('POS calculates integer satang from the server catalog', () => {
  const result = priceItems(input.items, [
    { id, active: true, name: 'ชา', barcode: '001', priceSatang: 1250 },
  ]);
  assert.equal(result.totalSatang, 3750);
  assert.equal(result.lines[0].name, 'ชา');
});
test('checkout accepts table zones and bounded QR hours; retry cannot change granted zones', async () => {
  const data = {
    ...input,
    tableId: id,
    ordering: { zones: ['หมูกระทะ', 'ทะเล'], qrHours: 2 },
    printQr: true,
  };
  assert.equal(checkoutInput.safeParse(data).success, true);
  assert.equal(checkoutInput.safeParse({ ...data, tableId: undefined }).success, false);
  for (const qrHours of [0, 169, 1.5])
    assert.equal(
      checkoutInput.safeParse({ ...data, ordering: { zones: [], qrHours } }).success,
      false,
    );
  const sale = { id: 'receipt', actor: 'owner', requestHash: requestHash(data) };
  const db = {
    posSale: { findUnique: async () => sale },
    $transaction: () => assert.fail('must not write twice'),
  };
  assert.equal(await completeSale(db, data, 'owner'), sale);
  await assert.rejects(
    completeSale(db, { ...data, ordering: { zones: ['ทะเล'], qrHours: 2 } }, 'owner'),
    { code: 'POS_KEY_MISMATCH' },
  );
});
test('POS refuses client prices, fractional quantities and empty baskets', () => {
  assert.equal(checkoutInput.safeParse({ ...input, totalSatang: 1 }).success, false);
  assert.equal(
    checkoutInput.safeParse({ ...input, items: [{ productId: id, quantity: 1.5 }] }).success,
    false,
  );
  assert.equal(checkoutInput.safeParse({ ...input, items: [] }).success, false);
});
test('member checkout accepts phone or QR and refuses two identities or supplied member IDs', () => {
  assert.equal(checkoutInput.safeParse({ ...input, memberPhone: '0812345678' }).success, true);
  assert.equal(checkoutInput.safeParse({ ...input, memberPhone: 'bad' }).success, false);
  assert.equal(
    checkoutInput.safeParse({
      ...input,
      memberPhone: '0812345678',
      memberCode: `8SM-${'a'.repeat(64)}`,
    }).success,
    false,
  );
  assert.equal(checkoutInput.safeParse({ ...input, memberId: 'arbitrary' }).success, false);
});
test('POS rejects unavailable and duplicate products', () => {
  assert.throws(() => priceItems(input.items, [{ id, active: false }]));
  assert.throws(() => priceItems([...input.items, ...input.items], []));
});
test('retry returns the committed sale without a second transaction', async () => {
  const sale = { id: 'receipt', actor: 'owner', requestHash: requestHash(input) };
  const db = {
    posSale: { findUnique: async () => sale },
    $transaction: () => assert.fail('must not write again'),
  };
  assert.equal(await completeSale(db, input, 'owner'), sale);
  await assert.rejects(completeSale(db, { ...input, receivedSatang: 20000 }, 'owner'));
});
test('underpayment and unbalanced transfers never create a sale', async () => {
  const tx = {
    posShift: {
      findUnique: async () => ({ id: input.shiftId, closedAt: null }),
      updateMany: async () => ({ count: 1 }),
    },
    posProduct: { findMany: async () => [{ id, active: true, priceSatang: 1250 }] },
    posSale: { create: () => assert.fail('must not create') },
  };
  const db = { posSale: { findUnique: async () => null }, $transaction: async (fn) => fn(tx) };
  await assert.rejects(completeSale(db, { ...input, receivedSatang: 1 }, 'owner'));
  await assert.rejects(completeSale(db, { ...input, method: 'TRANSFER' }, 'owner'));
});
