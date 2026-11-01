import test from 'node:test';
import assert from 'node:assert/strict';
import { claimSaleOutput } from '../../src/pos/hardware.js';

test('automatic output claims are unique across concurrent clients and server restarts', async () => {
  const ids = new Set();
  const sale = { id: 'sale-1', actor: 'cashier', method: 'CASH', createdAt: new Date() };
  const db = {
    posSale: { findUnique: async ({ where }) => (where.id === sale.id ? sale : null) },
    auditLog: {
      create: async ({ data }) => {
        if (ids.has(data.id)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
        ids.add(data.id);
      },
    },
  };
  assert.deepEqual(await claimSaleOutput(db, sale.id, 'someone-else'), { claimed: false });
  assert.deepEqual(await claimSaleOutput(db, 'missing', sale.actor), { claimed: false });
  assert.deepEqual(
    await claimSaleOutput(db, sale.id, sale.actor, new Date(Date.now() + 16 * 60000)),
    { claimed: false },
  );
  const results = await Promise.all([
    claimSaleOutput(db, sale.id, sale.actor),
    claimSaleOutput(db, sale.id, sale.actor),
  ]);
  assert.equal(results.filter((result) => result.claimed).length, 1);
  assert.equal(results.find((result) => result.claimed).cash, true);
  assert.deepEqual(await claimSaleOutput(db, sale.id, sale.actor), { claimed: false });
});
