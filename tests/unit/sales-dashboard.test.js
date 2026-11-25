import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDashboardSales } from '../../src/pos/sales-dashboard.js';
import { mountAdminPosReports } from '../../src/modules/admin/admin-pos-reports.routes.js';

test('dashboard reconciles mixed tenders, coupons, historical prices, free items and Bangkok dates', () => {
  const sales = [
    { createdAt: '2026-11-23T17:00:00Z', method: 'CASH', totalSatang: 27000, subtotalSatang: 30000, discountSatang: 3000, receivedSatang: 30000, changeSatang: 3000, items: [{ productId: 'p', name: 'บุฟเฟต์', priceSatang: 10000, quantity: 3 }] },
    { createdAt: '2026-11-24T17:00:00Z', method: 'MIXED', totalSatang: 20000, transferSatang: 12000, receivedSatang: 22000, changeSatang: 2000, items: [{ productId: 'p', name: 'บุฟเฟต์', priceSatang: 12000, quantity: 2 }, { productId: 'd', name: 'ส่วนลด', priceSatang: -4000, quantity: 1 }] },
    { createdAt: '2026-11-25T17:00:00Z', method: 'TRANSFER', totalSatang: 0, receivedSatang: 0, changeSatang: 0, items: [{ productId: 'free', name: 'น้ำฟรี', priceSatang: 0, quantity: 1 }] },
  ];
  const { summary, products, daily } = summarizeDashboardSales(sales, '2026-11-24', '2026-11-27');
  assert.equal(summary.totalSatang, 47000);
  assert.equal(summary.cashSatang, 35000);
  assert.equal(summary.transferSatang, 12000);
  assert.equal(summary.soldQuantity, 6);
  assert.equal(summary.billCount, 3);
  assert.equal(summary.averageBillSatang, 15667);
  assert.equal(products.filter((item) => item.productId === 'p').length, 2);
  assert.equal(products.reduce((total, item) => total + item.totalSatang, 0) - summary.discountSatang, summary.totalSatang);
  assert.deepEqual(daily.map((row) => [row.date, row.totalSatang, row.billCount]), [
    ['2026-11-24', 27000, 1], ['2026-11-25', 20000, 1], ['2026-11-26', 0, 1], ['2026-11-27', 0, 0],
  ]);
});

test('dashboard handles no sales and validates range before querying the database', async () => {
  const report = summarizeDashboardSales([], '2026-11-25', '2026-11-25');
  assert.equal(report.summary.averageBillSatang, 0);
  assert.equal(report.products.length, 0);
  assert.equal(report.daily.length, 1);
  const routes = new Map();
  let called = 0;
  mountAdminPosReports({ get: (path, handler) => routes.set(path, handler) }, {
    posSale: { findMany: async (query) => {
      called++;
      assert.equal(query.where.createdAt.gte.toISOString(), '2026-11-24T17:00:00.000Z');
      assert.equal(query.where.createdAt.lt.toISOString(), '2026-11-25T17:00:00.000Z');
      return [];
    } },
  });
  let status = 200, result;
  const response = { status(value) { status = value; return this; }, json(value) { result = value; } };
  const handler = routes.get('/api/admin/pos/dashboard');
  await handler({ query: { from: '2026-11-25', to: '2026-11-25' } }, response, assert.fail);
  assert.equal(called, 1);
  assert.equal(result.timezone, 'Asia/Bangkok');
  await handler({ query: { from: '2026-01-01', to: '2026-11-25' } }, response, assert.fail);
  assert.equal(status, 400);
  assert.equal(called, 1);
});
