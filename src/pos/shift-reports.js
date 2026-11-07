export function summarizeShiftSales(sales) {
  const summary = {
    billCount: sales.length,
    cashBillCount: 0,
    transferBillCount: 0,
    cashSatang: 0,
    transferSatang: 0,
    totalSatang: 0,
    subtotalSatang: 0,
    discountSatang: 0,
    cashReceivedSatang: 0,
    cashChangeSatang: 0,
  };
  const items = new Map();
  for (const sale of sales) {
    summary.totalSatang += sale.totalSatang;
    summary.discountSatang += sale.discountSatang || 0;
    summary.subtotalSatang += sale.subtotalSatang ?? sale.totalSatang + (sale.discountSatang || 0);
    if (sale.method === 'CASH') {
      summary.cashBillCount++;
      summary.cashSatang += sale.totalSatang;
      summary.cashReceivedSatang += sale.receivedSatang;
      summary.cashChangeSatang += sale.changeSatang;
    } else if (sale.method === 'TRANSFER') {
      summary.transferBillCount++;
      summary.transferSatang += sale.totalSatang;
    }
    for (const line of sale.items) {
      // Keep historical names and unit prices, even when the catalog changes later.
      const key = JSON.stringify([line.productId, line.name, line.priceSatang]);
      const item = items.get(key) || {
        productId: line.productId,
        name: line.name,
        priceSatang: line.priceSatang,
        quantity: 0,
        totalSatang: 0,
      };
      item.quantity += line.quantity;
      item.totalSatang += line.priceSatang * line.quantity;
      items.set(key, item);
    }
  }
  return { summary, items: [...items.values()] };
}

export async function shiftReport(db, id) {
  const shift = await db.posShift.findUnique({ where: { id } });
  if (!shift) throw Object.assign(new Error('ไม่พบกะนี้'), { code: 'POS_SHIFT_NOT_FOUND' });
  if (!shift.closedAt)
    throw Object.assign(new Error('กะนี้ยังไม่ปิด กรุณาปิดกะก่อนพิมพ์สรุป'), {
      code: 'POS_SHIFT_NOT_CLOSED',
    });
  const sales = await db.posSale.findMany({
    where: { shiftId: id },
    orderBy: { createdAt: 'asc' },
    select: {
      items: true,
      totalSatang: true,
      subtotalSatang: true,
      discountSatang: true,
      method: true,
      receivedSatang: true,
      changeSatang: true,
    },
  });
  const users = await db.posUser.findMany({
    where: { id: { in: [shift.openedBy, shift.closedBy].filter(Boolean) } },
    select: { id: true, displayName: true },
  });
  const names = new Map(users.map((user) => [user.id, user.displayName]));
  return {
    shift: {
      ...shift,
      openedByName: names.get(shift.openedBy) || 'ไม่ระบุ',
      closedByName: names.get(shift.closedBy) || 'ไม่ระบุ',
    },
    ...summarizeShiftSales(sales),
  };
}

export async function claimShiftOutput(db, id, actor, now = new Date()) {
  const shift = await db.posShift.findUnique({ where: { id } });
  if (!shift?.closedAt || shift.closedBy !== actor) return { claimed: false };
  const age = now.getTime() - new Date(shift.closedAt).getTime();
  if (age < 0 || age > 15 * 60000) return { claimed: false };
  try {
    await db.auditLog.create({
      data: {
        id: `pos-shift-output:${id}`,
        actor,
        action: 'POS_SHIFT_OUTPUT_CLAIM',
        details: { shiftId: id },
      },
    });
    return { claimed: true };
  } catch (error) {
    if (error.code === 'P2002') return { claimed: false };
    throw error;
  }
}

export function mountShiftReports(router, db) {
  router.get('/shifts/closed', async (_req, res) => {
    res.status(403).json({ message: 'POS ไม่อนุญาตดูประวัติกะเก่า' });
  });
  router.get('/shifts/:id/report', async (req, res, next) => {
    if (!req.params.id || req.params.id.length > 100) return res.sendStatus(400);
    try {
      const shift = await db.posShift.findUnique({ where: { id: req.params.id } });
      const age = shift?.closedAt ? Date.now() - new Date(shift.closedAt).getTime() : Infinity;
      const active = await db.posShift.findUnique({ where: { activeSlot: 'STORE' } });
      if (!shift || shift.closedBy !== req.posActor || age < 0 || age > 15 * 60000 || active)
        return res.status(403).json({ message: 'ดูได้เฉพาะใบสรุปกะที่ตนเพิ่งปิดภายใน 15 นาที และยังไม่เปิดกะใหม่' });
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
