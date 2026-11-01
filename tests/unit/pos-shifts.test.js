import test from 'node:test';
import assert from 'node:assert/strict';
import { dayRange, businessDate, openInput, closeInput, closeShift } from '../../src/pos/shifts.js';
test('daily reports use Bangkok midnight and exclude the next day', () => {
  const range = dayRange('2026-10-29');
  assert.equal(range.gte.toISOString(), '2026-10-28T17:00:00.000Z');
  assert.equal(range.lt.toISOString(), '2026-10-29T17:00:00.000Z');
  assert.equal(businessDate(new Date('2026-10-28T17:01:00Z')), '2026-10-29');
  assert.throws(() => dayRange('2026-02-30'));
  assert.throws(() => dayRange('bad'));
});
test('open and close reject negative or fractional satang and client totals', () => {
  assert.equal(openInput.safeParse({ openingCashSatang: -1 }).success, false);
  assert.equal(openInput.safeParse({ openingCashSatang: 0.5 }).success, false);
  assert.equal(
    closeInput.safeParse({
      shiftId: '4566cad7-b7bb-49dd-9a85-07ebd3878f36',
      countedCashSatang: 0,
      expectedCashSatang: 0,
    }).success,
    false,
  );
});
test('close failure rolls back the shift and audit together', async () => {
  let stored = { id: 'shift', closedAt: null, openingCashSatang: 100 };
  const db = {
    $transaction: async (fn, options) => {
      assert.equal(options.isolationLevel, 'Serializable');
      const before = structuredClone(stored);
      try {
        return await fn(db);
      } catch (e) {
        stored = before;
        throw e;
      }
    },
    posShift: {
      findUnique: async () => stored,
      updateMany: async () => ({ count: 1 }),
      update: async ({ data }) => Object.assign(stored, data),
    },
    posSale: { groupBy: async () => [] },
    auditLog: {
      create: async () => {
        throw new Error('AUDIT_FAILED');
      },
    },
  };
  await assert.rejects(closeShift(db, { shiftId: 'shift', countedCashSatang: 100 }, 'user'));
  assert.equal(stored.closedAt, null);
});
