import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeShiftSales, shiftReport, claimShiftOutput } from '../../src/pos/shift-reports.js';

test('shift totals separate net cash/transfer, coupon discounts, price changes and negative items', () => {
  const result = summarizeShiftSales([
    {
      method: 'CASH',
      totalSatang: 57000,
      subtotalSatang: 59000,
      discountSatang: 2000,
      receivedSatang: 60000,
      changeSatang: 3000,
      items: [
        { productId: 'p', name: 'อาหาร', priceSatang: 30000, quantity: 2 },
        { productId: 'd', name: 'ส่วนลด', priceSatang: -1000, quantity: 1 },
      ],
    },
    {
      method: 'TRANSFER',
      totalSatang: 30000,
      receivedSatang: 30000,
      changeSatang: 0,
      items: [{ productId: 'p', name: 'อาหาร', priceSatang: 30000, quantity: 1 }],
    },
    {
      method: 'CASH',
      totalSatang: 32000,
      receivedSatang: 32000,
      changeSatang: 0,
      items: [{ productId: 'p', name: 'อาหารเปลี่ยนราคา', priceSatang: 32000, quantity: 1 }],
    },
  ]);
  assert.equal(result.summary.totalSatang, 119000);
  assert.equal(result.summary.cashSatang, 89000);
  assert.equal(result.summary.transferSatang, 30000);
  assert.equal(result.summary.cashBillCount, 2);
  assert.equal(result.summary.transferBillCount, 1);
  assert.equal(
    result.summary.subtotalSatang - result.summary.discountSatang,
    result.summary.totalSatang,
  );
  assert.equal(
    result.summary.cashReceivedSatang - result.summary.cashChangeSatang,
    result.summary.cashSatang,
  );
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].quantity, 3);
  assert.equal(result.items[1].totalSatang, -1000);
  assert.equal(summarizeShiftSales([]).summary.totalSatang, 0);
});

test('closed report filters by shiftId across midnight and refuses active/missing shifts', async () => {
  const shift = { id: 's1', openedBy: 'u', closedBy: 'u', closedAt: new Date() };
  let where;
  const db = {
    posShift: { findUnique: async () => shift },
    posSale: {
      findMany: async (query) => {
        where = query.where;
        return [];
      },
    },
    posUser: { findMany: async () => [{ id: 'u', displayName: 'พนักงาน' }] },
  };
  const report = await shiftReport(db, 's1');
  assert.deepEqual(where, { shiftId: 's1' });
  assert.equal(report.shift.closedByName, 'พนักงาน');
  shift.closedAt = null;
  await assert.rejects(shiftReport(db, 's1'), { code: 'POS_SHIFT_NOT_CLOSED' });
  db.posShift.findUnique = async () => null;
  await assert.rejects(shiftReport(db, 'missing'), { code: 'POS_SHIFT_NOT_FOUND' });
});

test('automatic close report print claims are unique and limited to the closing employee', async () => {
  const ids = new Set();
  const shift = { id: 's1', closedBy: 'u', closedAt: new Date() };
  const db = {
    posShift: { findUnique: async () => shift },
    auditLog: {
      create: async ({ data }) => {
        if (ids.has(data.id)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        ids.add(data.id);
      },
    },
  };
  assert.deepEqual(await claimShiftOutput(db, 's1', 'other'), { claimed: false });
  const results = await Promise.all([
    claimShiftOutput(db, 's1', 'u'),
    claimShiftOutput(db, 's1', 'u'),
  ]);
  assert.equal(results.filter((row) => row.claimed).length, 1);
  assert.deepEqual(await claimShiftOutput(db, 's1', 'u'), { claimed: false });
});
