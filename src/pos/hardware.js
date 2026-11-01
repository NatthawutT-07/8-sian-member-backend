import { z } from 'zod';
import { parseBody } from '../shared/http-validation.js';
import { withCashierNames } from './sale-receipts.js';
import { claimShiftOutput } from './shift-reports.js';

const saleId = z.string().min(1).max(100);
const eventInput = z
  .object({
    jobId: z.uuid(),
    operation: z.enum([
      'CONNECT',
      'TEST_PRINT',
      'PRINT_RECEIPT',
      'PRINT_BARCODE',
      'OPEN_DRAWER',
      'PRINT_SHIFT',
    ]),
    status: z.enum(['REQUESTED', 'SENT', 'FAILED_OR_UNKNOWN']),
    saleId: saleId.optional(),
    shiftId: saleId.optional(),
    reason: z.string().trim().min(1).max(120),
    deviceName: z.string().trim().min(1).max(80),
  })
  .strict();

export async function claimSaleOutput(db, id, actor, now = new Date()) {
  const sale = await db.posSale.findUnique({ where: { id } });
  if (!sale || sale.actor !== actor) return { claimed: false };
  // Old receipts remain printable explicitly, but never trigger automatic hardware actions.
  const age = now.getTime() - new Date(sale.createdAt).getTime();
  if (age < 0 || age > 15 * 60000) return { claimed: false };
  try {
    // Unique primary key is the cross-device, restart-safe at-most-once claim.
    await db.auditLog.create({
      data: {
        id: `pos-output:${sale.id}`,
        actor,
        action: 'POS_OUTPUT_CLAIM',
        details: { saleId: sale.id, method: sale.method },
      },
    });
    return { claimed: true, cash: sale.method === 'CASH' };
  } catch (error) {
    if (error.code === 'P2002') return { claimed: false };
    throw error;
  }
}

export function mountHardware(router, db) {
  router.get('/sales/:id', async (req, res) => {
    if (!saleId.safeParse(req.params.id).success) return res.sendStatus(400);
    const sale = await db.posSale.findUnique({ where: { id: req.params.id } });
    if (!sale) return res.status(404).json({ message: 'ไม่พบบิลที่บันทึกแล้ว' });
    res.json((await withCashierNames(db, [sale]))[0]);
  });
  router.post('/hardware/claim', async (req, res) => {
    const data = parseBody(z.object({ saleId }).strict(), req.body, res);
    if (!data) return;
    res.json(await claimSaleOutput(db, data.saleId, req.posActor));
  });
  router.post('/hardware/events', async (req, res) => {
    const data = parseBody(eventInput, req.body, res);
    if (!data) return;
    if (data.saleId && !(await db.posSale.findUnique({ where: { id: data.saleId } })))
      return res.status(404).json({ message: 'ไม่พบบิลที่บันทึกแล้ว' });
    if (data.shiftId && !(await db.posShift.findUnique({ where: { id: data.shiftId } }))?.closedAt)
      return res.status(409).json({ message: 'ไม่พบกะที่ปิดแล้ว' });
    await db.auditLog.create({
      data: {
        actor: req.posActor,
        action: 'POS_HARDWARE',
        details: data,
      },
    });
    res.json({ ok: true });
  });
  router.post('/hardware/shift-claim', async (req, res) => {
    const data = parseBody(z.object({ shiftId: saleId }).strict(), req.body, res);
    if (!data) return;
    res.json(await claimShiftOutput(db, data.shiftId, req.posActor));
  });
}
