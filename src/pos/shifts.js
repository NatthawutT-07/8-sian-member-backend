import { z } from 'zod';

const amount = z.number().int().min(0).max(100000000);
export const openInput = z.object({ key: z.string().uuid(), openingCashSatang: amount }).strict();
export const closeInput = z
  .object({ shiftId: z.string().uuid(), countedCashSatang: amount })
  .strict();
export const businessDate = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
export function dayRange(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('วันที่ไม่ถูกต้อง');
  const start = new Date(`${date}T00:00:00+07:00`);
  if (!Number.isFinite(start.getTime()) || businessDate(start) !== date)
    throw new Error('วันที่ไม่ถูกต้อง');
  return { gte: start, lt: new Date(start.getTime() + 86400000) };
}
export async function salesSummary(db, where) {
  const groups = await db.posSale.groupBy({
    by: ['method'],
    where,
    _sum: { totalSatang: true },
    _count: { _all: true },
  });
  const summary = { billCount: 0, cashSatang: 0, transferSatang: 0, totalSatang: 0 };
  for (const row of groups) {
    const value = row._sum.totalSatang || 0;
    summary.billCount += row._count._all;
    summary.totalSatang += value;
    if (row.method === 'CASH') summary.cashSatang += value;
    if (row.method === 'TRANSFER') summary.transferSatang += value;
  }
  return summary;
}
export async function openShift(db, data, actor) {
  return db.$transaction(
    async (tx) => {
      const previous = await tx.posShift.findUnique({ where: { id: data.key } });
      if (previous) {
        if (previous.openingCashSatang !== data.openingCashSatang || previous.openedBy !== actor)
          throw new Error('รหัสเปิดร้านนี้ถูกใช้แล้ว');
        return previous;
      }
      const active = await tx.posShift.findUnique({ where: { activeSlot: 'STORE' } });
      if (active) return active;
      const shift = await tx.posShift.create({
        data: {
          id: data.key,
          activeSlot: 'STORE',
          businessDate: businessDate(),
          openedBy: actor,
          openingCashSatang: data.openingCashSatang,
        },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'POS_OPEN',
          details: { shiftId: shift.id, openingCashSatang: data.openingCashSatang },
        },
      });
      return shift;
    },
    { isolationLevel: 'Serializable' },
  );
}
export async function closeShift(db, data, actor) {
  return db.$transaction(
    async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id: data.shiftId } });
      if (!shift) throw new Error('ไม่พบรอบเปิดร้าน');
      if (shift.closedAt) {
        const age = Date.now() - new Date(shift.closedAt).getTime();
        if (shift.closedBy !== actor || age < 0 || age > 15 * 60000 ||
          await tx.posShift.findUnique({ where: { activeSlot: 'STORE' } }))
          throw new Error('POS ไม่อนุญาตเรียกดูข้อมูลกะเก่า');
        if (shift.countedCashSatang !== data.countedCashSatang)
          throw new Error('รอบนี้ปิดไปแล้ว กรุณาตรวจสรุปเดิม');
        return { shift, summary: await salesSummary(tx, { shiftId: shift.id }) };
      }
      // All checkouts touch this row too, so closing and a new sale cannot pass concurrently.
      const locked = await tx.posShift.updateMany({
        where: { id: shift.id, closedAt: null },
        data: { version: { increment: 1 } },
      });
      if (locked.count !== 1) throw new Error('รอบนี้ปิดไปแล้ว');
      const summary = await salesSummary(tx, { shiftId: shift.id });
      const expectedCashSatang = shift.openingCashSatang + summary.cashSatang;
      const closed = await tx.posShift.update({
        where: { id: shift.id },
        data: {
          activeSlot: null,
          closedAt: new Date(),
          closedBy: actor,
          countedCashSatang: data.countedCashSatang,
          expectedCashSatang,
          cashDifferenceSatang: data.countedCashSatang - expectedCashSatang,
        },
      });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'POS_CLOSE',
          details: {
            shiftId: shift.id,
            expectedCashSatang,
            countedCashSatang: data.countedCashSatang,
            ...summary,
          },
        },
      });
      return { shift: closed, summary };
    },
    { isolationLevel: 'Serializable' },
  );
}
