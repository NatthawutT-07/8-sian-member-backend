import { digest } from '../shared/security.js';
export async function selectedMember(db, data) {
  if (data.memberCode) {
    const member = await db.member.findFirst({
      where: { loyaltyQrHash: digest(data.memberCode), loyaltyQrExpiresAt: { gt: new Date() } },
    });
    if (!member) throw new Error('QR สมาชิกหมดอายุ กรุณาเปิดรหัสใหม่');
    return member;
  }
  if (data.memberPhone) {
    const member = await db.member.findUnique({ where: { phone: data.memberPhone } });
    if (!member) throw new Error('ไม่พบสมาชิกจากเบอร์นี้ กรุณาค้นหาและยืนยันสมาชิกใหม่');
    return member;
  }
  return null;
}
