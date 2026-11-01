import { digest } from '../shared/security.js';
import { nextReceiptNumber } from './receipt-number.js';
import { priceItems } from './pricing.js';
import { selectedMember } from './member-selection.js';
import { couponForCheckout } from './coupon-discounts.js';
import { openPaidTable } from '../ordering/service.js';
export { productInput, checkoutInput } from './validation.js';
export { priceItems } from './pricing.js';
export const requestHash = (data) =>
  digest(
    JSON.stringify({
      ...data,
      items: [...data.items].sort((a, b) => a.productId.localeCompare(b.productId)),
    }),
  );
export async function completeSale(db, data, actor) {
  const hash = requestHash(data);
  const existing = await db.posSale.findUnique({ where: { key: data.key } });
  if (existing) {
    if (existing.requestHash !== hash || existing.actor !== actor)
      throw Object.assign(
        new Error('รหัสบิลนี้เป็นของบัญชีหรือรายการอื่น กรุณาเข้าบัญชีพนักงานที่ส่งบิลเดิม'),
        { code: 'POS_KEY_MISMATCH' },
      );
    return existing;
  }
  return db.$transaction(
    async (tx) => {
      const shift = await tx.posShift.findUnique({ where: { id: data.shiftId } });
      if (!shift || shift.closedAt) throw new Error('กรุณาเปิดร้านก่อนคิดเงิน');
      const locked = await tx.posShift.updateMany({
        where: { id: shift.id, closedAt: null },
        data: { version: { increment: 1 } },
      });
      if (locked.count !== 1) throw new Error('ร้านปิดแล้ว กรุณาตรวจรอบเปิดร้าน');
      const products = await tx.posProduct.findMany({
        where: { id: { in: data.items.map((i) => i.productId) } },
      });
      const { lines, totalSatang: subtotalSatang } = priceItems(data.items, products);
      let member = await selectedMember(tx, data);
      let coupon = null;
      if (data.couponReservationId) {
        coupon = await couponForCheckout(tx, data, actor, lines, subtotalSatang, member);
        member ||= coupon.member;
      }
      const discountSatang = coupon?.discountSatang || 0;
      const totalSatang = subtotalSatang - discountSatang;
      if (data.expectedTotalSatang !== totalSatang)
        throw new Error(
          'ราคาสินค้าหรือมูลค่าคูปองเปลี่ยนแล้ว กรุณาตรวจรายการและสแกนคูปองใหม่ก่อนรับเงิน',
        );
      if (
        data.receivedSatang < totalSatang ||
        (data.method === 'TRANSFER' && data.receivedSatang !== totalSatang)
      )
        throw new Error('ยอดรับชำระไม่ถูกต้อง');
      const createdAt = new Date();
      const receiptNumber = await nextReceiptNumber(tx, createdAt);
      const table = data.tableId ? await openPaidTable(tx, data.tableId, actor) : null;
      const sale = await tx.posSale.create({
        data: {
          receiptNumber,
          createdAt,
          key: data.key,
          requestHash: hash,
          actor,
          shiftId: shift.id,
          items: lines,
          totalSatang,
          subtotalSatang,
          discountSatang,
          couponId: coupon?.couponId,
          couponTitle: coupon?.couponTitle,
          method: data.method,
          receivedSatang: data.receivedSatang,
          changeSatang: data.receivedSatang - totalSatang,
          memberId: member?.id,
          ...(table
            ? { tableId: table.id, tableNumber: table.number, tableSessionId: table.sessionId }
            : {}),
        },
      });
      if (member)
        await tx.diningVisit.create({
          data: { memberId: member.id, receiptNumber: sale.id, recordedBy: actor },
        });
      await tx.auditLog.create({
        data: {
          actor,
          action: 'POS_PAID',
          memberId: member?.id,
          details: {
            saleId: sale.id,
            receiptNumber: sale.receiptNumber,
            totalSatang,
            discountSatang,
            couponId: coupon?.couponId,
            method: data.method,
          },
        },
      });
      return sale;
    },
    { isolationLevel: 'Serializable' },
  );
}
