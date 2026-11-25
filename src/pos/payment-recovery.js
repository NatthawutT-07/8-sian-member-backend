import { z } from 'zod';

export const paymentRecoveryInput = z.object({
  key: z.string().uuid(), shiftId: z.string().uuid(),
  action: z.enum(['CHECK', 'CANCEL']).default('CHECK'),
}).strict();
export const cancelledPaymentId = (key) => `pos-cancelled-payment:${key}`;

export async function recoverPayment(db, data, actor) {
  const result = (sale) => {
    if (sale.actor !== actor) throw Object.assign(new Error('กรุณาเข้าบัญชีพนักงานที่ส่งบิลเดิม'), { status: 403 });
    return { status: 'PAID', sale };
  };
  if (data.action === 'CHECK') {
    const sale = await db.posSale.findUnique({ where: { key: data.key } });
    if (sale) return result(sale);
    const cancelled = await db.auditLog.findUnique({ where: { id: cancelledPaymentId(data.key) } });
    return { status: cancelled ? 'CANCELLED' : 'NOT_FOUND' };
  }
  return db.$transaction(async (tx) => {
    // Checkout locks this same shift row. Serializable transactions prevent a
    // cancellation racing a payment from committing both outcomes.
    const locked = await tx.posShift.updateMany({ where: { id: data.shiftId }, data: { version: { increment: 1 } } });
    if (!locked.count) throw Object.assign(new Error('ไม่พบกะเดิม กรุณาติดต่อผู้ดูแลก่อนล้างรายการ'), { status: 409 });
    const sale = await tx.posSale.findUnique({ where: { key: data.key } });
    if (sale) return result(sale);
    await tx.auditLog.upsert({
      where: { id: cancelledPaymentId(data.key) }, update: {},
      create: { id: cancelledPaymentId(data.key), actor, action: 'POS_PAYMENT_CANCELLED', details: { key: data.key, shiftId: data.shiftId } },
    });
    await tx.posCouponReservation.deleteMany({ where: { billKey: data.key, actor } });
    return { status: 'CANCELLED' };
  }, { isolationLevel: 'Serializable' });
}
