import rateLimit from 'express-rate-limit';
import { digest } from '../../shared/security.js';
import { phone } from '../auth/auth.validation.js';
import { publicMember } from '../members/member.presenter.js';
import { loyaltySummary } from '../members/loyalty.routes.js';
import { loyaltyLookupInput, diningVisitInput } from '../members/loyalty.validation.js';

export function mountAdminLoyalty(app, db) {
  const limit = rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่' },
  });
  app.post('/api/admin/loyalty/lookup', limit, async (req, res) => {
    const parsed = loyaltyLookupInput.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: 'กรุณาสแกน QR หรือกรอกเบอร์สมาชิก' });
    const { query } = parsed.data;
    let where;
    if (/^8SM-[a-f0-9]{64}$/.test(query)) where = { loyaltyQrHash: digest(query) };
    else if (phone.safeParse(query).success) where = { phone: query };
    else if (/^8S-\d{1,10}$/i.test(query)) {
      const memberNumber = Number(query.slice(3));
      if (memberNumber > 0 && memberNumber <= 2147483647) where = { memberNumber };
    }
    if (!where) return res.status(400).json({ message: 'QR หรือเบอร์สมาชิกไม่ถูกต้อง' });
    const member = await db.member.findUnique({ where });
    if (!member) return res.status(404).json({ message: 'ไม่พบสมาชิก' });
    if (
      where.loyaltyQrHash &&
      (!member.loyaltyQrExpiresAt || member.loyaltyQrExpiresAt <= new Date())
    )
      return res.status(410).json({ message: 'QR หมดอายุ กรุณาให้ลูกค้าเปิดใหม่' });
    if (!member.phone) return res.status(400).json({ message: 'สมาชิกยังไม่ได้เพิ่มเบอร์โทร' });
    res.json({
      member: { id: member.id, ...publicMember(member) },
      ...(await loyaltySummary(db, member.id)),
    });
  });
  app.post('/api/admin/loyalty/visits', limit, async (req, res) => {
    const parsed = diningVisitInput.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ message: 'กรอกเลขใบเสร็จและยืนยันว่าออกใบเสร็จแล้ว' });
    const { memberId, receiptNumber } = parsed.data;
    const member = await db.member.findUnique({ where: { id: memberId } });
    if (!member?.phone)
      return res.status(400).json({ message: 'สมาชิกต้องมีเบอร์โทรก่อนสะสมครั้ง' });
    let duplicate = false;
    try {
      await db.$transaction(async (tx) => {
        const visit = await tx.diningVisit.create({
          data: { memberId, receiptNumber, recordedBy: req.admin.id },
        });
        await tx.auditLog.create({
          data: {
            actor: req.admin.id,
            memberId,
            action: 'ADD_DINING_VISIT',
            details: { visitId: visit.id, receiptNumber },
          },
        });
      });
    } catch (error) {
      if (error.code !== 'P2002') throw error;
      const existing = await db.diningVisit.findUnique({ where: { receiptNumber } });
      if (!existing || existing.memberId !== memberId)
        return res.status(409).json({ message: 'ใบเสร็จนี้สะสมให้สมาชิกอื่นแล้ว' });
      duplicate = true;
    }
    res
      .status(duplicate ? 200 : 201)
      .json({
        duplicate,
        ...(await loyaltySummary(db, memberId)),
        message: duplicate ? 'ใบเสร็จนี้บันทึกแล้ว' : 'สะสมเพิ่ม 1 ครั้งแล้ว',
      });
  });
}
