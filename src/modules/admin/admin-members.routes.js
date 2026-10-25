import rateLimit from 'express-rate-limit';
import { parseBody as parse } from '../../shared/http-validation.js';
import { grantInput, resetInput } from './admin.validation.js';
import { verifyPassword, hashPassword } from '../../shared/security.js';
import {
  campaignAccess,
  prerequisiteInclude,
  requireCampaignAccess,
  usedCampaignsFor,
} from '../coupons/campaign-access.js';
const memberFields = {
  id: true,
  memberNumber: true,
  firstName: true,
  lastName: true,
  phone: true,
  birthDate: true,
  createdAt: true,
};
const memberView = (m) => ({
  ...m,
  memberNumber: `8S-${String(m.memberNumber).padStart(6, '0')}`,
});
export function mountAdminMembers(app, db) {
  const resetLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { message: 'ตั้งรหัสผ่านบ่อยเกินไป กรุณารอ 15 นาที' },
  });
  app.get('/api/admin/members', async (req, res) => {
    const q = String(req.query.q || '')
        .trim()
        .slice(0, 100),
      page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const number = Number(q.replace(/^8S-/i, ''));
    const where = q
      ? {
          OR: [
            { phone: { contains: q } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            ...(Number.isInteger(number) && number > 0 && number <= 2147483647
              ? [{ memberNumber: number }]
              : []),
          ],
        }
      : {};
    const [members, total] = await Promise.all([
      db.member.findMany({
        where,
        select: memberFields,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * 20,
        take: 20,
      }),
      db.member.count({ where }),
    ]);
    res.json({ members: members.map(memberView), total, page, pages: Math.ceil(total / 20) });
  });
  app.get('/api/admin/members/:id', async (req, res) => {
    const member = await db.member.findUnique({
      where: { id: req.params.id },
      select: memberFields,
    });
    if (!member) return res.status(404).json({ message: 'ไม่พบสมาชิก' });
    const [coupons, audits, used] = await Promise.all([
      db.coupon.findMany({
        where: { memberId: member.id },
        include: { offer: { include: prerequisiteInclude } },
        orderBy: { issuedAt: 'desc' },
        take: 100,
      }),
      db.auditLog.findMany({
        where: { memberId: member.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      usedCampaignsFor(db, member.id),
    ]);
    res.json({
      member: memberView(member),
      usedCampaignIds: [...used],
      coupons: coupons.map((c) => ({
        id: c.id,
        campaignId: c.campaign,
        title: c.offer.title,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        usedAt: c.usedAt,
        ...campaignAccess(c.offer, used),
        status: c.usedAt
          ? 'USED'
          : c.expiresAt <= new Date()
            ? 'EXPIRED'
            : campaignAccess(c.offer, used).locked
              ? 'LOCKED'
              : 'AVAILABLE',
      })),
      audits,
    });
  });
  app.post('/api/admin/members/:id/coupons', async (req, res) => {
    const data = parse(grantInput, req.body, res);
    if (!data) return;
    const [member, campaign] = await Promise.all([
      db.member.findUnique({ where: { id: req.params.id }, select: { id: true } }),
      db.campaign.findUnique({ where: { id: data.campaignId }, include: prerequisiteInclude }),
    ]);
    if (!member) return res.status(404).json({ message: 'ไม่พบสมาชิก' });
    if (!campaign?.active) return res.status(400).json({ message: 'แคมเปญนี้ไม่เปิดแจกคูปอง' });
    try {
      const coupon = await db.$transaction(async (tx) => {
        const rows =
          await tx.$queryRaw`SELECT "active" FROM "Campaign" WHERE "id" = ${campaign.id} FOR SHARE`;
        if (!rows[0]?.active) return null;
        await requireCampaignAccess(tx, member.id, campaign);
        const now = new Date();
        const issued = await tx.coupon.create({
          data: {
            memberId: member.id,
            campaign: campaign.id,
            issuedAt: now,
            expiresAt: new Date(now.getTime() + campaign.validityDays * 86400000),
          },
        });
        await tx.auditLog.create({
          data: {
            actor: req.admin.id,
            action: 'GRANT_COUPON',
            memberId: member.id,
            details: { campaignId: campaign.id, couponId: issued.id },
          },
        });
        return issued;
      });
      if (!coupon) return res.status(400).json({ message: 'แคมเปญนี้ไม่เปิดแจกคูปอง' });
      res.status(201).json({ coupon, message: 'แจกคูปองให้สมาชิกแล้ว' });
    } catch (e) {
      if (e.code === 'P2002')
        return res
          .status(409)
          .json({ message: 'สมาชิกเคยได้รับคูปองแคมเปญนี้แล้ว ไม่สามารถแจกซ้ำได้' });
      throw e;
    }
  });
  app.post('/api/admin/members/:id/password', resetLimit, async (req, res) => {
    const data = parse(resetInput, req.body, res);
    if (!data) return;
    if (!(await verifyPassword(data.adminPassword, req.admin.passwordHash)))
      return res.status(403).json({ message: 'รหัสผ่านยืนยันของแอดมินไม่ถูกต้อง' });
    const member = await db.member.findUnique({
      where: { id: req.params.id },
      select: { id: true },
    });
    if (!member) return res.status(404).json({ message: 'ไม่พบสมาชิก' });
    const passwordHash = await hashPassword(data.newPassword);
    await db.$transaction([
      db.member.update({ where: { id: member.id }, data: { passwordHash } }),
      db.session.deleteMany({ where: { memberId: member.id } }),
      db.auditLog.create({
        data: {
          actor: req.admin.id,
          action: 'RESET_MEMBER_PASSWORD',
          memberId: member.id,
          details: { reason: data.reason },
        },
      }),
    ]);
    res.json({ message: 'ตั้งรหัสผ่านใหม่แล้ว และออกจากระบบสมาชิกทุกอุปกรณ์' });
  });
}
