import rateLimit from 'express-rate-limit';
import { createBarcode } from './barcode.service.js';
export const SEAFOOD_CAMPAIGN = 'seafood79_welcome_v1';
export const COUPON_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const couponView = (coupon) => ({
  id: coupon.id,
  title: coupon.offer.title,
  description: coupon.offer.description,
  extraPrice: coupon.offer.extraPrice,
  validityDays: coupon.offer.validityDays,
  issuedAt: coupon.issuedAt,
  expiresAt: coupon.expiresAt,
});
export function mountCoupons(app, db, auth) {
  const claimLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'รับคูปองบ่อยเกินไป กรุณาลองภายหลัง' },
  });
  app.get('/api/campaigns', auth, async (req, res) => {
    const campaigns = await db.campaign.findMany({
      where: { active: true },
      include: { coupons: { where: { memberId: req.member.id }, select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({
      campaigns: campaigns.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        extraPrice: c.extraPrice,
        validityDays: c.validityDays,
        received: c.coupons.length > 0,
      })),
    });
  });
  app.post('/api/campaigns/:id/claim', auth, claimLimit, async (req, res) => {
    if (req.params.id.length > 100)
      return res.status(400).json({ message: 'รหัสแคมเปญไม่ถูกต้อง' });
    try {
      const coupon = await db.$transaction(async (tx) => {
        const rows =
          await tx.$queryRaw`SELECT "active" FROM "Campaign" WHERE "id" = ${req.params.id} FOR SHARE`;
        if (!rows[0]?.active) return null;
        const campaign = await tx.campaign.findUnique({ where: { id: req.params.id } }),
          now = new Date();
        const issued = await tx.coupon.create({
          data: {
            memberId: req.member.id,
            campaign: campaign.id,
            issuedAt: now,
            expiresAt: new Date(now.getTime() + campaign.validityDays * 86400000),
          },
        });
        await tx.auditLog.create({
          data: {
            actor: `member:${req.member.id}`,
            action: 'MEMBER_CLAIM_COUPON',
            memberId: req.member.id,
            details: { campaignId: campaign.id, couponId: issued.id },
          },
        });
        return issued;
      });
      if (!coupon) return res.status(404).json({ message: 'แคมเปญนี้ปิดรับคูปองแล้ว' });
      res.status(201).json({ message: 'รับคูปองแล้ว ดูได้ในคูปองของฉัน', couponId: coupon.id });
    } catch (e) {
      if (e.code === 'P2002')
        return res.status(409).json({ message: 'คุณรับคูปองแคมเปญนี้แล้ว ไม่สามารถรับซ้ำได้' });
      throw e;
    }
  });
  app.get('/api/coupons', auth, async (req, res) => {
    const now = new Date();
    const coupons = await db.coupon.findMany({
      where: { memberId: req.member.id, usedAt: null, expiresAt: { gt: now } },
      include: { offer: true },
      orderBy: { expiresAt: 'asc' },
    });
    res.json({ coupons: coupons.map(couponView), serverTime: now });
  });
  const barcodeLimit = rateLimit({
    windowMs: 60000,
    limit: 15,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'เปิดบาร์โค้ดบ่อยเกินไป กรุณารอสักครู่' },
  });
  app.post('/api/coupons/:id/barcode', auth, barcodeLimit, async (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id))
      return res.status(400).json({ message: 'รหัสคูปองไม่ถูกต้อง' });
    const now = new Date();
    const coupon = await db.coupon.findFirst({
      where: { id: req.params.id, memberId: req.member.id, usedAt: null, expiresAt: { gt: now } },
    });
    if (!coupon)
      return res.status(409).json({ message: 'คูปองนี้ใช้แล้ว หมดอายุ หรือไม่สามารถใช้งานได้' });
    const barcode = createBarcode(coupon.expiresAt, now);
    const result = await db.coupon.updateMany({
      where: { id: coupon.id, memberId: req.member.id, usedAt: null, expiresAt: { gt: now } },
      data: { barcodeTokenHash: barcode.hash, barcodeExpiresAt: barcode.expiresAt },
    });
    if (!result.count)
      return res.status(409).json({ message: 'คูปองนี้ใช้แล้ว หมดอายุ หรือไม่สามารถใช้งานได้' });
    res.set('Cache-Control', 'no-store').json({
      barcode: { code: barcode.code, expiresAt: barcode.expiresAt, couponId: coupon.id },
      serverTime: now,
    });
  });
  app.get('/api/coupons/:id/status', auth, async (req, res) => {
    const coupon = await db.coupon.findFirst({
      where: { id: req.params.id, memberId: req.member.id },
      select: { id: true, usedAt: true, expiresAt: true, barcodeExpiresAt: true },
    });
    if (!coupon) return res.status(404).json({ message: 'ไม่พบคูปอง' });
    const now = new Date();
    res.set('Cache-Control', 'no-store').json({
      couponId: coupon.id,
      status: coupon.usedAt ? 'USED' : coupon.expiresAt <= now ? 'EXPIRED' : 'AVAILABLE',
      usedAt: coupon.usedAt,
      barcodeExpiresAt: coupon.barcodeExpiresAt,
      serverTime: now,
    });
  });
  // Compatibility guard: customer clicks no longer consume a coupon.
  app.post('/api/coupons/:id/redeem', auth, (req, res) => {
    res
      .status(410)
      .json({ message: 'กรุณาแสดงบาร์โค้ด คูปองจะใช้สำเร็จเมื่อ POS ยืนยันการชำระบิลเท่านั้น' });
  });
}
