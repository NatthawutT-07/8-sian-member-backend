import rateLimit from 'express-rate-limit';
import { digest, sessionToken } from '../../shared/security.js';
import { loyaltyPhoneInput } from './loyalty.validation.js';
import { publicMember } from './member.presenter.js';

export async function loyaltySummary(db, memberId) {
  const [visitCount, visits] = await Promise.all([
    db.diningVisit.count({ where: { memberId } }),
    db.diningVisit.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { receiptNumber: true, createdAt: true },
    }),
  ]);
  return { visitCount, visits };
}
export function mountMemberLoyalty(app, db, requireMember) {
  app.use('/api/members/me', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  const limit = rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่' },
  });
  app.get('/api/members/me/loyalty', requireMember, async (req, res) => {
    res.json({ phone: req.member.phone, ...(await loyaltySummary(db, req.member.id)) });
  });
  app.post('/api/members/me/phone', requireMember, limit, async (req, res) => {
    const parsed = loyaltyPhoneInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: 'กรุณากรอกเบอร์มือถือ 10 หลัก' });
    if (req.member.phone) {
      if (req.member.phone !== parsed.data.phone)
        return res.status(409).json({ message: 'หากต้องการเปลี่ยนเบอร์ กรุณาติดต่อร้าน' });
      return res.json({ member: publicMember(req.member) });
    }
    try {
      const member = await db.$transaction(async (tx) => {
        const changed = await tx.member.updateMany({
          where: { id: req.member.id, phone: null },
          data: parsed.data,
        });
        if (changed.count !== 1)
          throw Object.assign(new Error('PHONE_CHANGED'), { code: 'PHONE_CHANGED' });
        await tx.auditLog.create({
          data: {
            actor: req.member.id,
            memberId: req.member.id,
            action: 'ADD_LOYALTY_PHONE',
            details: {},
          },
        });
        return tx.member.findUnique({ where: { id: req.member.id } });
      });
      res.json({ member: publicMember(member) });
    } catch (error) {
      if (['P2002', 'PHONE_CHANGED'].includes(error.code))
        return res
          .status(409)
          .json({ message: 'เบอร์นี้ถูกบันทึกแล้ว กรุณาตรวจสอบหรือติดต่อร้าน' });
      throw error;
    }
  });
  app.post('/api/members/me/loyalty-code', requireMember, limit, async (req, res) => {
    if (!req.member.phone)
      return res.status(400).json({ message: 'กรุณาเพิ่มเบอร์โทรก่อนสะสมครั้ง' });
    const code = `8SM-${sessionToken()}`,
      expiresAt = new Date(Date.now() + 10 * 60000);
    await db.member.update({
      where: { id: req.member.id },
      data: { loyaltyQrHash: digest(code), loyaltyQrExpiresAt: expiresAt },
    });
    res.json({ code, expiresAt });
  });
}
