import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptTime, nextReceiptNumber } from '../../src/pos/receipt-number.js';
test('receipt uses Gregorian year and Bangkok hour/minute', async () => {
  const now = new Date('2026-10-29T03:06:00Z');
  assert.deepEqual(receiptTime(now), { businessDate: '2026-10-29', prefix: '2610291006' });
  const tx = {
    posReceiptCounter: {
      upsert: async (args) => {
        assert.equal(args.where.businessDate, '2026-10-29');
        assert.equal(args.update.lastNumber.increment, 1);
        return { lastNumber: 1 };
      },
    },
  };
  assert.equal(await nextReceiptNumber(tx, now), '2610291006001');
});
test('daily sequence continues when minutes change and resets at Bangkok midnight', async () => {
  const counters = new Map();
  const tx = {
    posReceiptCounter: {
      upsert: async ({ where }) => {
        const lastNumber = (counters.get(where.businessDate) || 0) + 1;
        counters.set(where.businessDate, lastNumber);
        return { lastNumber };
      },
    },
  };
  assert.equal(await nextReceiptNumber(tx, new Date('2026-10-29T16:58:00Z')), '2610292358001');
  assert.equal(await nextReceiptNumber(tx, new Date('2026-10-29T16:59:00Z')), '2610292359002');
  assert.equal(await nextReceiptNumber(tx, new Date('2026-10-29T17:00:00Z')), '2610300000001');
});
test('sequence above 999 is never truncated or reused', async () => {
  const tx = { posReceiptCounter: { upsert: async () => ({ lastNumber: 1000 }) } };
  assert.equal(await nextReceiptNumber(tx, new Date('2026-10-29T03:06:00Z')), '26102910061000');
});
