import { dayRange, businessDate, salesSummary } from '../../pos/shifts.js';
import { shiftReport } from '../../pos/shift-reports.js';
import { withCashierNames } from '../../pos/sale-receipts.js';

export function reportRange(query) {
  const from = String(query.from || businessDate()),
    to = String(query.to || from);
  const first = dayRange(from),
    last = dayRange(to);
  if (last.lt <= first.gte || last.lt - first.gte > 93 * 86400000)
    throw new Error('เลือกช่วงวันที่ไม่เกิน 93 วัน และวันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
  return { from, to, dates: { gte: first.gte, lt: last.lt } };
}
const pageOf = (query) => Math.max(1, Math.min(100000, Number.parseInt(query.page, 10) || 1));
export function mountAdminPosReports(app, db) {
  const route = (fn) => async (req, res, next) => {
    let range;
    try {
      range = reportRange(req.query);
    } catch (error) {
      return res.status(400).json({ message: error.message });
    }
    try {
      await fn(req, res, range);
    } catch (error) {
      next(error);
    }
  };
  app.get(
    '/api/admin/pos/reports',
    route(async (_req, res, range) => {
      const summary = await salesSummary(db, { createdAt: range.dates });
      res.json({ from: range.from, to: range.to, timezone: 'Asia/Bangkok', summary });
    }),
  );
  app.get(
    '/api/admin/pos/sales',
    route(async (req, res, range) => {
      const page = pageOf(req.query),
        q = String(req.query.q || '')
          .trim()
          .slice(0, 100);
      const method = String(req.query.method || '');
      if (method && !['CASH', 'TRANSFER'].includes(method))
        return res.status(400).json({ message: 'ประเภทการชำระไม่ถูกต้อง' });
      const where = {
        createdAt: range.dates,
        ...(method ? { method } : {}),
        ...(q ? { receiptNumber: { contains: q, mode: 'insensitive' } } : {}),
      };
      const [rows, total] = await Promise.all([
        db.posSale.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * 20,
          take: 20,
        }),
        db.posSale.count({ where }),
      ]);
      res.json({
        sales: await withCashierNames(db, rows),
        total,
        page,
        pages: Math.ceil(total / 20),
      });
    }),
  );
  app.get('/api/admin/pos/sales/:id', async (req, res) => {
    const sale = await db.posSale.findUnique({ where: { id: req.params.id } });
    if (!sale) return res.status(404).json({ message: 'ไม่พบบิลนี้' });
    res.json((await withCashierNames(db, [sale]))[0]);
  });
  app.get(
    '/api/admin/pos/shifts',
    route(async (req, res, range) => {
      const page = pageOf(req.query),
        status = String(req.query.status || '');
      if (status && !['OPEN', 'CLOSED'].includes(status))
        return res.status(400).json({ message: 'สถานะกะไม่ถูกต้อง' });
      const where = {
        businessDate: { gte: range.from, lte: range.to },
        ...(status === 'OPEN'
          ? { closedAt: null }
          : status === 'CLOSED'
            ? { closedAt: { not: null } }
            : {}),
      };
      const [shifts, total] = await Promise.all([
        db.posShift.findMany({
          where,
          orderBy: { openedAt: 'desc' },
          skip: (page - 1) * 20,
          take: 20,
          include: { _count: { select: { sales: true } } },
        }),
        db.posShift.count({ where }),
      ]);
      res.json({ shifts, total, page, pages: Math.ceil(total / 20) });
    }),
  );
  app.get('/api/admin/pos/shifts/:id/report', async (req, res, next) => {
    try {
      res.json(await shiftReport(db, req.params.id));
    } catch (error) {
      if (error.code === 'POS_SHIFT_NOT_FOUND')
        return res.status(404).json({ message: error.message });
      if (error.code === 'POS_SHIFT_NOT_CLOSED')
        return res.status(409).json({ message: error.message });
      next(error);
    }
  });
}
