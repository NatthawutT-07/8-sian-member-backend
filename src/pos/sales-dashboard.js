import { summarizeShiftSales } from './shift-reports.js';
import { businessDate, dayRange } from './shifts.js';

export function summarizeDashboardSales(sales, from, to) {
  const report = summarizeShiftSales(sales);
  const daily = new Map();
  const end = dayRange(to).lt.getTime();
  for (let time = dayRange(from).gte.getTime(); time < end; time += 86400000) {
    const date = businessDate(new Date(time));
    daily.set(date, { date, totalSatang: 0, billCount: 0 });
  }
  for (const sale of sales) {
    const row = daily.get(businessDate(new Date(sale.createdAt)));
    if (row) { row.totalSatang += sale.totalSatang; row.billCount++; }
  }
  return {
    summary: {
      ...report.summary,
      averageBillSatang: report.summary.billCount ? Math.round(report.summary.totalSatang / report.summary.billCount) : 0,
      soldQuantity: report.items.filter((item) => item.priceSatang >= 0).reduce((total, item) => total + item.quantity, 0),
    },
    daily: [...daily.values()],
    products: report.items.sort((a, b) => b.totalSatang - a.totalSatang || b.quantity - a.quantity || a.name.localeCompare(b.name)),
  };
}
