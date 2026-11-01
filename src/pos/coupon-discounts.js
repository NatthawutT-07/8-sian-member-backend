import { digest } from '../shared/security.js';
import { requireCampaignAccess } from '../modules/coupons/campaign-access.js';
import { priceItems } from './pricing.js';
import { selectedMember } from './member-selection.js';

const include = {
  offer: { include: { prerequisite: { select: { id: true, title: true } } } },
  member: { select: { id: true, firstName: true, memberNumber: true, phone: true } },
};
const conflict = (message) =>
  Object.assign(new Error(message), { code: 'POS_COUPON_CONFLICT', status: 409 });
export function campaignDiscountSatang(offer) {
  if (!Number.isInteger(offer.extraPrice) || offer.extraPrice >= 0 || offer.extraPrice < -100000)
    throw new Error(
      'คูปองนี้ไม่มีส่วนลดเป็นบาท กรุณาตรวจค่า extraPrice ของแคมเปญ (ค่าลบคือส่วนลด)',
    );
  return -offer.extraPrice * 100;
}
export async function couponValue(db, coupon, lines, subtotalSatang, member, now = new Date()) {
  if (
    !coupon ||
    coupon.usedAt ||
    coupon.expiresAt <= now ||
    !coupon.barcodeExpiresAt ||
    coupon.barcodeExpiresAt <= now
  )
    throw new Error('คูปองหมดอายุ ถูกใช้แล้ว หรือรหัสหมดอายุ กรุณาเปิดรหัสใหม่');
  if (!coupon.offer.active) throw new Error('แคมเปญคูปองนี้ปิดใช้งานแล้ว');
  const amount = campaignDiscountSatang(coupon.offer);
  if (member && member.id !== coupon.memberId)
    throw new Error('คูปองเป็นของสมาชิกคนอื่น กรุณาตรวจสมาชิกของบิล');
  if (subtotalSatang <= 0) throw new Error('กรุณาเพิ่มสินค้าที่มียอดชำระก่อนใช้คูปอง');
  if (lines.some((i) => i.group === 'DISCOUNT'))
    throw new Error('คูปองใช้ร่วมกับรายการกลุ่มส่วนลดไม่ได้');
  if (subtotalSatang < coupon.offer.posMinSubtotalSatang)
    throw new Error(
      `คูปองนี้ต้องมียอดอย่างน้อย ${(coupon.offer.posMinSubtotalSatang / 100).toFixed(2)} บาท`,
    );
  await requireCampaignAccess(db, coupon.memberId, coupon.offer);
  return Math.min(amount, subtotalSatang);
}
export async function reserveCoupon(db, data, actor) {
  return db.$transaction(
    async (tx) => {
      if (!(await tx.posShift.findUnique({ where: { activeSlot: 'STORE' } })))
        throw new Error('กรุณาเปิดร้านก่อนใช้คูปอง');
      const now = new Date();
      const products = await tx.posProduct.findMany({
        where: { id: { in: data.items.map((i) => i.productId) } },
      });
      const { lines, totalSatang: subtotalSatang } = priceItems(data.items, products);
      const member = await selectedMember(tx, data);
      const hash = digest(data.code);
      const coupon = await tx.coupon.findUnique({ where: { barcodeTokenHash: hash }, include });
      const discountSatang = await couponValue(tx, coupon, lines, subtotalSatang, member, now);
      const held = await tx.posCouponReservation.findUnique({ where: { couponId: coupon.id } });
      if (held && held.expiresAt > now && (held.billKey !== data.billKey || held.actor !== actor))
        throw conflict('คูปองนี้กำลังใช้กับบิลอื่น กรุณารอหรือยกเลิกที่บิลเดิม');
      const own = await tx.posCouponReservation.findUnique({ where: { billKey: data.billKey } });
      if (own && own.actor !== actor) throw conflict('รหัสบิลนี้เป็นของพนักงานอีกบัญชี');
      const expiresAt = new Date(
        Math.min(
          now.getTime() + 5 * 60000,
          coupon.expiresAt.getTime(),
          coupon.barcodeExpiresAt.getTime(),
        ),
      );
      let reservation = held;
      if (!held || held.expiresAt <= now || held.barcodeHash !== hash) {
        await tx.posCouponReservation.deleteMany({
          where: {
            OR: [
              { billKey: data.billKey, actor },
              { couponId: coupon.id, expiresAt: { lte: now } },
            ],
          },
        });
        reservation = await tx.posCouponReservation.create({
          data: { couponId: coupon.id, billKey: data.billKey, actor, barcodeHash: hash, expiresAt },
        });
      }
      return {
        reservationId: reservation.id,
        expiresAt: reservation.expiresAt,
        title: coupon.offer.title,
        discountSatang: campaignDiscountSatang(coupon.offer),
        minSubtotalSatang: coupon.offer.posMinSubtotalSatang,
        appliedDiscountSatang: discountSatang,
        totalSatang: subtotalSatang - discountSatang,
        member: coupon.member,
      };
    },
    { isolationLevel: 'Serializable' },
  );
}
export async function couponForCheckout(tx, data, actor, lines, subtotalSatang, member) {
  const reservation = await tx.posCouponReservation.findUnique({
    where: { id: data.couponReservationId },
    include: { coupon: { include } },
  });
  const now = new Date();
  if (
    !reservation ||
    reservation.billKey !== data.key ||
    reservation.actor !== actor ||
    reservation.expiresAt <= now
  )
    throw new Error('การจองคูปองหมดอายุ กรุณาสแกนคูปองใหม่');
  if (reservation.barcodeHash !== reservation.coupon.barcodeTokenHash)
    throw new Error('รหัสคูปองเปลี่ยนแล้ว กรุณาสแกนคูปองใหม่');
  const discountSatang = await couponValue(
    tx,
    reservation.coupon,
    lines,
    subtotalSatang,
    member,
    now,
  );
  const changed = await tx.coupon.updateMany({
    where: {
      id: reservation.couponId,
      usedAt: null,
      expiresAt: { gt: now },
      barcodeTokenHash: reservation.barcodeHash,
      barcodeExpiresAt: { gt: now },
    },
    data: { usedAt: now, barcodeTokenHash: null, barcodeExpiresAt: null },
  });
  if (changed.count !== 1) throw conflict('คูปองนี้ถูกใช้แล้ว กรุณาตรวจสอบบิล');
  await tx.posCouponReservation.deleteMany({ where: { id: reservation.id, actor } });
  return {
    discountSatang,
    couponId: reservation.couponId,
    couponTitle: reservation.coupon.offer.title,
    member: reservation.coupon.member,
  };
}
